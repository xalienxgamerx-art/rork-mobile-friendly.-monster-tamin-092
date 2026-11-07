import { BIOMES, DAY_TICKS, SPECIES, WORLD_SIZE, footprintOf } from "./data";
import { CAVE_DEEP, SURFACE, heightOf, layerOf } from "./height";
import { addLog } from "./log";
import { objectAt } from "./objects";
import { hash2 } from "./rng";
import { makeCreature } from "./sim";
import { legendSignature } from "./signature";
import { ensureTerritory } from "./territory";
import type { BiomeId, GameState, HistoryState, LegendaryProgress, LegendaryStage, StatusId, WeatherId, WildCreature } from "./types";
import { getWorld, seasonIndex, timeOf, type World } from "./world";

/**
 * The legendary roster (Updates G.2 + G.3 + G.4): nine one-of-a-kind individuals that live
 * in the far corners of every world. They are not a species mechanic —
 * exactly one body of each exists per seed, placed deterministically far from
 * the starting settlement, guarded by the same world engines as any alpha
 * but with their own discovery ladder, encounter conditions, signature combat
 * behavior and taming terms.
 *
 * House rules, the same as every other system here:
 *  - DETERMINISTIC. Sites come from a max-distance scan of the seed's own
 *    terrain; every stage transition is a pure function of state + tick.
 *    No Math.random, no wall clock.
 *  - ONE BODY, FOREVER. Body ids are `leg:<speciesId>`; nothing spawns,
 *    breeds, hatches or folds them (distant.ts refuses to abstract them,
 *    death hands them back alive). Offspring resolve to mundane kin lines.
 *  - THE STANDARD ENGINES. Encounters are live-map fights; taming is the
 *    affection/food system with individual terms; lore rides the G.1 archive.
 */

/* --------------------------------- config ----------------------------------- */

/** Prefix of the one-of-a-kind legendary body ids. */
export const LEGEND_BODY_PREFIX = "leg:";
/** In-world days a withdrawn legend stays at home before it can be re-met. */
export const LEGEND_COOLDOWN_DAYS = 2;
/** Ladder ranges: evidence near the stone, territory at the anchor, the body in between. */
const EV_RANGE = 3;
const TERRITORY_RANGE = 10;
const ENCOUNTER_RANGE = 14;

export interface LegendDef {
  speciesId: string;
  /** The individual's proper name: "Vaelrox". */
  name: string;
  /** Display epithet, used with the proper name: "Vaelrox, the Ember Crown". */
  epithet: string;
  /** The surface biome its territory occupies (for the cave legend: the biome above its deep hall). */
  biome: BiomeId;
  layer: number;
  level: number;
  /** The chronicle entry that seeds the rumor. */
  lore: { title: string; text: string; source: string; stone: string };
  /** Logged when the player first finds the physical evidence. */
  evidenceText: string;
  /** Logged when the player first reaches the territory — names the encounter terms. */
  hint: string;
  /** Logged when the body first materializes. */
  intro: string;
  /** Logged when it withdraws after a fight. */
  withdraw: string;
  /** Encounter condition: met while the player stands in range, else the land stays empty. */
  encounter(world: World, x: number, y: number, tick: number): boolean;
  /** Taming terms: a rejection reason, or null when the legend will consent. */
  gate(gs: GameState): string | null;
  /** The mundane species its offspring resolve to — a legend's blood dilutes, never duplicates. */
  offspring: string;
  /** Swimmer legends anchor on dry land unless they own a whole lake (Miravane). */
  anchorLake?: boolean;
  // signature combat behavior (resolved by combat.ts, standard engine):
  veilEvery?: number; // re-veils itself every N turns (Umbrelith, Vaskar)
  veilText?: string; // custom veil line (Vaskar's smiling reflections)
  rainHeal?: number; // heals per action in rain or storm (Miravane, Tempestrix)
  winterHeal?: number; // heals per action under clear winter skies (Aurelfar)
  waterHeal?: number; // heals per action while touching water (Nereoth)
  auraSlow?: number; // slows nearby foes every N turns (Aurelfar)
  /** A periodic boss pulse: area damage around the legend while it fights (Tempestrix's thunder, Nereoth's pressure, Vaskar's flurry). */
  pulse?: {
    every: number; // turns between pulses
    dice: [number, number];
    range: number; // chebyshev reach from the legend
    status?: [StatusId, number, number]; // chance, turns
    /** Only fires while hpFrac is below this (Vaskar's cracked-mask rage). */
    below?: number;
    text: string; // logged once when the pulse fires
    hitText: string; // logged per foe struck
  };
}

const isNight = (tick: number): boolean => timeOf(tick).night;
const weatherAt = (world: World, x: number, y: number, tick: number): WeatherId => world.weather(x, y, tick).id;

