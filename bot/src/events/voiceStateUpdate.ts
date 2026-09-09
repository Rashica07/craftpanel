/**
 * Dynamic "Join to Create" voice channels.
 *
 * Join the configured creator channel → the bot clones it into a lobby named
 * after you, drags you in, and deletes the lobby the moment it's empty again.
 * Temp-channel ids are tracked in memory; `reconcileOrphans` (called from
 * ready.ts) also sweeps up any left behind by a previous run.
 */
import { ChannelType, Events, type Client, type VoiceBasedChannel } from "discord.js";
import type { BotEvent } from "./types.js";
import { config } from "../config.js";

const LOBBY_PREFIX = "💬 ";
const tempChannels = new Set<string>();

async function deleteIfEmpty(channel: VoiceBasedChannel | null): Promise<void> {
  if (!channel || !tempChannels.has(channel.id)) return;
  if (channel.members.size > 0) return;
  tempChannels.delete(channel.id);
  await channel.delete("Join-to-Create lobby empty").catch((e) => {
    console.error("[voice] couldn't delete lobby:", (e as Error).message);
  });
}

export const name = Events.VoiceStateUpdate;

export const execute: BotEvent<Events.VoiceStateUpdate>["execute"] = async (oldState, newState) => {
  const creatorId = config.voice.creatorChannelId;
  if (!creatorId) return;

  // someone joined the hub → spin up their lobby
  if (newState.channelId === creatorId && newState.member) {
    try {
      const hub = newState.channel;
      const parentId = config.voice.lobbyCategoryId ?? hub?.parentId ?? undefined;
      const lobby = await newState.guild.channels.create({
        name: `${LOBBY_PREFIX}${newState.member.displayName}`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: parentId,
        bitrate: hub?.type === ChannelType.GuildVoice ? hub.bitrate : undefined,
      });
      tempChannels.add(lobby.id);
      await newState.member.voice.setChannel(lobby).catch(async (e) => {
        console.error("[voice] couldn't move member:", (e as Error).message);
        await deleteIfEmpty(lobby);
      });
    } catch (e) {
      console.error("[voice] couldn't create lobby:", (e as Error).message);
    }
  }

  // someone left a channel → bin it if it was a now-empty temp lobby
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await deleteIfEmpty(oldState.channel);
  }
};

/**
 * Boot-time cleanup: delete our own empty leftover lobbies, re-track the
 * non-empty ones. Ours are recognised by the "💬 " name prefix.
 */
export async function reconcileOrphans(client: Client): Promise<void> {
  if (!config.voice.creatorChannelId) return;
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;
    for (const ch of channels.values()) {
      if (ch?.type !== ChannelType.GuildVoice) continue;
      if (ch.id === config.voice.creatorChannelId || !ch.name.startsWith(LOBBY_PREFIX)) continue;
      if (ch.members.size === 0) await ch.delete("Join-to-Create orphan cleanup").catch(() => {});
      else tempChannels.add(ch.id);
    }
  }
}
