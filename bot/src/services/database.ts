/**
 * Leveling store — a single local SQLite file via the built-in `node:sqlite`
 * (no native module to compile). One row per (guild, user): cumulative XP,
 * derived level, message count.
 *
 * Level curve follows the spec: the XP needed to *reach* level L is 100·L².
 * So level(xp) = floor(sqrt(xp / 100)).
 */
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

export interface RankRow {
  xp: number;
  level: number;
  messages: number;
  rank: number; // 1-based position on the guild leaderboard
}

export interface LeaderboardEntry {
  userId: string;
  xp: number;
  level: number;
  messages: number;
}

export function xpForLevel(level: number): number {
  return 100 * level * level;
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

let db: DatabaseSync | null = null;

export function openDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(config.leveling.dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      xp         INTEGER NOT NULL DEFAULT 0,
      level      INTEGER NOT NULL DEFAULT 0,
      messages   INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_levels_guild_xp ON levels (guild_id, xp DESC);
  `);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export interface XpGain {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  xp: number;
}

/** Add XP for one message. Returns whether the user crossed a level boundary. */
export function addXp(guildId: string, userId: string, amount: number): XpGain {
  const d = openDb();
  const row = d.prepare("SELECT xp, level FROM levels WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as
    | { xp: number; level: number }
    | undefined;

  const oldXp = row?.xp ?? 0;
  const oldLevel = row?.level ?? 0;
  const newXp = oldXp + amount;
  const newLevel = levelForXp(newXp);

  d.prepare(
    `INSERT INTO levels (guild_id, user_id, xp, level, messages, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       xp = excluded.xp,
       level = excluded.level,
       messages = levels.messages + 1,
       updated_at = excluded.updated_at`,
  ).run(guildId, userId, newXp, newLevel, Date.now());

  return { leveledUp: newLevel > oldLevel, oldLevel, newLevel, xp: newXp };
}

export function getRank(guildId: string, userId: string): RankRow | null {
  const d = openDb();
  const row = d.prepare("SELECT xp, level, messages FROM levels WHERE guild_id = ? AND user_id = ?").get(guildId, userId) as
    | { xp: number; level: number; messages: number }
    | undefined;
  if (!row) return null;

  const ahead = d.prepare("SELECT COUNT(*) AS n FROM levels WHERE guild_id = ? AND xp > ?").get(guildId, row.xp) as {
    n: number;
  };
  return { ...row, rank: ahead.n + 1 };
}

export function getLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
  const d = openDb();
  const rows = d
    .prepare("SELECT user_id, xp, level, messages FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?")
    .all(guildId, limit) as Array<{ user_id: string; xp: number; level: number; messages: number }>;
  return rows.map((r) => ({ userId: r.user_id, xp: r.xp, level: r.level, messages: r.messages }));
}