let _list: LegendDef[] | null = null;
/**
 * The nine legend defs, built lazily: this module sits inside several load-time
 * import cycles (store→sim→legends, world↔legends), so nothing here may touch
 * another module's value bindings while the graph is still initializing.
 */
export function legendList(): LegendDef[] {
  _list ??= buildDefs();
  return _list;
}

function buildDefs(): LegendDef[] {
  return [
  {
    speciesId: "vaelrox",
    name: "Vaelrox",
    epithet: "the Ember Crown",
    biome: "mountain",
    layer: SURFACE,
    level: 45,
    lore: {
      title: "The Ember Crown",
      text: "Shepherds of the high scree leave their fires banked and their flocks below the tree line, for the mountain has a crown and the crown is awake. A tamer's journal from the last generation swears the plates of Vaelrox have never once been marked: stone older than the peak itself, and between the plates, the temper showing through.",
      source: "a tamer's field journal, copied at the highland waystones",
      stone: "THE CROWN KEEPS THE MOUNTAIN",
    },
    evidenceText: "Scorched ground in a perfect circle, stones glazed by a heat that comes from one animal. Vaelrox is real — and it was here.",
    hint: "From here you can see where the scree never cools. Vaelrox walks its caldera in all weathers — but no fire drake shows itself in the rain.",
    intro: "The haze over the caldera ignites. VAELROX, the Ember Crown, unfolds against the skyline — and looks down.",
    withdraw: "its plates close like a furnace door as it withdraws into the burning caldera. The mountain will not forget you.",
    encounter: (world, x, y, tick) => {
      const w = weatherAt(world, x, y, tick);
      return w !== "rain" && w !== "storm";
    },
    gate: (gs) => {
      const c = gs.creatures["leg:vaelrox"];
      // its stony plates must be outmaneuvered before it will treat you as an equal
      return c && c.hpFrac <= 0.5 ? null : "Vaelrox will not be tamed while its plates still hold. Weaken it first.";
    },
    offspring: "crested_wyrm",
  },
  {
    speciesId: "umbrelith",
    name: "Umbrelith",
    epithet: "the Gloomwarden",
    biome: "gloomwood",
    layer: CAVE_DEEP,
    level: 42,
    lore: {
      title: "The Gloomwarden",
      text: "Deep miners of the weeping woods leave one gem on the ledge below the second dark. Not tribute, they insist — bookkeeping. The account is kept by Umbrelith, half stone and half the shadow between stones, which has counted everyone who has ever passed and never once been seen to blink.",
      source: "miners' ledger marginalia, kept at the gloomwood halls",
      stone: "ALL WHO PASS ARE COUNTED",
    },
    evidenceText: "Gem-marks on the stone, one per passerby, each older than the last. Umbrelith keeps its ledger here — and you have been entered.",
    hint: "The shaft breathes cold. The Gloomwarden walks the deepest dark, and only in the deep of night will it wear a shape you can argue with.",
    intro: "Your light stops reaching the walls. UMBRELITH, the Gloomwarden, was already here — it has simply decided you should know.",
    withdraw: "the dark closes over it like water. Umbrelith returns to its counting, deeper still.",
    encounter: (_world, _x, _y, tick) => isNight(tick),
    gate: (gs) => (isNight(gs.tick) ? null : "Umbrelith listens only in the deep of night."),
    offspring: "gloamoth",
    veilEvery: 3,
  },
  {
    speciesId: "miravane",
    name: "Miravane",
    epithet: "the Lake Sovereign",
    biome: "lake",
    layer: SURFACE,
    level: 42,
    lore: {
      title: "The Lake Sovereign",
      text: "Brides once cast rings into still water for luck. In one lake — the records disagree on which — something began casting them back, each on a lily pad, each polished. The court of Miravane is the whole lake, and her law is the weather: when the sky weeps, the sovereign rises.",
      source: "a collection of lakeside wedding customs, shelved at the waterside shrines",
      stone: "SHE RISES WITH THE RAIN",
    },
    evidenceText: "Offerings sunk in the shallows — rings, combs, a knight's spur — each cleaned, arranged, and kept. Miravane holds court here.",
    hint: "The reeds lean away from the deep spot. When rain streaks the lake, the Sovereign rises; under a dry sky she is water, and only water.",
    intro: "Every ripple on the lake stops at once. MIRAVANE, the Lake Sovereign, rises through her own reflection.",
    withdraw: "she sinks without a splash, and the lake pretends nothing happened.",
    encounter: (world, x, y, tick) => {
      const w = weatherAt(world, x, y, tick);
      return w === "rain" || w === "storm";
    },
    gate: (gs) => {
      const site = legendSites(gs.seed)["miravane"];
      const w = weatherAt(getWorld(gs.seed), site.x, site.y, gs.tick);
      return w === "rain" || w === "storm" ? null : "Miravane will not leave her lake while the sky holds dry.";
    },
    offspring: "slimekin",
    anchorLake: true,
    rainHeal: 3,
  },
  {
    speciesId: "sarquiss",
    name: "Sarquiss",
    epithet: "the Dune Hermit",
    biome: "desert",
    layer: SURFACE,
    level: 44,
    lore: {
      title: "The Dune Hermit",
      text: "Caravan maps mark one hollow as the Hermit's chair: a smooth-worn basin where the sand is warm at midnight. Offerings of cactus fruit left there are always gone by morning, and the dunes around it have never once shown a track. Whatever Sarquiss is, it has perfected the art of not being where you are.",
      source: "a caravaneer's route book, annotated at the desert waystones",
      stone: "THE STORM IS HIS DOOR",
    },
    evidenceText: "A smooth-worn basin in the lee of a dune, still warm. Fruit rinds, arranged by size. Sarquiss was here — and not long ago.",
    hint: "The hollow breathes. In a sandstorm the dunes come loose from their moorings — and so does what lives under them.",
    intro: "The dune in front of you stands up. SARQUISS, the Dune Hermit, has been listening to your footsteps for an hour.",
    withdraw: "the sand takes it back the way a hand closes. The dunes go smooth, and there is nothing more to say.",
    encounter: (world, x, y, tick) => weatherAt(world, x, y, tick) === "sandstorm",
    gate: (gs) => {
      const site = legendSites(gs.seed)["sarquiss"];
      return weatherAt(getWorld(gs.seed), site.x, site.y, gs.tick) === "sandstorm" ? null : "Sarquiss trusts only a sandstorm's cover.";
    },
    offspring: "dunescuttle",
  },
  {
    speciesId: "aurelfar",
    name: "Aurelfar",
    epithet: "the Winter Vigil",
    biome: "snow",
    layer: SURFACE,
    level: 40,
    lore: {
      title: "The Winter Vigil",
      text: "The old shepherds say winter ends when the Vigil blinks. It has not blinked in a very long time. Aurelfar walks the far snows in the dark hours, antlers holding a piece of the northern lights, watching the season the way a sentry watches a border only it can see.",
      source: "a shepherd's vigil-song, written down at the north waystones",
      stone: "THE VIGIL WALKS AT NIGHT",
    },
    evidenceText: "A single line of cloven prints across the snow, rimed with light, ending for no reason in open ground. Aurelfar passed here, watching something else.",
    hint: "The snow keeps a silence with edges. The Vigil walks only in the dark hours — stand watch, and be worth watching back.",
    intro: "The aurora leans down. AURELFAR, the Winter Vigil, steps out of the snowlight — and waits, courteously, for you to decide.",
    withdraw: "it pauses at the ridge, inclines its crowned head — then walks into the dark, and the dark walks with it.",
    encounter: (_world, _x, _y, tick) => isNight(tick),
    gate: (gs) => (isNight(gs.tick) ? null : "Aurelfar consents only under night's vigil."),
    offspring: "frostnib",
    winterHeal: 2,
    auraSlow: 4,
  },
  {
    speciesId: "tempestrix",
    name: "Tempestrix",
    epithet: "the Sky Sovereign",
    biome: "mountain",
    layer: SURFACE,
    level: 46,
    lore: {
      title: "The Sky Sovereign",
      text: "There is a ridge where shepherds do not count their flocks, because on that ridge the counting belongs to the storm. Tempestrix nests above the weather line and takes the tax in lambs and rumor both. The old name for a thunderclap on the high scree is, simply, its wingbeat.",
      source: "a shepherds' grudge-book, chained at the highland waystones",
      stone: "THE STORM KEEPS ITS OWN",
    },
    evidenceText: "A nest ledge of woven lightning-scorched branches, warm in dead air. Feathers like glass shards. Tempestrix owns this sky — and knows you have walked into it.",
    hint: "The wind here only blows one way: down. The Sovereign hunts above the weather line and descends with the storm — and every autumn, storm or none, it comes down to count what the year owes.",
    intro: "The ridge's shadow has wings. TEMPESTRIX, the Sky Sovereign, folds a thunderhead into a landing — and looks at you the way weather looks at a tree.",
    withdraw: "it drops off the ridge backwards into the storm, and the thunder apologizes for the interruption.",
    encounter: (world, x, y, tick) => weatherAt(world, x, y, tick) === "storm" || seasonIndex(tick) === 2,
    gate: (gs) => {
      const c = gs.creatures["leg:tempestrix"];
      return c && c.hpFrac <= 0.6 ? null : "Tempestrix cannot hear you over its own wind. Ground it first — wound the wing below six-tenths.";
    },
    offspring: "zephyr_hawk",
    rainHeal: 3,
    pulse: {
      every: 3,
      dice: [2, 5],
      range: 3,
      status: ["stunned", 0.3, 1],
      text: "Thunder walks the ridge.",
      hitText: "The crown gale slams into",
    },
  },
  {
    speciesId: "nereoth",
    name: "Nereoth",
    epithet: "the Abyss Regent",
    biome: "beach",
    layer: SURFACE,
    level: 47,
    lore: {
      title: "The Abyss Regent",
      text: "The deep sea keeps a court, and the court keeps a regent. Fishermen who fish the far shelves tell of a lantern glow that rises to meet their lowered lamps, and of nets that come up folded. Nereoth rules from below the thermocline and only rarely agrees the surface exists.",
      source: "a wrecker's tide journal, salvaged at the salt-shrine waystones",
      stone: "THE DEEP SENDS ITS REGENT",
    },
    evidenceText: "A beaching scar the length of a fishing boat, and barnacle rows pressed into the sand like a signature. Nereoth came ashore here — and went back having decided something.",
    hint: "The sea lies still and gray and hides its teeth. When fog walks in from the deep water the Regent's court comes into session — on your sand. Failing fog, it keeps night court.",
    intro: "The tide goes out and does not come back. NEREOTH, the Abyss Regent, beaches itself through its own weight — the deep has an audience, and it is you.",
    withdraw: "it pours itself back into the fog like a ship slipping its mooring, and the sea closes the ledger.",
    encounter: (world, x, y, tick) => weatherAt(world, x, y, tick) === "fog" || isNight(tick),
    gate: (gs) => {
      const c = gs.creatures["leg:nereoth"];
      if (!c || c.hpFrac > 0.7) return "The Regent negotiates only when the fight has gone out of the tide. Bring it below seven-tenths.";
      return null;
    },
    offspring: "tidefin_toad",
    waterHeal: 3,
    pulse: {
      every: 3,
      dice: [2, 4],
      range: 2,
      status: ["soaked", 0.9, 2],
      text: "The pressure of the deep closes around you.",
      hitText: "The abyss presses down on",
    },
  },
  {
    speciesId: "vaskar",
    name: "Vaskar",
    epithet: "the Smiling Summit",
    biome: "mountain",
    layer: SURFACE,
    level: 44,
    lore: {
      title: "The Smiling Summit",
      text: "Four arms, snow-white fur, and a golden mask carved into a broad, serene smile. The mountain clans sing that the peak has a lord, that the lord wears the mask, and that the passes stay open only while it permits them. Vaskar has ruled the high reaches for longer than the passes have had names, mostly by making it very difficult to stop smiling.",
      source: "a mountain-clan shield-song, shouted at the summit waystones",
      stone: "THE MOUNTAIN IS STILL SMILING",
    },
    evidenceText: "Banners, folded into impossible knots, arranged by color. Four-fingered prints pressed into the scree, in a walking rhythm no animal keeps. Vaskar has been holding court here.",
    hint: "The scree is arranged. Someone sweeps a peak no one visits. Vaskar dances only under the open noon — come at midday, and mind where you look.",
    intro: "Every boulder on the slope seems to have been waiting for you. One of them stands up. VASKAR, the Smiling Summit, greets you with all four arms at once — the mask never stops smiling.",
    withdraw: "it bows, all four arms wide, still grinning — and the mountain folds around it like a fan. Somewhere above, you would swear something is laughing.",
    encounter: (world, x, y, tick) => weatherAt(world, x, y, tick) === "clear" && !isNight(tick),
    gate: (gs) => {
      const c = gs.creatures["leg:vaskar"];
      if (!c || c.hpFrac > 0.4) return "The mask grants nothing to those it has outdanced. Bring Vaskar low — below two-fifths — under the open sun.";
      return isNight(gs.tick) ? "The mask dances at noon, not at night." : null;
    },
    offspring: "skullclub_orc",
    veilEvery: 4,
    veilText: "splits into smiling reflections — four arms become eight, and none of them are where they were.",
    pulse: {
      every: 2,
      dice: [2, 4],
      range: 1,
      below: 0.5,
      text: "The mask cracks — and Vaskar stops dancing.",
      hitText: "Four fists find four angles on",
    },
  },
  {
    speciesId: "karkanos",
    name: "Karkanos",
    epithet: "the Walking Peak",
    biome: "mountain",
    layer: SURFACE,
    level: 45,
    lore: {
      title: "The Walking Peak",
      text: "The highland clans' oldest map marks a peak that is not on the ridge line, and the cartographer's note reads, simply: 'do not approach from below.' It is a crab the size of the mountain it is mistaken for, its shell carrying scree slopes and a snow cap, and it has been walking since before the passes were passes.",
      source: "the oldest survey map, kept in the highland waystone chapel",
      stone: "ONE PEAK TOO MANY",
    },
    evidenceText: "A line of crab tracks, each print the size of a barn door, leading up into the snow line — and back down, centuries ago, by another route.",
    hint: "The false peak is only false from here. Karkanos walks when frost locks the rock — come in the deep of winter.",
    intro: "The summit is closer than it was. Then it blinks. KARKANOS, the Walking Peak, has decided you are standing on its path — and it is very, very patient.",
    withdraw: "it settles, fold by colossal fold, back into the ridge line. By the time you find the right boulder to look at, it is a mountain again — one peak too many.",
    encounter: (world, _x, _y, tick) => seasonIndex(tick) === 3,
    gate: (gs) => {
      const c = gs.creatures["leg:karkanos"];
      if (!c || c.hpFrac > 0.6) return "Its shell holds while the peak stands tall. Crack it — below three-fifths — before Karkanos will stoop to a tamer.";
      return null;
    },
    offspring: "dunescuttle",
    pulse: {
      every: 3,
      dice: [2, 5],
      range: 2,
      status: ["rooted", 0.6, 2],
      text: "Karkanos settles its weight — the whole slope bucks like a wave.",
      hitText: "The tremor bucks ",
    },
  },
  ];
}

