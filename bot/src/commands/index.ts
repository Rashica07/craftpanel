import { Collection } from "discord.js";
import type { Command } from "./types.js";
import { status } from "./status.js";
import { manage } from "./manage.js";
import { moderation } from "./moderation.js";
import { rank } from "./rank.js";

export const commands: Command[] = [status, manage, moderation, rank];

export const commandMap = new Collection<string, Command>(commands.map((c) => [c.data.name, c]));
