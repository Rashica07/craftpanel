/**
 * interactionCreate — the single funnel for everything the gateway sends back:
 *   • chat-input slash commands  → dispatched to `commands/`
 *   • the "Click to verify" button (dropped by scripts/setupServer.ts)
 *     → grants the Verified role and DMs a private confirmation
 */
import { Events, MessageFlags, PermissionFlagsBits, type Interaction } from "discord.js";
import type { BotEvent } from "./types.js";
import { commandMap } from "../commands/index.js";
import { VERIFIED_ROLE_NAME, VERIFY_BUTTON_ID } from "../constants.js";

export const name = Events.InteractionCreate;

export const execute: BotEvent<Events.InteractionCreate>["execute"] = async (interaction: Interaction) => {
  // ── slash commands ────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[command:${interaction.commandName}]`, err);
      const content = "Something went wrong running that.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  // ── verification button ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === VERIFY_BUTTON_ID) {
    if (!interaction.inCachedGuild()) return;
    const { guild, member } = interaction;

    try {
      const verifiedRole = guild.roles.cache.find((r) => r.name === VERIFIED_ROLE_NAME);
      if (!verifiedRole) {
        await interaction.reply({
          content: `❌ Configuration error: the "${VERIFIED_ROLE_NAME}" role doesn't exist. An admin needs to run \`npm run setup-server\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (member.roles.cache.has(verifiedRole.id)) {
        await interaction.reply({ content: "ℹ️ You're already verified and have access.", flags: MessageFlags.Ephemeral });
        return;
      }

      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || verifiedRole.position >= me.roles.highest.position) {
        await interaction.reply({
          content: "❌ I can't assign that role — check my **Manage Roles** permission and that my role sits above Verified.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await member.roles.add(verifiedRole, "Self-verification button");
      await interaction.reply({
        content: "✅ **Verification successful!** The community channels are now unlocked for you. Welcome!",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("[verify] interaction handler failed:", error);
      const content = "❌ An internal error occurred while assigning your role. Try again later.";
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
};