let _byId: Map<string, LegendDef> | null = null;
let _offspring: Record<string, string> | null = null;
export function legendsById(): ReadonlyMap<string, LegendDef> {
  _byId ??= new Map(legendList().map((d) => [d.speciesId, d]));
  return _byId;
}
/** Mundane kin lines: a legendary parent's offspring always resolve here. */
export function legendOffspring(): Readonly<Record<string, string>> {
  _offspring ??= Object.fromEntries(legendList().map((d) => [d.speciesId, d.offspring]));
  return _offspring;
}

export const isLegendBody = (id: string): boolean => id.startsWith(LEGEND_BODY_PREFIX);
export const legendBodyId = (speciesId: string): string => `${LEGEND_BODY_PREFIX}${speciesId}`;
/** The proper combat announcement: "Vaelrox, the Ember Crown (Lv 45)". */
export const legendName = (speciesId: string, level: number): string => {
  const def = legendsById().get(speciesId);
  return def ? `${def.name}, ${def.epithet} (Lv ${level})` : "";
};

/** Order of the ladder, for UI and comparisons. */
const STAGE_RANK: Record<LegendaryStage, number> = {
  undiscovered: 0, rumored: 1, evidence: 2, located: 3, available: 4, fought: 4, defeated: 5, tamed: 5,
};
export const stageRank = (s: LegendaryStage): number => STAGE_RANK[s];
export const hasReached = (p: LegendaryProgress | undefined, s: LegendaryStage): boolean => !!p && stageRank(p.stage) >= STAGE_RANK[s];

