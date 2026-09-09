/**
 * /status — where to find this machine and what's running on it.
 * Admin-only: it exposes your public IP and tunnel address.
 */
import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";
import { craftPanel } from "../services/craftPanel.js";
import { formatUptime, getPublicIp, readTunnelAddresses } from "../services/system.js";

export const status: Command = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Public IP, tunnel address and server uptimes for this machine")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [ip, servers] = await Promise.all([getPublicIp(), craftPanel.listServers()]);
    const tunnels = readTunnelAddresses();

    const embed = new EmbedBuilder()
      .setTitle("CraftPanel — machine status")
      .setColor(servers.ok ? 0x4ade80 : 0xf87171)
      .setTimestamp();

    embed.addFields({
      name: "Public address",
      value: ip ? `\`${ip}:25565\`` : "_couldn't detect (offline?)_",
    });

    embed.addFields({
      name: "Active tunnel",
      value: tunnels.length ? tunnels.map((t) => `\`${t}\``).join("\n") : "_none detected_",
    });

    if (!servers.ok) {
      embed.addFields({ name: "Servers", value: `⚠️ ${servers.error}` });
    } else if (servers.data.length === 0) {
      embed.addFields({ name: "Servers", value: "_no servers configured_" });
    } else {
      const lines = servers.data.map((s) => {
        const running = /running/i.test(s.status);
        const dot = running ? "🟢" : /crash/i.test(s.status) ? "🔴" : "⚫";
        const meta = [s.server_type, s.mc_version].filter(Boolean).join(" ");
        const tag = meta ? ` _(${meta})_` : "";
        const up = running ? ` · up ${formatUptime(s.started_at)}` : "";
        return `${dot} **${s.name}**${tag} — ${s.status}${up}`;
      });
      embed.addFields({ name: `Servers (${servers.data.length})`, value: lines.join("\n").slice(0, 1024) });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
