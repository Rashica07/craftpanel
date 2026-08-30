/**
 * Console command autofill data.
 *
 * Deliberately vanilla/Bukkit-core only — the ~50 commands that exist the
 * same way across Vanilla, Paper, Spigot, Fabric and Forge. Plugin- or
 * mod-specific commands aren't in here; there's no way to know what's
 * installed without asking the server, and a wrong suggestion is worse than
 * no suggestion.
 *
 * `args[i]` is the suggestion list for the (0-indexed) argument in position
 * `i`, after the command name. `["<player>"]` is a sentinel meaning "offer
 * the players who are currently online" instead of a fixed literal list —
 * resolved by `suggestCommand` using the `players` it's given. A position
 * with no entry in `args` (including everything past the array's length)
 * gets no suggestions — free typing, as it should be for a message, a
 * coordinate, an item id, etc.
 */

export interface McCommand {
  name: string;
  usage: string;
  help: string;
  args?: (readonly string[])[];
}

const GAMEMODES = ["survival", "creative", "adventure", "spectator"] as const;
const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;
const PLAYER = ["<player>"] as const;

export const MC_COMMANDS: McCommand[] = [
  { name: "help", usage: "help [command]", help: "List commands, or detail one." },
  { name: "list", usage: "list", help: "Show who's online." },
  { name: "say", usage: "say <message>", help: "Broadcast a message from the server." },
  { name: "tell", usage: "tell <player> <message>", help: "Whisper a player.", args: [PLAYER] },
  { name: "msg", usage: "msg <player> <message>", help: "Whisper a player.", args: [PLAYER] },
  { name: "w", usage: "w <player> <message>", help: "Whisper a player.", args: [PLAYER] },
  { name: "me", usage: "me <action>", help: "Third-person action message." },

  { name: "gamemode", usage: "gamemode <mode> [player]", help: "Change a player's game mode.", args: [GAMEMODES, PLAYER] },
  { name: "defaultgamemode", usage: "defaultgamemode <mode>", help: "Game mode new players spawn into.", args: [GAMEMODES] },
  { name: "difficulty", usage: "difficulty <level>", help: "Set world difficulty.", args: [DIFFICULTIES] },
  { name: "weather", usage: "weather <clear|rain|thunder> [seconds]", help: "Force the weather.", args: [["clear", "rain", "thunder"]] },
  { name: "time", usage: "time <set|add|query> <value>", help: "Change or check the time.", args: [["set", "add", "query"], ["day", "noon", "night", "midnight", "0", "6000", "12000", "18000"]] },

  { name: "tp", usage: "tp <target> [destination]", help: "Teleport a player.", args: [PLAYER, PLAYER] },
  { name: "teleport", usage: "teleport <target> [destination]", help: "Teleport a player.", args: [PLAYER, PLAYER] },
  { name: "kill", usage: "kill [target]", help: "Kill an entity — @s for yourself.", args: [[...PLAYER, "@s", "@e", "@a"]] },

  { name: "kick", usage: "kick <player> [reason]", help: "Remove a player from the server.", args: [PLAYER] },
  { name: "ban", usage: "ban <player> [reason]", help: "Ban a player by name.", args: [PLAYER] },
  { name: "ban-ip", usage: "ban-ip <player|ip> [reason]", help: "Ban by IP address.", args: [PLAYER] },
  { name: "pardon", usage: "pardon <player>", help: "Lift a ban.", args: [PLAYER] },
  { name: "pardon-ip", usage: "pardon-ip <ip>", help: "Lift an IP ban." },
  { name: "banlist", usage: "banlist [players|ips]", help: "List current bans.", args: [["players", "ips"]] },
  { name: "whitelist", usage: "whitelist <add|remove|on|off|list|reload>", help: "Manage the whitelist.", args: [["add", "remove", "on", "off", "list", "reload"], PLAYER] },
  { name: "op", usage: "op <player>", help: "Grant operator status.", args: [PLAYER] },
  { name: "deop", usage: "deop <player>", help: "Revoke operator status.", args: [PLAYER] },

  { name: "give", usage: "give <player> <item> [amount]", help: "Give an item.", args: [PLAYER] },
  { name: "clear", usage: "clear [player] [item] [amount]", help: "Clear an inventory.", args: [PLAYER] },
  { name: "effect", usage: "effect <give|clear> <player> <effect> [seconds] [amplifier]", help: "Give or clear a potion effect.", args: [["give", "clear"], PLAYER] },
  { name: "enchant", usage: "enchant <player> <enchantment> [level]", help: "Enchant a player's held item.", args: [PLAYER] },
  { name: "xp", usage: "xp <add|set|query> <player> [amount] [points|levels]", help: "Give or check experience.", args: [["add", "set", "query"], PLAYER] },
  { name: "experience", usage: "experience <add|set|query> <player> [amount]", help: "Give or check experience.", args: [["add", "set", "query"], PLAYER] },

  { name: "gamerule", usage: "gamerule <rule> [value]", help: "Change a world rule.", args: [["keepInventory", "doDaylightCycle", "doMobSpawning", "mobGriefing", "doWeatherCycle", "doFireTick", "naturalRegeneration", "randomTickSpeed", "announceAdvancements", "commandBlockOutput", "doInsomnia", "fallDamage", "fireDamage", "drowningDamage", "doImmediateRespawn", "spawnRadius", "maxEntityCramming", "doTraderSpawning"]] },
  { name: "summon", usage: "summon <entity> [pos]", help: "Spawn an entity." },
  { name: "setblock", usage: "setblock <pos> <block>", help: "Place a single block." },
  { name: "fill", usage: "fill <pos1> <pos2> <block>", help: "Fill a region with a block." },
  { name: "locate", usage: "locate <structure|biome|poi> <name>", help: "Find the nearest of something.", args: [["structure", "biome", "poi"]] },

  { name: "seed", usage: "seed", help: "Show the world seed." },
  { name: "spawnpoint", usage: "spawnpoint [player] [pos]", help: "Set a player's personal spawn.", args: [PLAYER] },
  { name: "setworldspawn", usage: "setworldspawn [pos]", help: "Set the world's spawn point." },
  { name: "worldborder", usage: "worldborder <set|add|center|damage|warning|get>", help: "Manage the world border.", args: [["set", "add", "center", "damage", "warning", "get"]] },
  { name: "forceload", usage: "forceload <add|remove|query> [pos]", help: "Keep chunks always loaded.", args: [["add", "remove", "query"]] },
  { name: "datapack", usage: "datapack <enable|disable|list> [name]", help: "Manage datapacks.", args: [["enable", "disable", "list"]] },
  { name: "function", usage: "function <name>", help: "Run a datapack function." },
  { name: "advancement", usage: "advancement <grant|revoke> <player> <target>", help: "Grant or revoke an advancement.", args: [["grant", "revoke"], PLAYER] },

  { name: "scoreboard", usage: "scoreboard <objectives|players|teams>", help: "Manage the scoreboard.", args: [["objectives", "players", "teams"]] },
  { name: "team", usage: "team <list|add|remove|join|leave|modify> [team]", help: "Manage teams.", args: [["list", "add", "remove", "join", "leave", "modify"]] },
  { name: "title", usage: "title <player> <title|subtitle|actionbar|clear|reset|times>", help: "Show a title on screen.", args: [PLAYER, ["title", "subtitle", "actionbar", "clear", "reset", "times"]] },
  { name: "playsound", usage: "playsound <sound> <source> <player>", help: "Play a sound to a player." },
  { name: "particle", usage: "particle <name> [pos]", help: "Spawn a particle effect." },

  { name: "save-all", usage: "save-all", help: "Force-save the world now." },
  { name: "save-off", usage: "save-off", help: "Pause autosaving (before copying the folder)." },
  { name: "save-on", usage: "save-on", help: "Resume autosaving." },
  { name: "reload", usage: "reload", help: "Reload datapacks and config — can be risky." },
  { name: "stop", usage: "stop", help: "Shut the server down gracefully." },
  { name: "execute", usage: "execute <subcommand>…", help: "Run a command with conditions applied." },
];

