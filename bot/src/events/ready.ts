import { Events } from "discord.js";
import type { BotEvent } from "./types.js";
import { describeConfig } from "../config.js";
import { reconcileOrphans } from "./voiceStateUpdate.js";

export const name = Events.ClientReady;
export const once = true;

export const execute: BotEvent<Events.ClientReady>["execute"] = async (client) => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`  ${describeConfig()}`);
  await reconcileOrphans(client).catch((e) => console.error("[voice] orphan sweep failed:", (e as Error).message));
};
