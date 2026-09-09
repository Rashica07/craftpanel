/**
 * /manage — start / stop / restart a Minecraft server through CraftPanel's
 * Remote API. Admin-only. Every network call is a PanelResult, so a closed or
 * sleeping panel produces a tidy "couldn't reach" reply, never a crash.
 */
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";
import { craftPanel, resolveServer } from "../services/craftPanel.js";

export const manage: Command = {
  data: new SlashCommandBuilder()
    .setName("manage")
    .setDescription("Start, stop or restart a server via CraftPanel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start a server")
        .addStringOption((o) => o.setName("server").setDescription("Server name or id").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("stop")
        .setDescription("Stop a server")
        .addStringOption((o) => o.setName("server").setDescription("Server name or id").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("restart")
        .setDescription("Stop then start a server")
        .addStringOption((o) => o.setName("server").setDescription("Server name or id").setRequired(true)),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getSubcommand();
    const query = interaction.options.getString("server", true);

    const resolved = await resolveServer(query);
    if (!resolved.ok) {
      await interaction.editReply(`⚠️ ${resolved.error}`);
      return;
    }
    const server = resolved.data;

    if (action === "start") {
      const r = await craftPanel.startServer(server.id);
      await interaction.editReply(r.ok ? `▶️ Starting **${server.name}**.` : `⚠️ ${r.error}`);
      return;
    }

    if (action === "stop") {
      const r = await craftPanel.stopServer(server.id);
      await interaction.editReply(r.ok ? `⏹️ Stopping **${server.name}**.` : `⚠️ ${r.error}`);
      return;
    }

    // restart
    const stop = await craftPanel.stopServer(server.id);
    if (!stop.ok) {
      await interaction.editReply(`⚠️ Couldn't stop **${server.name}**: ${stop.error}`);
      return;
    }
    await new Promise((res) => setTimeout(res, 3_000));
    const start = await craftPanel.startServer(server.id);
    await interaction.editReply(
      start.ok ? `🔄 Restarted **${server.name}**.` : `⚠️ Stopped **${server.name}** but couldn't start it again: ${start.error}`,
    );
  },
};