/* ------------------------------ deterministic sites -------------------------- */

export interface LegendSite {
  x: number;
  y: number;
  layer: number;
  /** The physical evidence: a distinct findable spot a few steps off the anchor. */
  ev: { x: number; y: number; layer: number };
}

const siteCache = new Map<number, Record<string, LegendSite>>();

const standable = (world: World, x: number, y: number): boolean => {
  if (!world.inBounds(x, y)) return false;
  const t = world.tile(x, y);
  return BIOMES[t.biome].passable && !t.feature && !world.siteAt(x, y)?.wall;
};

/** Deterministic ring search outward from a point; the order rotates by hash so clusters differ. */
function ringFind(world: World, x: number, y: number, layer: number, test: (tx: number, ty: number) => boolean, maxR = 12): { x: number; y: number } | null {
  const rot = hash2(world.seed ^ 0x17e5, x, y) % 8;
  for (let r = 2; r <= maxR; r++) {
    for (let i = 0; i < 8 * r; i++) {
      const a = i + rot * r;
      const tx = x + Math.round(Math.cos((a / (8 * r)) * Math.PI * 2) * r);
      const ty = y + Math.round(Math.sin((a / (8 * r)) * Math.PI * 2) * r);
      if (!world.inBounds(tx, ty)) continue;
      const ok = layer === SURFACE ? standable(world, tx, ty) : heightOf(world).caveOpen(layer, tx, ty);
      if (ok && test(tx, ty)) return { x: tx, y: ty };
    }
  }
  return null;
}

