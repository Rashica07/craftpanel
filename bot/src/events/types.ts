import type { ClientEvents } from "discord.js";

/**
 * Shape every file in this directory exports. `index.ts` scans the folder at
 * boot and wires each one up with `client.on(name, execute)` (or `client.once`
 * when `once` is true).
 */
export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => unknown;
}
