/**
 * /rank — MEE6-style score for yourself or another member.
 * /rank top — the guild leaderboard.
 * XP is earned in message.ts (one grant per XP_COOLDOWN_SEC per user).
 */
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";
import { getLeaderboard, getRank, levelForXp, xpForLevel } from "../services/database.js";

function progressBar(current: number, needed: number, width = 16): string {
  const filled = needed <= 0 ? width : Math.round((current / needed) * width);
  return "▰".repeat(Math.max(0, Math.min(width, filled))) + "▱".repeat(Math.max(0, width - filled));
}

export const rank: Command = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Your leveling score")
    .addSubcommand((s) =>
      s
        .setName("show")
        .setDescription("Show a rank card")
        .addUserOption((o) => o.setName("member").setDescription("Whose card (defaults to you)")),
    )
    .addSubcommand((s) =>
      s.setName("top").setDescription("Show the server leaderboard"),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: "Guild-only command.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();

    if (interaction.options.getSubcommand() === "top") {
      const board = getLeaderboard(interaction.guild.id, 10);
      if (board.length === 0) {
        await interaction.editReply("No one's earned XP yet.");
        return;
      }
      const medals = ["🥇", "🥈", "🥉"];
      const lines = board.map((e, i) => `${medals[i] ?? `\`#${i + 1}\``} <@${e.userId}> — level **${e.level}** · ${e.xp} XP`);
      const embed = new EmbedBuilder()
        .setTitle(`${interaction.guild.name} — leaderboard`)
        .setColor(0x818cf8)
        .setDescription(lines.join("\n"));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const target = interaction.options.getUser("member") ?? interaction.user;
    const row = getRank(interaction.guild.id, target.id);
    if (!row) {
      await interaction.editReply(`${target.id === interaction.user.id ? "You have" : `**${target.tag}** has`} no XP yet.`);
      return;
    }

    const level = row.level || levelForXp(row.xp);
    const floor = xpForLevel(level);
    const ceil = xpForLevel(level + 1);
    const into = row.xp - floor;
    const span = ceil - floor;

    const embed = new EmbedBuilder()
      .setTitle(`${target.username} — rank card`)
      .setThumbnail(target.displayAvatarURL())
      .setColor(0x818cf8)
      .addFields(
        { name: "Level", value: `**${level}**`, inline: true },
        { name: "Rank", value: `#${row.rank}`, inline: true },
        { name: "Messages", value: `${row.messages}`, inline: true },
        { name: "Progress", value: `${progressBar(into, span)}\n${into} / ${span} XP  ·  ${row.xp} total` },
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
