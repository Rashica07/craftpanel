/**
 * Optional one-shot scaffolder for a **fresh/empty** Discord server: a
 * `Verified` role, a Welcome / Community / Voice category set, and a permanent
 * "Click to verify" button. The button's runtime half is
 * `events/interactionCreate.ts`.
 *
 *   npm run setup-server              # DRY RUN — prints what it would create
 *   npm run setup-server -- --confirm # actually create the missing pieces
 *
 * Safety, learned the hard way:
 *   - dry-run unless `--confirm`,
 *   - NEVER touches @everyone or any existing role/channel — only adds what's
 *     missing, matched by exact name (idempotent: safe to re-run),
 *   - no server-wide permission edits, no channel deletion, no `--wipe`.
 *
 * If your server already has channels, you almost certainly don't want this —
 * just set CREATOR_CHANNEL_ID / MOD_LOG_CHANNEL_ID in .env to existing
 * channels and post the verify button wherever you like.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  type CategoryChannel,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import { ACCENT, VERIFIED_ROLE_NAME, VERIFY_BUTTON_ID } from "../constants.js";

const CONFIRM = process.argv.includes("--confirm");
const tag = CONFIRM ? "" : " [dry run]";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

async function ensureCategory(guild: Guild, name: string): Promise<CategoryChannel | null> {
  const existing = guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildCategory);
  if (existing) {
    console.log(`  · category "${name}" already exists`);
    return existing as CategoryChannel;
  }
  console.log(`  + create category "${name}"${tag}`);
  if (!CONFIRM) return null;
  return (await guild.channels.create({ name, type: ChannelType.GuildCategory })) as CategoryChannel;
}

async function ensureChannel(
  guild: Guild,
  name: string,
  type: ChannelType.GuildText | ChannelType.GuildVoice,
  parent: CategoryChannel | null,
) {
  const existing = guild.channels.cache.find((c) => c.name === name && c.type === type);
  if (existing) {
    console.log(`  · channel "${name}" already exists`);
    return existing;
  }
  console.log(`  + create channel "${name}"${tag}`);
  if (!CONFIRM) return null;
  return guild.channels.create({ name, type, parent: parent?.id });
}

client.once("clientReady", async () => {
  console.log(`🤖 ${client.user?.tag} — setup-server${CONFIRM ? "" : " (dry run — pass --confirm to apply)"}`);

  const guildId = config.discord.guildId;
  if (!guildId) {
    console.error("❌ Set GUILD_ID in .env first.");
    process.exit(1);
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error("❌ Server not found — is the bot invited?");
    process.exit(1);
  }

  // populate caches so the "already exists" checks actually work
  await guild.channels.fetch();
  await guild.roles.fetch();

  try {
    console.log(`\nScaffolding "${guild.name}":\n`);

    // Verified role
    if (guild.roles.cache.some((r) => r.name === VERIFIED_ROLE_NAME)) {
      console.log(`  · role "${VERIFIED_ROLE_NAME}" already exists`);
    } else {
      console.log(`  + create role "${VERIFIED_ROLE_NAME}"${tag}`);
      if (CONFIRM) await guild.roles.create({ name: VERIFIED_ROLE_NAME, color: ACCENT, reason: "verification role" });
    }

    const welcome = await ensureCategory(guild, "📌 WELCOME ZONE");
    const community = await ensureCategory(guild, "💬 COMMUNITY AREA");
    const voice = await ensureCategory(guild, "🔊 VOICE CHANNELS");

    const rules = await ensureChannel(guild, "welcome-rules", ChannelType.GuildText, welcome);
    const alerts = await ensureChannel(guild, "bot-alerts", ChannelType.GuildText, welcome);
    await ensureChannel(guild, "general", ChannelType.GuildText, community);
    const modLog = await ensureChannel(guild, "mod-log", ChannelType.GuildText, community);
    await ensureChannel(guild, "bot-commands", ChannelType.GuildText, community);
    const creator = await ensureChannel(guild, "➕ Create Lobby", ChannelType.GuildVoice, voice);

    // verify button — only when applying, only if not already posted
    if (CONFIRM && rules && rules.type === ChannelType.GuildText) {
      const recent = await rules.messages.fetch({ limit: 20 }).catch(() => null);
      const posted = recent?.some(
        (m) =>
          m.author.id === client.user?.id &&
          m.components.some((r) => "components" in r && r.components.some((cmp) => "customId" in cmp && cmp.customId === VERIFY_BUTTON_ID)),
      );
      if (!posted) {
        await rules.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔒 Verification required")
              .setDescription("Press the button to get the **Verified** role.")
              .setColor(ACCENT),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel("Click to verify").setStyle(ButtonStyle.Success),
            ),
          ],
        });
        console.log("  + posted verify button in #welcome-rules");
      }
    }

    if (CONFIRM) {
      console.log("\n✅ Done. Paste into bot/.env:");
      if (creator) console.log(`   CREATOR_CHANNEL_ID=${creator.id}`);
      if (modLog) console.log(`   MOD_LOG_CHANNEL_ID=${modLog.id}`);
      if (alerts) console.log(`   # bot-alerts: ${alerts.id}`);
    } else {
      console.log("\n(nothing changed — re-run with `-- --confirm` to apply)");
    }
    process.exit(0);
  } catch (error) {
    console.error("❌ setup-server failed:", error);
    process.exit(1);
  }
});

client.login(config.discord.token);