/**
 * The nine territories of a world, found once per seed: a coarse lattice of
 * candidate tiles, visited FARTHEST-from-the-start first, so each legend claims
 * the first (≈ farthest) match — legendary ground is always far ground, and the
 * scan stops the moment all are placed. A rare world that hides a biome
 * between the coarse points gets one refined pass for the stragglers.
 */
export function legendSites(seed: number): Record<string, LegendSite> {
  const hit = siteCache.get(seed);
  if (hit) return hit;
  const world = getWorld(seed);
  const hf = heightOf(world);
  const start = world.startPoint();
  const MIN_DIST = 140;
  /** Territories keep their distance: no two legends crowd one corner of the map. */
  const MIN_APART = 60;
  const claimed = new Map<string, { x: number; y: number; d: number }>();
  const tooClose = (x: number, y: number): boolean => {
    for (const c of claimed.values()) if (Math.hypot(c.x - x, c.y - y) < MIN_APART) return true;
    return false;
  };
  const scan = (step: number): void => {
    const pts: { x: number; y: number; d: number }[] = [];
    for (let y = step; y < WORLD_SIZE; y += step) {
      for (let x = step; x < WORLD_SIZE; x += step) {
        const d = Math.hypot(x - start.x, y - start.y);
        if (d >= MIN_DIST) pts.push({ x, y, d });
      }
    }
    // deterministic order: far first, near ties broken by hash
    pts.sort((a, b) => b.d - a.d || hash2(seed ^ 0x7e11, a.x, a.y) - hash2(seed ^ 0x7e11, b.x, b.y));
    for (const p of pts) {
      if (claimed.size === legendList().length) return;
      const t = world.tile(p.x, p.y);
      if (t.feature || tooClose(p.x, p.y)) continue;
      for (const def of legendList()) {
        if (claimed.has(def.speciesId)) continue;
        // one territory per point: two lords never share a mountain, however far out it is
        if (def.layer === SURFACE && t.biome === def.biome) {
          claimed.set(def.speciesId, p);
          break;
        } else if (def.speciesId === "umbrelith" && t.biome === "gloomwood" && hf.caveOpen(CAVE_DEEP, p.x, p.y)) {
          claimed.set("umbrelith", p);
          break;
        }
      }
    }
  };
  scan(96);
  if (legendList().some((d) => !claimed.has(d.speciesId))) scan(24);
  const out: Record<string, LegendSite> = {};
  const usedEv = new Set<string>();
  for (const def of legendList()) {
    const b = claimed.get(def.speciesId);
    // every world has every biome somewhere; the fallback keeps the type honest
    const ax = b?.x ?? WORLD_SIZE - start.x;
    const ay = b?.y ?? WORLD_SIZE - start.y;
    // the Gloomwarden's evidence stays on the surface above its shaft — a stone, readable in daylight
    const evLayer = def.speciesId === "umbrelith" ? SURFACE : def.layer;
    // no two stones share a tile — each legend's evidence is its own
    const ev = ringFind(world, ax, ay, evLayer, (tx, ty) => Math.hypot(tx - ax, ty - ay) >= 3 && !usedEv.has(`${tx},${ty}`), 40) ?? { x: ax, y: ay };
    usedEv.add(`${ev.x},${ev.y}`);
    out[def.speciesId] = { x: ax, y: ay, layer: def.layer, ev: { ...ev, layer: evLayer } };
  }
  siteCache.set(seed, out);
  return out;
}

