/**
 * messageCreate — two jobs on every guild message:
 *   1. Auto-moderation: a regex blacklist (BLOCKED_PATTERNS) plus link-spam /
 *      mass-mention heuristics. A hit is deleted and the author gets a warning
 *      that self-destructs after 5s.
 *   2. Leveling: award 15–25 XP, at most once per XP_COOLDOWN_SEC per user.
 *      Crossing a level boundary posts a level-up line in the same channel.
 */
import { EmbedBuilder, Events, type Message } from "discord.js";
import type { BotEvent } from "./types.js";
import { config } from "../config.js";
import { addXp } from "../services/database.js";

const WARN_TTL_MS = 5_000;
const MAX_MENTIONS = 5;
const MAX_LINKS = 4;

const blacklist: RegExp[] = config.moderation.blockedPatterns.flatMap((p) => {
  try {
    return [new RegExp(p, "i")];
  } catch {
    console.error(`[automod] ignoring invalid pattern: ${p}`);
    return [];
  }
});

const linkRe = /https?:\/\/\S+/gi;

/** Returns a short reason string if the message should be removed. */
function screen(message: Message): string | null {
  const content = message.content;
  for (const re of blacklist) if (re.test(content)) return "blocked phrase";
  if (message.mentions.users.size + message.mentions.roles.size > MAX_MENTIONS) return "mass mention";
  if ((content.match(linkRe)?.length ?? 0) > MAX_LINKS) return "link spam";
  return null;
}

const xpCooldown = new Map<string, number>();

// evict stale cooldown keys so the map can't grow unbounded on a busy server
setInterval(() => {
  const cutoff = Date.now() - config.leveling.cooldownMs;
  for (const [k, t] of xpCooldown) if (t < cutoff) xpCooldown.delete(k);
}, 5 * 60_000).unref();

export const name = Events.MessageCreate;

export const execute: BotEvent<Events.MessageCreate>["execute"] = async (message) => {
  if (message.author.bot || !message.inGuild()) return;

  // ── 1. automod (opt-in via AUTOMOD_ENABLED) ───────────────────────────
  const canManage = message.guild.members.me?.permissions.has("ManageMessages");
  const reason = config.moderation.automodEnabled ? screen(message) : null;
  if (reason && canManage) {
    try {
      await message.delete();
      const warn = await message.channel.send({ content: `${message.author}, that message was removed (${reason}).` });
      setTimeout(() => void warn.delete().catch(() => {}), WARN_TTL_MS);

      if (config.moderation.logChannelId) {
        const ch = await message.guild.channels.fetch(config.moderation.logChannelId).catch(() => null);
        if (ch?.isTextBased()) {
          await ch
            .send({
              embeds: [
                new EmbedBuilder()
                  .setTitle("Automod — message removed")
                  .setColor(0xef4444)
                  .addFields(
                    { name: "Author", value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
                    { name: "Channel", value: `<#${message.channelId}>`, inline: true },
                    { name: "Reason", value: reason },
                    { name: "Content", value: message.content.slice(0, 1000) || "_(no text)_" },
                  )
                  .setTimestamp(),
              ],
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      console.error("[automod] delete failed:", (e as Error).message);
    }
    return; // a removed message earns no XP
  }

  // ── 2. leveling ───────────────────────────────────────────────────────
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (xpCooldown.get(key) ?? 0) < config.leveling.cooldownMs) return;
  xpCooldown.set(key, now);

  try {
    const gain = addXp(message.guildId, message.author.id, 15 + Math.floor(Math.random() * 11));
    if (gain.leveledUp) {
      await message.channel.send({ content: `🎉 ${message.author} reached **level ${gain.newLevel}**!` }).catch(() => {});
    }
  } catch (e) {
    console.error("[leveling] db write failed:", (e as Error).message);
  }
};
