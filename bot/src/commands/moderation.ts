/**
 * /moderation kick|ban|timeout — Dyno-style basics. Each action:
 *  - re-checks the invoker's permission (Discord gates the command too, but a
 *    belt-and-braces check keeps the intent obvious),
 *  - checks the bot can actually act on the target (role hierarchy),
 *  - writes an audit line to the mod-log channel if one is configured.
 */
import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { Command } from "./types.js";
import { config } from "../config.js";

const MAX_TIMEOUT_MIN = 40_320; // Discord's ceiling: 28 days

async function logAction(
  interaction: ChatInputCommandInteraction,
  action: string,
  targetTag: string,
  targetId: string,
  reason: string,
  extra?: string,
): Promise<void> {
  if (!config.moderation.logChannelId || !interaction.guild) return;
  try {
    const ch = await interaction.guild.channels.fetch(config.moderation.logChannelId);
    if (!ch?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(`Moderation — ${action}`)
      .setColor(0xf59e0b)
      .addFields(
        { name: "Target", value: `${targetTag} (\`${targetId}\`)`, inline: true },
        { name: "Moderator", value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
        { name: "Reason", value: reason || "_none given_" },
      )
      .setTimestamp();
    if (extra) embed.addFields({ name: "Details", value: extra });
    await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error("[moderation] couldn't write to mod-log:", (err as Error).message);
  }
}

function actionable(interaction: ChatInputCommandInteraction, target: GuildMember): string | null {
  const me = interaction.guild?.members.me;
  if (!me) return "I'm not in this guild properly.";
  if (target.id === interaction.user.id) return "You can't moderate yourself.";
  if (target.id === me.id) return "I'm not going to moderate myself.";
  if (!target.moderatable) return "That member is above me in the role list — I can't touch them.";
  const invoker = interaction.member as GuildMember | null;
  if (invoker && "roles" in invoker && target.roles.highest.position >= invoker.roles.highest.position) {
    return "That member is at or above your highest role.";
  }
  return null;
}

export const moderation: Command = {
  data: new SlashCommandBuilder()
    .setName("moderation")
    .setDescription("Kick, ban or time out a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName("kick")
        .setDescription("Kick a member")
        .addUserOption((o) => o.setName("member").setDescription("Who").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Why")),
    )
    .addSubcommand((s) =>
      s
        .setName("ban")
        .setDescription("Ban a member")
        .addUserOption((o) => o.setName("member").setDescription("Who").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Why"))
        .addIntegerOption((o) =>
          o.setName("delete_days").setDescription("Delete this many days of their messages (0–7)").setMinValue(0).setMaxValue(7),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("timeout")
        .setDescription("Time a member out")
        .addUserOption((o) => o.setName("member").setDescription("Who").setRequired(true))
        .addIntegerOption((o) =>
          o.setName("minutes").setDescription("How long (1 to reset)").setRequired(true).setMinValue(0).setMaxValue(MAX_TIMEOUT_MIN),
        )
        .addStringOption((o) => o.setName("reason").setDescription("Why")),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
      await interaction.editReply("Guild-only command.");
      return;
    }

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("member", true);
    const reason = interaction.options.getString("reason") ?? "";
    const auditReason = `${interaction.user.tag}: ${reason || "no reason given"}`.slice(0, 512);

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) {
      await interaction.editReply("That user isn't a member of this server.");
      return;
    }

    const blocked = actionable(interaction, target);
    if (blocked) {
      await interaction.editReply(`⚠️ ${blocked}`);
      return;
    }

    try {
      if (sub === "kick") {
        if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers)) {
          await interaction.editReply("I don't have the Kick Members permission.");
          return;
        }
        await target.kick(auditReason);
        await interaction.editReply(`👢 Kicked **${user.tag}**.`);
        await logAction(interaction, "Kick", user.tag, user.id, reason);
        return;
      }

      if (sub === "ban") {
        if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
          await interaction.editReply("I don't have the Ban Members permission.");
          return;
        }
        const days = interaction.options.getInteger("delete_days") ?? 0;
        await target.ban({ reason: auditReason, deleteMessageSeconds: days * 86_400 });
        await interaction.editReply(`🔨 Banned **${user.tag}**.`);
        await logAction(interaction, "Ban", user.tag, user.id, reason, days ? `Purged ${days}d of messages` : undefined);
        return;
      }

      // timeout
      if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.editReply("I don't have the Moderate Members permission.");
        return;
      }
      const minutes = interaction.options.getInteger("minutes", true);
      if (minutes === 0) {
        await target.timeout(null, auditReason);
        await interaction.editReply(`⏱️ Cleared the timeout on **${user.tag}**.`);
        await logAction(interaction, "Timeout cleared", user.tag, user.id, reason);
        return;
      }
      await target.timeout(minutes * 60_000, auditReason);
      await interaction.editReply(`⏱️ Timed out **${user.tag}** for ${minutes} min.`);
      await logAction(interaction, "Timeout", user.tag, user.id, reason, `${minutes} minutes`);
    } catch (err) {
      await interaction.editReply(`Discord refused that: ${(err as Error).message}`);
    }
  },
};