/* ---------------------------------- ladder ----------------------------------- */

/** Backfills the per-legendary ladder and its archive entries (new games and old saves). Idempotent. */
export function ensureLegends(gs: GameState): void {
  if (!gs.legends) gs.legends = {};
  for (const def of legendList()) {
    if (!gs.legends[def.speciesId]) gs.legends[def.speciesId] = { stage: "undiscovered", since: gs.tick };
  }
  if (gs.history) appendLegendLore(gs.history, gs.seed);
}

function setStage(gs: GameState, def: LegendDef, stage: LegendaryStage, log?: string): void {
  const p = gs.legends?.[def.speciesId];
  if (!p || p.stage === stage) return;
  p.stage = stage;
  p.since = gs.tick;
  if (log) addLog(gs, log, "event");
}

/** Reading a legend's chronicle is the first rung: the rumor takes root. */
export function legendLoreRead(gs: GameState, speciesId: string): void {
  const def = legendsById().get(speciesId);
  const p = gs.legends?.[speciesId];
  if (!def || !p || p.stage !== "undiscovered") return;
  setStage(gs, def, "rumored", `A rumor takes root: ${def.name}, ${def.epithet}. The chronicle's stone waits in the wilds.`);
}

/**
 * A fight the legend loses is a fight it survives: it withdraws into its
 * territory, wounded but alive — the one absolute of the roster. No carrion,
 * no spoils, no death; a cooldown guards its dignity before the next meeting.
 */
export function legendWithdrawn(gs: GameState, c: WildCreature): void {
  const def = legendsById().get(c.speciesId);
  if (!def || !isLegendBody(c.id)) return;
  c.hpFrac = 0.6;
  c.stalking = false;
  c.x = c.homeX;
  c.y = c.homeY;
  c.calmUntil = gs.tick + LEGEND_COOLDOWN_DAYS * DAY_TICKS;
  const p = gs.legends?.[c.speciesId];
  if (p && p.stage !== "tamed" && p.stage !== "defeated") {
    p.stage = "fought";
    p.since = gs.tick;
    p.calmUntil = c.calmUntil;
  }
  addLog(gs, `${def.name} breaks away — ${def.withdraw}`, "event");
}

