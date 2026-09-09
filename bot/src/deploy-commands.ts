/**
 * Registers the slash commands with Discord. Run once after adding or changing
 * a command: `npm run deploy`.
 *
 * With GUILD_ID set, commands register to that one guild and appear instantly
 * (use this in development). Without it, they register globally and can take
 * up to an hour to show up everywhere.
 */
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";

const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(config.discord.token);

try {
  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body });
    console.log(`Registered ${body.length} guild commands to ${config.discord.guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    console.log(`Registered ${body.length} global commands.`);
  }
} catch (err) {
  console.error("Command registration failed:", err);
  process.exit(1);
}