export interface CommandSuggestion {
  /** The literal token to insert — a command name, an enum value, or a player name. */
  value: string;
  /** Only set for a top-level command suggestion; shown as usage help. */
  usage?: string;
}

function resolveArgOptions(
  argDef: readonly string[] | undefined,
  players: string[] | undefined,
): string[] {
  if (!argDef) return [];
  if (argDef.length === 1 && argDef[0] === "<player>") return players ?? [];
  return [...argDef];
}

/**
 * Suggestions for whatever token the user is currently mid-typing in `value`.
 * Returns [] the moment there's nothing left to usefully add — a single
 * suggestion that already exactly matches what's typed closes the list
 * rather than nagging.
 */
export function suggestCommand(
  value: string,
  players?: string[],
): CommandSuggestion[] {
  const endsWithSpace = /\s$/.test(value);
  const tokens = value.trim().length ? value.trim().split(/\s+/) : [];
  if (tokens.length === 0) return [];

  // still typing the command name itself
  if (tokens.length === 1 && !endsWithSpace) {
    const partial = tokens[0].toLowerCase();
    const hits = MC_COMMANDS.filter((c) => c.name.startsWith(partial));
    if (hits.length === 1 && hits[0].name === partial) return [];
    return hits
      .slice(0, 8)
      .map((c) => ({ value: c.name, usage: c.usage }));
  }

  const cmd = MC_COMMANDS.find((c) => c.name === tokens[0].toLowerCase());
  if (!cmd) return [];

  // position in `args` we're completing: everything after the command name,
  // 0-indexed, counting the in-progress token once a trailing space starts it
  const argIndex = endsWithSpace ? tokens.length - 1 : tokens.length - 2;
  const partial = endsWithSpace ? "" : tokens[tokens.length - 1].toLowerCase();
  const options = resolveArgOptions(cmd.args?.[argIndex], players);
  if (!options.length) return [];

  const hits = options.filter((o) => o.toLowerCase().startsWith(partial));
  if (hits.length === 1 && hits[0].toLowerCase() === partial) return [];
  return hits.slice(0, 8).map((v) => ({ value: v }));
}

/**
 * Applies a picked suggestion to the current input value: replaces the token
 * being completed and appends a trailing space so the user can keep going.
 */
export function applyCommandSuggestion(value: string, suggestion: string): string {
  const endsWithSpace = /\s$/.test(value);
  const tokens = value.trim().length ? value.trim().split(/\s+/) : [];
  const keep = endsWithSpace ? tokens.length : Math.max(0, tokens.length - 1);
  const base = tokens.slice(0, keep).join(" ");
  return (base ? `${base} ` : "") + suggestion + " ";
}