/** The moment a legend chooses to follow: the wild body is gone for good. */
export function legendTamed(gs: GameState, speciesId: string): void {
  const def = legendsById().get(speciesId);
  if (!def) return;
  setStage(gs, def, "tamed", `${def.name} — ${def.epithet} — chooses to walk with you. Somewhere far off, the wind changes key.`);
}

/**
 * Per-tick legendary upkeep: advances the ladder by proximity and, when the
 * player stands in a located territory with the individual conditions met,
 * materializes the body. A cheap no-op for unmet and finished legends.
 */
export function legendTick(gs: GameState, world: World): void {
  if (gs.tick % 4 !== 2) return;
  if (!gs.legends) ensureLegends(gs);
  const layer = layerOf(gs);
  const sites = legendSites(gs.seed);
  const px = gs.player.x;
  const py = gs.player.y;
  for (const def of legendList()) {
    const p = gs.legends?.[def.speciesId];
    if (!p || p.stage === "undiscovered" || p.stage === "tamed" || p.stage === "defeated") continue;
    const site = sites[def.speciesId];
    if (p.stage === "rumored") {
      if (layer === site.ev.layer && Math.max(Math.abs(px - site.ev.x), Math.abs(py - site.ev.y)) <= EV_RANGE) {
        setStage(gs, def, "evidence", def.evidenceText);
      }
      continue;
    }
    if (p.stage === "evidence") {
      if (layer === site.layer && Math.max(Math.abs(px - site.x), Math.abs(py - site.y)) <= TERRITORY_RANGE) {
        setStage(gs, def, "located", def.hint);
      }
      continue;
    }
    // located / available / fought: the encounter itself
    const id = legendBodyId(def.speciesId);
    if (gs.creatures[id]) {
      // a withdrawn legend re-stages to available once its cooldown passes and
      // the player returns under the right conditions — the body never left
      if (p.stage === "fought" && layer === site.layer && Math.max(Math.abs(px - site.x), Math.abs(py - site.y)) <= ENCOUNTER_RANGE && !(p.calmUntil && gs.tick < p.calmUntil) && def.encounter(world, site.x, site.y, gs.tick)) {
        p.stage = "available";
        p.since = gs.tick;
      }
      continue;
    }
    if (layer !== site.layer || Math.max(Math.abs(px - site.x), Math.abs(py - site.y)) > ENCOUNTER_RANGE) continue;
    if (p.calmUntil && gs.tick < p.calmUntil) continue;
    if (!def.encounter(world, site.x, site.y, gs.tick)) continue;
    if (!spawnLegendBody(gs, world, def, site)) continue;
    p.stage = "available";
    p.since = gs.tick;
    addLog(gs, def.intro, "bad");
  }
}

/** Open anchor ground for the body: land legends on standable tiles, the Sovereign on open lake. */
function legendAnchorOk(gs: GameState, world: World, def: LegendDef, layer: number, x: number, y: number, fp: number, loose = false): boolean {
  for (let dy = 0; dy < fp; dy++) {
    for (let dx = 0; dx < fp; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!world.inBounds(tx, ty)) return false;
      // never inside a settlement's walls
      if (world.siteAt(tx, ty)) return false;
      if (layer === SURFACE) {
        const t = world.tile(tx, ty);
        // loose: a kaiju sprawls over the local object scatter — only ground matters
        if (def.anchorLake ? t.biome !== "lake" : !standable(world, tx, ty) || (!loose && objectAt(world, tx, ty))) return false;
      } else if (!heightOf(world).caveOpen(layer, tx, ty)) return false;
    }
  }
  // no body, player or party monster under the emergence
  for (const c of Object.values(gs.creatures)) {
    if ((c.layer ?? SURFACE) !== layer) continue;
    if (Math.abs(c.x - x) < fp + 1 && Math.abs(c.y - y) < fp + 1) return false;
  }
  for (let dy = 0; dy < fp; dy++) {
    for (let dx = 0; dx < fp; dx++) {
      if (Math.abs(gs.player.x - (x + dx)) < 1 && Math.abs(gs.player.y - (y + dy)) < 1) return false;
      for (const m of gs.party) {
        const f = gs.field[m.uid];
        if (m.hp > 0 && f && f.x === x + dx && f.y === y + dy) return false;
      }
    }
  }
  return true;
}

/**
 * Places the one legendary body. Returns false (and places nothing) when the
 * anchor is briefly occupied — the next conditions check retries.
 */
