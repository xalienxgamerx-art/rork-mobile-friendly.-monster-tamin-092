import { NAME_A, NAME_B } from "./data";
import { getFactions } from "./factions";
import { hash2 } from "./rng";
import { isSettlement, settlementSeed, settlementTier } from "./settlement";
import type { Feature } from "./world";
import { getWorld } from "./world";
import type { GameState } from "./types";

/**
 * The Expeditioner's Guild — an independent organization of explorers,
 * researchers and field workers, deliberately separate from the beast-tamer
 * associations (factions.ts).
 *
 * Where associations govern the taming profession — licensing, rankings,
 * sanctioned rings — the Guild organizes exploration: mapping, surveying,
 * ruin investigation, artifact recovery and dangerous fieldwork. The two may
 * cooperate and commission one another (expeditions.ts), but neither owns
 * the other, and their books never mix: Guild standing lives in its own
 * reputation scope, keyed by chapter.
 *
 * Like everything else in the world, chapters are a pure function of the
 * seed: every town and city raises a guild hall (the `guildhall` building in
 * its street plan), and each hall is a chapter. Nothing about them is
 * persisted — a save stores only what the player has done with them.
 */

export interface GuildChapter {
  /** Stable id `g:x:y` — also the key of the chapter's standing ledger. */
  id: string;
  /** Display name, e.g. "Tansymere Chapter". */
  name: string;
  /** The full organization, for prose: "the Expeditioner's Guild". */
  org: string;
  /** The settlement that hosts the hall. */
  settlement: Feature;
  /** The nation whose lands the hall stands in (informational). */
  nationId: string | null;
  /** The hall's clerk — deterministic from the seed, like every other soul. */
  clerk: string;
}

export const GUILD_ORG = "the Expeditioner's Guild";

let guildSingleton: { seed: number; byKey: Map<string, GuildChapter> } | null = null;

/** All guild chapters of a world, one instance per seed (like getWorld / getFactions). */
export function getGuilds(seed: number): Map<string, GuildChapter> {
  if (!guildSingleton || guildSingleton.seed !== seed) {
    const byKey = new Map<string, GuildChapter>();
    const world = getWorld(seed);
    // every town and city raises a guild hall; hamlets keep only notice posts
    for (const f of world.allFeatures()) {
      if (!isSettlement(f)) continue;
      const tier = settlementTier(f);
      if (tier !== "town" && tier !== "city") continue;
      if (!world.settlementLayout(f).building("guildhall")) continue;
      const h = hash2(settlementSeed(seed, f) ^ 0x6e1d, f.x, f.y);
      byKey.set(`${f.x}:${f.y}`, {
        id: `g:${f.x}:${f.y}`,
        name: `${f.name} Chapter`,
        org: GUILD_ORG,
        settlement: f,
        nationId: getFactions(seed, world).nationAt(f.x, f.y)?.id ?? null,
        clerk: `${NAME_A[(h >>> 3) % NAME_A.length]}${NAME_B[(h >>> 11) % NAME_B.length]}`,
      });
    }
    guildSingleton = { seed, byKey };
  }
  return guildSingleton.byKey;
}

/** The guild chapter whose hall stands in this settlement, or null. */
export function guildAt(seed: number, f: Feature | null | undefined): GuildChapter | null {
  if (!f || !isSettlement(f)) return null;
  const tier = settlementTier(f);
  if (tier !== "town" && tier !== "city") return null;
  return getGuilds(seed).get(`${f.x}:${f.y}`) ?? null;
}

/** Chapter lookup by key, for records that outlive the map cache. */
export function guildByKey(seed: number, key: string): GuildChapter | null {
  const [, x, y] = key.split(":").map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return getGuilds(seed).get(`${x}:${y}`) ?? null;
}

/** Whether the player stands in a settlement that keeps a guild hall. */
export function atGuildHall(gs: GameState): Feature | null {
  const world = getWorld(gs.seed);
  const feat = world.siteAt(gs.player.x, gs.player.y)?.feature;
  if (!feat || !isSettlement(feat)) return null;
  const tier = settlementTier(feat);
  if (tier !== "town" && tier !== "city") return null;
  return world.settlementLayout(feat).building("guildhall") ? feat : null;
}