function spawnLegendBody(gs: GameState, world: World, def: LegendDef, site: LegendSite): boolean {
  const id = legendBodyId(def.speciesId);
  if (gs.creatures[id]) return false;
  const fp = footprintOf(SPECIES[def.speciesId]);
  const h = hash2(gs.seed ^ 0x1e6a, site.x, site.y);
  let px = site.x;
  let py = site.y;
  let ok = legendAnchorOk(gs, world, def, site.layer, px, py, fp);
  if (!ok) {
    // a deterministic ring of alternative anchor tiles — wide enough that the
    // footprint almost always clears the local object scatter (trees, rocks)
    for (let r = 2; r <= 30 && !ok; r += 2) {
      for (let a = 0; a < 16 && !ok; a++) {
        const nx = site.x + Math.round(Math.cos((a / 12) * Math.PI * 2) * r);
        const ny = site.y + Math.round(Math.sin((a / 12) * Math.PI * 2) * r);
        if (legendAnchorOk(gs, world, def, site.layer, nx, ny, fp)) {
          px = nx;
          py = ny;
          ok = true;
        }
      }
    }
  }
  if (!ok) {
    // a densely grown territory (a mountain forest over its whole ring) still
    // hosts its lord: the last pass ignores mere object scatter, never ground
    for (let r = 0; r <= 30 && !ok; r += 2) {
      for (let a = 0; a < 16 && !ok; a++) {
        const nx = site.x + Math.round(Math.cos((a / 12) * Math.PI * 2 + 0.2) * r);
        const ny = site.y + Math.round(Math.sin((a / 12) * Math.PI * 2 + 0.2) * r);
        if (legendAnchorOk(gs, world, def, site.layer, nx, ny, fp, true)) {
          px = nx;
          py = ny;
          ok = true;
        }
      }
    }
  }
  if (!ok) return false;
  // the individual: fixed veteran level, its own genotype, no pack, no lair
  const c = makeCreature(id, def.speciesId, px, py, def.level, h, false);
  c.disposition = "aggressive";
  c.hpFrac = 1;
  c.layer = site.layer;
  // its signature is its birthright: the species-unique move, evolved to its
  // level — a tamed legend walks into the party with its technique already deep
  c.sig = legendSignature(def.speciesId, def.level, h);
  gs.creatures[id] = c;
  ensureTerritory(gs, c);
  return true;
}

/* --------------------------- taming terms (offerFood) ------------------------- */

/**
 * The individual taming terms for a legendary wild body, checked when its
 * affection would normally tame it: a rejection reason, or null when it
 * consents. Ordinary species never reach here.
 */
export function legendTameGate(gs: GameState, c: WildCreature): string | null {
  const def = legendsById().get(c.speciesId);
  if (!def || !isLegendBody(c.id)) return null;
  return def.gate(gs);
}

/* --------------------------- combat behavior (combat.ts) ---------------------- */

/**
 * Passive armor from a legend's signature defense: Vaelrox's plates hold while
 * it is strong; Sarquiss wears the dune itself, and only a sandstorm strips it.
 */
export function legendArmorBonus(speciesId: string, hpFrac: number, weather: WeatherId): number {
  switch (speciesId) {
    case "vaelrox":
      return hpFrac > 0.5 ? 4 : 0;
    case "sarquiss":
      return weather === "sandstorm" ? 0 : 6;
    case "tempestrix":
      // aloft, the Sovereign owns the altitude; a wounded wing grounds it
      return hpFrac > 0.6 ? 6 : 0;
    case "nereoth":
      // a wet hide of barnacle plate, cracked once the tide goes out of it
      return hpFrac > 0.6 ? 5 : 0;
    case "vaskar":
      // under open sky the smiling mask turns blows aside; in the dark it cannot see its own tricks
      return weather === "clear" && hpFrac > 0.5 ? 5 : 0;
    case "karkanos":
      // the shell is the peak: it holds while the mountain stands tall, cracks as it is brought low
      return hpFrac > 0.6 ? 6 : 0;
    default:
      return 0;
  }
}

/** The signature-behavior def behind a wild legendary fighter, or null. */
export function legendBehaviorOf(speciesId: string): LegendDef | null {
  return legendsById().get(speciesId) ?? null;
}

/* ------------------------------- lore & migration ----------------------------- */

/**
 * Appends the nine legend entries to the world archive — the same chronicles
 * the G.1 generation left behind, one scorched waystone per legend. Runs at
 * generation time and in the v34 migration (old saves' archives predate the
 * roster); guarded, so it happens exactly once per save.
 */
export function appendLegendLore(hist: HistoryState, seed: number): void {
  if (hist.lore.some((l) => l.legendId)) return;
  const sites = legendSites(seed);
  for (const def of legendList()) {
    const site = sites[def.speciesId];
    hist.lore.push({
      id: `lr${hist.lore.length}`,
      title: def.lore.title,
      text: def.lore.text,
      source: def.lore.source,
      reliability: "record",
      legendId: def.speciesId,
      x: site.ev.x,
      y: site.ev.y,
    });
  }
}

/** Migration step (v34): the ladder backfills unmet, the archive gains its entries. */
export function migrateLegends(gs: GameState): void {
  ensureLegends(gs);
}
