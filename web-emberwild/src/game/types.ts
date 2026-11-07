import type { TamerLook } from "./appearance";
export type Element = "neutral" | "fire" | "water" | "earth" | "air" | "nature" | "frost" | "shadow";
export type StatKey = "hp" | "atk" | "def" | "agi" | "wis";
export type Stats = Record<StatKey, number>;
/** The six heritable genes. `size` drives the monster's tile footprint. */
export type GeneKey = "vigor" | "might" | "guard" | "swift" | "wit" | "size";
/** Expressed gene values (derived from genomes; used by UI and legacy saves). */
export type Genes = Record<GeneKey, number>;
/** Two alleles per gene — the genetic source of truth. */
export interface GenePair {
  a: number;
  b: number;
}
export type Genome = Record<GeneKey, GenePair>;

/** One expressed-gene change caused by genetic drift, as structured data. */
export interface MutationRecord {
  gene: GeneKey;
  from: number;
  to: number;
  delta: number;
  dir: "up" | "down";
  /** Generation at which the mutation occurred. */
  gen: number;
}

export type BiomeId =
  | "deep" | "sea" | "lake" | "river" | "beach" | "meadow" | "forest" | "taiga" | "gloomwood"
  | "marsh" | "steppe" | "desert" | "tundra" | "snow" | "hills" | "mountain" | "peak";

export type FeatureId = "hamlet" | "town" | "city" | "ruin" | "shrine" | "lair";

export type ItemId =
  | "berries" | "nuts" | "roasted_nuts" | "fish" | "meat" | "herb" | "mushroom"
  | "cactus_fruit" | "honeycomb" | "ore" | "tonic" | "egg"
  | "carrot" | "potato" | "tomato" | "onion" | "garlic"
  | "draught" | "greater_tonic" | "antidote" | "firebane" | "brighteye" | "windstep"
  | "warybrew" | "ironbrew"
  // cooked meals (Update B — Provisions and Production)
  | "roasted_fish" | "roasted_veg" | "smoked_meat" | "trail_mix" | "nut_loaf"
  | "grilled_skewers" | "garlic_steak" | "charred_roots"
  | "hearty_stew" | "hunters_hotpot" | "soothing_porridge"
  | "honey_tart" | "dragonbread" | "wanderers_feast"
  // camp cooking equipment (owned at camp, never carried in the bag)
  | "skillet" | "cooking_pot" | "portable_oven";

/** Camp cooking gear. Owning it unlocks its cooking method permanently. */
export type EquipId = "skillet" | "cooking_pot" | "portable_oven";

/**
 * A temporary food effect on a monster: one flat bonus to one stat,
 * expiring at a simulation tick (never real-world time).
 */
export interface FoodEffect {
  /** Flat bonus added to the stat's computed value. */
  amount: number;
  /** Simulation tick the effect ends at (active while tick < until). */
  until: number;
  /** The meal that granted it (for display). */
  source: string;
}

/** Cooking/crafting ledgers: recipes discovered through experimentation plus camp equipment. */
export interface ProvisionState {
  /** Discovered non-starter recipes, key = recipe id. */
  discovered: Record<string, 1>;
  /** Camp equipment owned, key = EquipId (cooking only). */
  equipment?: Record<string, 1>;
}

export type PersonalityId = "brave" | "timid" | "curious" | "lazy" | "gluttonous" | "loyal" | "fierce" | "gentle";
export type MutationId =
  | "thick_hide" | "twin_hearted" | "luminous" | "quickened" | "iron_jaw"
  | "old_soul" | "frail" | "hollow_eyed" | "ember_veins" | "star_marked";
export type TraitId =
  | "warm_blooded" | "slick" | "thorny" | "mossy_shell" | "night_eyes" | "flutter"
  | "stoneskin" | "frost_coat" | "regal" | "photosynth" | "sunborn";
export type StatusId = "burning" | "soaked" | "poisoned" | "slowed" | "rooted" | "stunned" | "blinded" | "shelled" | "wary" | "veiled";
export type Terrain =
  | "grass" | "tallgrass" | "flowers" | "water" | "mud" | "rock" | "tree" | "sand" | "snow" | "ash" | "gloom"
  | "wall" | "woodwall" | "floor" | "door" | "rubble";
export type WeatherId = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "sandstorm";
export type Disposition = "curious" | "skittish" | "aggressive" | "calm";
export type OriginId = "wanderer" | "herbalist" | "ranger" | "scholar";
export type FearKind = "water" | "fire" | "heat" | "cold" | "dark" | "light";
export type Diet = "herbivore" | "carnivore" | "omnivore" | "lithovore";
export type Activity = "diurnal" | "nocturnal" | "crepuscular";
export type Family = "Beast" | "Slime" | "Bird" | "Bug" | "Spirit" | "Dragon" | "Brute";
export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export type Sex = "male" | "female" | "asexual";

/** Reproductive anatomy: the three biological configurations. */
export type ReproMode = Sex;
/** Life-stage maturity: immature individuals cannot reproduce yet. */
export type Maturity = "immature" | "mature";
/** Where an individual sits in the reproduction cycle. */
export type ReproStatus = "available" | "reproducing" | "cooldown" | "infertile" | "immature";
/** How a compatible pair reproduces: sexed anatomy, or two asexual parents. */
export type ReproPairing = "sexual" | "asexual";
/** Rule environment of a mating attempt: wild pairs obey species boundaries, player pairs are unrestricted. */
export type MatingContext = "wild" | "player";
/** How a species develops after conception: an egg laid in a nest, or live gestation. */
export type DevelopmentType = "egg" | "gestation";
/** Lifecycle of one reproductive development. */
export type DevelopmentState = "developing" | "ready" | "completed" | "interrupted" | "failed";
/** Lifecycle of a nest. */
export type NestState = "active" | "abandoned" | "destroyed";

/**
 * Biological reproduction data for one individual. Mode derives from sex;
 * fertility, maturity, cooldown and status are independent biological state
 * that future systems (growth, health, environment, gestation) can modify.
 */
export interface ReproductiveProfile {
  mode: ReproMode;
  /** 0–100; above 0 the individual is currently fertile. */
  fertility: number;
  maturity: Maturity;
  status: ReproStatus;
  /** Sim tick when the breeding cooldown ends (≤ tick means no cooldown). */
  cooldownUntil: number;
  /** Pairing of the current or most recent reproduction. */
  pairing?: ReproPairing;
  /** Partner body id while a reproduction is underway. */
  engagedWith?: string;
  /** Sim tick when the current reproduction completes development. */
  developUntil?: number;
  /** The female's remembered nest (egg-layers reuse it for every clutch). */
  nestId?: string;
}

export interface Monster {
  uid: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  xp: number;
  hp: number;
  genes: Genome;
  mutations: MutationId[];
  personality: PersonalityId;
  sex: Sex;
  skills: string[];
  satiety: number;
  bond: number;
  plus: number;
  origin: string;
  bornTick: number;
  parents: string[] | null;
  /** Display names captured at synthesis time (parents are consumed on synthesis). */
  parentNames?: string[];
  /** Biological ancestry: founders are generation 1, offspring max(parents) + 1. */
  generation?: number;
  /** Stable ancestry id, independent of display names; founders own `L:<uid>`. */
  lineageId?: string;
  /** Structured drift history: which expressed genes changed, when, and by how much. */
  mutHistory?: MutationRecord[];
  /** Biological reproduction state (backfilled from sex on load for legacy saves). */
  repro?: ReproductiveProfile;
  wins: number;
  /** The monster's own evolving Signature Move (permanent once designated). */
  sig?: SignatureState;
  /** Inherited signature techniques — normal moves, never self-evolving. */
  sigKnown?: SignatureState[];
  /** Placement cap on the growth footprint: the largest class that currently fits (growth.ts). */
  fpCap?: number;
  /** Temporary food effects, one per stat (backfilled lazily; expires by sim tick — cooking.ts). */
  foodEffects?: Partial<Record<StatKey, FoodEffect>>;
}

export interface WildCreature {
  id: string;
  speciesId: string;
  level: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hpFrac: number;
  satiety: number;
  disposition: Disposition;
  activity: string;
  personality: PersonalityId;
  geneSeed: number;
  /** Explicit genotype — the authoritative genetics (geneSeed only seeds legacy migration). */
  genes?: Genome;
  /** Founder generation (wild creatures are founders unless later systems say otherwise). */
  gen?: number;
  /** Stable lineage id carried into monsters on taming. */
  lineageId?: string;
  /** Biological reproduction state (backfilled from the creature's id on load for legacy saves). */
  repro?: ReproductiveProfile;
  /** The wild body's own evolving Signature Move (developed without player input). */
  sig?: SignatureState;
  /** Inherited signature techniques — normal moves, never self-evolving. */
  sigKnown?: SignatureState[];
  calmUntil: number;
  alpha: boolean;
  affection: number;
  stalking: boolean;
  /** Id of the lair alpha this minion is loyal to (absent for solo creatures). */
  pack?: string;
  /** Direct parent body ids (wild hatchlings; absent for spawned founders and legacy saves). */
  parents?: string[];
  /** Structured mutation history (wild hatchlings; monsters carry it always). */
  mutHistory?: MutationRecord[];
  /** Tick until which migration decisions are suppressed (anti-oscillation; Phase 9). */
  migrateUntil?: number;
  /** Birth tick (hatchlings only; absent = mature adult, the spawned/legacy default). */
  bornTick?: number;
  /** Placement cap on the growth footprint: the largest class that currently fits (growth.ts). */
  fpCap?: number;
  /** The ecological territory this creature recognizes as home (backfilled by migrateTerritories). */
  territoryId?: string;
  /** Banked fight experience (v20+): wild bodies level up as they win fights. */
  xp?: number;
  /** True once the player has genuinely encountered this body — chronicled monsters persist as real individuals forever. */
  known?: boolean;
  /** Vertical layer: absent = surface, -1 upper caves, -2 deep caves. */
  layer?: number;
  /** Tile this hungry body is walking to for a plant it smelled (transient; re-validated each use). */
  seek?: { x: number; y: number } | null;
  /** Attempt attempts since the body last closed distance on its current target (transient; trips a give-up cooldown). */
  stuck?: number;
  /** Tick until which long-range scent seeking is suppressed after repeated dead ends (transient). */
  seekBan?: number;
  /** Ticks until the body will trust carrion scent again (unreachable remains). */
  carrionBan?: number;
  /** Tick until which this body will not take more offered food (the 3h feeding cooldown). */
  feedUntil?: number;
  /** The mate this body is pursuing (transient intent; re-validated every use, stale ids are safe). */
  mateTarget?: string;
  /** Tick until which this body's mating call is on cooldown (deterministic stagger). */
  callUntil?: number;
}

export type LogKind = "info" | "event" | "combat" | "system" | "good" | "bad" | "weather";

export interface LogEntry {
  id: number;
  tick: number;
  text: string;
  kind: LogKind;
}

export interface Player {
  name: string;
  origin: OriginId;
  scarf: string;
  x: number;
  y: number;
  gold: number;
  homeX: number;
  homeY: number;
  homeName: string;
  fx: number;
  fy: number;
  /** Modular appearance (the rivals' system); pre-look saves gain one in migration. */
  look?: TamerLook;
  /** Vertical layer: absent = surface, -1 upper caves, -2 deep caves. The party always shares it. */
  layer?: number;
}

export interface GameStats {
  steps: number;
  battles: number;
  tamed: number;
  synthesized: number;
  foraged: number;
}

/** A landmark the player has explicitly found and can place on their maps. */
export interface Discovery {
  kind: FeatureId;
  name: string;
  x: number;
  y: number;
  tick: number;
}

/**
 * The player's knowledge of the world — deliberately separate from the world
 * itself. The procedural world is authoritative; this is only what the player
 * has seen, visited or been told about, and it persists across save/load.
 */
/** A nest the player has laid eyes on, kept on their maps forever. */
export interface NestMemory {
  x: number;
  y: number;
  speciesId: string;
  tick: number;
  /** Vertical layer the nest sits on (absent = surface). */
  layer?: number;
}

export interface WorldKnowledge {
  /** Explored 8×8-tile cells, key = (cellY << 9) | cellX. */
  explored: Record<number, 1>;
  /** Discovered landmarks, key = `f:x:y`. */
  discovered: Record<string, Discovery>;
  /** 160-tile region cells whose name the player has learned, key = `rx,ry`. */
  regionsSeen: Record<string, 1>;
  /** Nation ids whose banner the player has stood under, key = nation id. */
  nationsSeen: Record<string, 1>;
  /** Association ids the player has learned from notices, key = association id. */
  assocSeen: Record<string, 1>;
  /** Explored cave cells, key = `${layer}:${eCellKey}` (underground knowledge never leaks onto the surface map). */
  caves?: Record<string, 1>;
  /** The player's own traveled trail (breadcrumbs, capped). */
  route: [number, number][];
  /** Nests the player has seen, key = nest id — charted onto their maps forever. */
  nestsSeen?: Record<string, NestMemory>;
  /** Cave mouths the player has seen, key = `x,y` — charted onto their maps forever. */
  mouthsSeen?: Record<string, { x: number; y: number; tick: number }>;
}

export interface BStatus {
  id: StatusId;
  turns: number;
}

/**
 * A Signature Move's accumulated state — fully serializable; behavior is
 * resolved from (baseId, mods) at execution time, so saves replay exactly.
 */
export interface SignatureState {
  /** Castable slot id in the owner's skills array (base id, or `sig:<n>` for inherited copies). */
  uid: string;
  /** The original move this technique grew from. */
  baseId: string;
  /** Current procedurally generated name. */
  name: string;
  /** Accumulated modifier ids, in selection order. */
  mods: string[];
  /** Evolutions applied (generation of the technique). */
  gen: number;
  /** Human-readable evolution history, oldest first. */
  history: string[];
  /** Level of the next evolution milestone. */
  nextLevel: number;
  /** How this body came to own the technique. */
  origin: "chosen" | "wild" | "inherited";
}

/** Where a party monster stands on the live map and what it should do there. */
export type FieldOrder = "follow" | "attack" | "hold";

/** How readily a party monster fights on its own initiative. */
export type Aggression = "passive" | "neutral" | "aggressive";

/** A queued skill command: the monster paths into range, then unleashes it. */
export interface SkillOrder {
  skill: string;
  /** Wild creature id, or a party uid for ally/self skills. Empty for tile orders. */
  target: string;
  /** Ground coordinates for tile-targeted orders (mutually exclusive with target). */
  x?: number | null;
  y?: number | null;
}

/** Per-combatant combat state (statuses and skill cooldowns) on the live map. */
export interface FighterState {
  statuses: BStatus[];
  cooldowns: Record<string, number>;
}

/** Sparse terrain/fire overlay on a world tile, key = "x,y". */
export interface GroundTile {
  fire?: number;
  t?: Terrain;
}

/** The inherited outcome of a breeding, assembled at conception and materialized when development completes. */
export interface ChildBlueprint {
  speciesId: string;
  sex: Sex;
  /** 1 for player-bred offspring; wild births derive from the parents' levels. */
  level: number;
  genes: Genome;
  mutations: MutationId[];
  personality: PersonalityId;
  skills: string[];
  /** An inherited signature technique carried from a parent's evolved move. */
  sigKnown?: SignatureState[];
  plus: number;
  bond: number;
  generation: number;
  lineageId: string;
  mutHistory: MutationRecord[];
  /** Direct parents' body ids (absent for distant aggregate conceptions). */
  parents?: [string, string];
  /** Display names captured at synthesis time (parents are consumed on synthesis). */
  parentNames?: [string, string];
}

/** Persistent reproductive development — an egg in a nest, or a gestation. The offspring entity is created only at completion. */
export interface ReproductiveDevelopment {
  id: string;
  parentIds: [string, string];
  speciesId: string;
  pairing: ReproPairing;
  type: DevelopmentType;
  state: DevelopmentState;
  startTick: number;
  completeTick: number;
  /** The nest holding this egg, if any. */
  nestId?: string;
  /** "wild" offspring hatch into the world; "player" offspring join party/pen. */
  origin: MatingContext;
  /** The assembled genetic outcome, fixed at conception. */
  child?: ChildBlueprint;
  /** Id of the offspring once created (monster uid or wild creature id). */
  resultId?: string;
  /** Distant conceptions complete into their abstract population — never into a body. */
  distant?: boolean;
  /** The chunk-region a distant development belongs to. */
  dist?: { layer: number; cx: number; cy: number };
}

/** A persistent nest built by a female. Independent world state that Phase 6 territories and Phase 9 ecology can attach to. */
export interface Nest {
  id: string;
  speciesId: string;
  /** The owning female's body id — or `pop:<region key>` for nests tended by an abstract population. */
  ownerId: string;
  x: number;
  y: number;
  state: NestState;
  createdAt: number;
  lastUsedTick: number;
  /** Development records currently or previously held here. */
  developmentIds: string[];
  /** Phase 6 hook: the territory this nest falls within. */
  territoryId?: string;
  /** Vertical layer the nest was built on (absent = surface). */
  layer?: number;
}

/** Rolling reproductive vitals for one species (Phase 7 observability). */
export interface SpeciesVitals {
  births: number;
  deaths: number;
  juvenileDeaths: number;
}

/** Aggregate population of one species in one region cell — the distant-world (Phase 11) seed. */
export interface RegionPopulation {
  speciesId: string;
  /** Total known population (adults + juveniles). */
  pop: number;
  juveniles: number;
  births: number;
  deaths: number;
  tick: number;
}

/**
 * Persistent ecology state (Phase 7). Individual populations near the player
 * live in `creatures` and are censused on demand; this records event-driven
 * vitals and aggregate per-region populations that later phases (distant-world
 * simulation) can extend without individual entities.
 */
export interface EcologyState {
  /** Reproductive births and deaths per species, since the last daily reset. */
  vitals: Record<string, SpeciesVitals>;
  /** Aggregate populations per region cell, key = `r:<rx>,<ry>`. */
  regions: Record<string, RegionPopulation[]>;
  /** Last tick the ecological interval ran. */
  lastTick: number;
}

/**
 * A persistent lineage record (Phase 10): bounded ancestry bookkeeping keyed by
 * lineage id. Lineage identity describes ancestry and is deliberately separate
 * from species identity; records outlive the bodies that carried them.
 */
export interface LineageRecord {
  id: string;
  /** The founding member's species (informational only — lineages are not species). */
  speciesId: string;
  foundedTick: number;
  /** Highest generation registered in this lineage. */
  depth: number;
  /** Living members (event-fed, recomputed on load; approximate between loads). */
  living: number;
  /** Total members ever registered (monotonic). */
  historical: number;
  /** Best expressed gene values observed in the lineage (per gene). */
  peakGenes: Genes;
  /** A capped sample of notable mutations from the lineage's history. */
  notable: MutationRecord[];
  /** A capped sample of member ids (living members after each load). */
  members: string[];
}

/**
 * A persistent ecological home range. Territories are world state with stable
 * identity: they outlive the creatures that currently occupy them, so a
 * population can unload and reload without its home range vanishing.
 * Ownership migrates from the legacy alpha behavior — the dominant individual
 * is the territory holder; other members recognize the territory as home.
 */
export interface Territory {
  id: string;
  /** Species the territory was founded by (mixed populations arrive in a later phase). */
  speciesId: string;
  /** Center tile — the lair, den or founding spot. */
  x: number;
  y: number;
  /** Home-range radius in tiles (chebyshev), matching the map's tile architecture. */
  radius: number;
  /** 0–100 environmental quality derived from existing biome/forage data. */
  quality: number;
  /** The dominant individual's body id (the migrated alpha role), when held. */
  ownerId?: string;
  /** Nests located within this territory (ids — nests and territories stay decoupled). */
  nestIds: string[];
  /** True while ownership has lapsed with rivals about (foundation for later contest behavior). */
  contested?: boolean;
  createdAt: number;
  /** Vertical layer of the range (absent = surface; cave populations hold cave territories). */
  layer?: number;
}

/**
 * One abstract distant population (Phase 11): the aggregate standing of one
 * species in one chunk-region while no individual body simulates it. Mean
 * genes carry the population's accumulated selection state; the seed makes
 * abstract births, deaths and migration deterministic.
 */
export interface AbstractPop {
  speciesId: string;
  /** Individual members represented by this aggregate (adults + juveniles). */
  count: number;
  juveniles: number;
  /** Mean expressed genes across abstracted members. */
  genes: Genes;
  /** Mean condition (0–100). */
  satiety: number;
  /** Mean danger level of members (drives materialized levels). */
  level: number;
  /** Population-level ancestry: the first lineage observed among members. */
  lineageId: string | null;
  /** Deterministic seed for abstract ecological decisions. */
  seed: number;
}

/**
 * A distant chunk-region simulated abstractly (Phase 11). While the player is
 * away its wildlife lives here as aggregate populations that keep breeding,
 * dying, competing and migrating through the shared ecological rules.
 */
export interface DistantRegion {
  key: string;
  layer: number;
  cx: number;
  cy: number;
  pops: AbstractPop[];
  /** Last tick the abstract simulation stepped (elapsed-time processing). */
  lastTick: number;
  /** True once real bodies were folded into these populations. */
  abstracted: boolean;
}

/**
 * A fallen body's remains (Phase 12 food web): real map objects that scavengers
 * seek and eat, and that rot away after a fixed lifespan.
 */
export interface Carrion {
  id: string;
  speciesId: string;
  x: number;
  y: number;
  /** Vertical layer (absent = surface). */
  layer?: number;
  /** Tick the body fell. */
  born: number;
  /** Eating charges left — big bodies feed more mouths. */
  portions: number;
}

/**
 * What a persistent tamer is out in the world to do (tamers.ts). Goals are
 * evaluated from the tamer's own knowledge and team condition — never from
 * omniscient access to the map.
 */
export type TamerGoalKind =
  | "recruit" // seek the wilds for a monster worth taming
  | "develop" // train the current team near home ground
  | "resupply" // travel to a settlement to recover and restock
  | "alpha" // pursue an alpha the tamer has credible word of
  | "duel" // pursue a rival tamer
  | "chapter"; // visit an association chapter

/** A tamer's committed journey — persisted so it resumes after save/load. */
export interface TamerRoute {
  /** Destination tile: a settlement entrance, hunt ground, or rival's last known spot. */
  dx: number;
  dy: number;
  destName: string;
  goal: TamerGoalKind;
  /** Remaining route tiles from findPath, next step first. */
  path: [number, number][];
  plannedTick: number;
}

export interface TamerCareer {
  battles: number;
  wins: number;
  losses: number;
  alphaKills: number;
  tames: number;
}

/** What one tamer has actually learned — sightings, credible word, met rivals. */
export interface TamerKnowledge {
  /** Settlements visited or heard credible talk of, key = "x,y". */
  settlements: Record<string, { name: string; x: number; y: number; tick: number }>;
  /** Alpha word the tamer holds, key = creature id; positions may be stale. */
  alphas: Record<string, { x: number; y: number; speciesId: string; level: number; tick: number; secondhand: boolean }>;
  /** Rivals met or heard of, key = tamer id; position is last known. */
  rivals: Record<string, { name: string; x: number; y: number; tick: number; last: "win" | "loss" | null }>;
  /** Authoritative event ids this tamer has already absorbed (rumor dedup). */
  heard: Record<string, 1>;
}

/** A persistent rival tamer — a real world participant with a career (tamers.ts). */
export interface Tamer {
  /** Stable unique id, independent of name or position. */
  id: string;
  name: string;
  /** Home settlement key "x,y" and its display name. */
  homeKey: string;
  homeName: string;
  x: number;
  y: number;
  /** Vertical layer (tamers keep to the surface for now). */
  layer: number;
  /** Active team — real monsters under the same rules as the player's party. */
  team: Monster[];
  /** Reserve monsters (pen-equivalent), bounded. */
  reserve: Monster[];
  gold: number;
  scarf: string;
  /** Persistent modular appearance (appearance.ts) — cosmetic only, never read by gameplay. Optional for old saves; migration backfills it. */
  look?: TamerLook;
  goal: TamerGoalKind;
  route: TamerRoute | null;
  /** Creature id of the alpha this tamer is hunting, if any. */
  hunt: string | null;
  /** Rival tamer id this tamer is pursuing, if any. */
  duel: string | null;
  /** Tick until which the tamer lies low after a defeat. */
  recoverUntil: number;
  /** Next decision tick (staggered per tamer; bounded work per tick). */
  nextThink: number;
  career: TamerCareer;
  /** Id of the tournament this tamer is entered in, if any (tournaments.ts). */
  tourney?: string | null;
  knowledge: TamerKnowledge;
  /** Team field positions during a live encounter, key = monster uid. */
  field: Record<string, { x: number; y: number }>;
}

export type EventCategory = "alpha_kill" | "alpha_loss" | "duel" | "tourney";

/**
 * What actually happened — authoritative, never rewritten by rumor (rumors.ts).
 * Events are bounded, append-only history with stable ids; reputation and
 * rumor records reference them rather than duplicating their payload.
 */
export interface WorldEvent {
  /** Stable id, also the idempotency key for every derived record. */
  id: string;
  cat: EventCategory;
  /** Tamer id or "player". */
  subject: string;
  subjectName: string;
  /** Opponent: alpha creature id, rival tamer id, or "player". */
  other: string;
  otherName: string;
  x: number;
  y: number;
  tick: number;
  /** 1–5 significance — scales reputation impact and propagation speed. */
  sig: number;
  won: boolean;
  /** Nation whose territory the event fell in (null = unclaimed wilds). */
  nationId: string | null;
  /** Nearest chapter association, if any (the association channel's key). */
  assocId: string | null;
  alphaSpeciesId: string | null;
  alphaLevel: number | null;
}

/** One holder's copy of an event — a rumor record with provenance and confidence. */
export interface RumorMemory {
  eventId: string;
  learnedTick: number;
  /** 0–1: 1 = eyewitness; decays with every hop. */
  confidence: number;
  /** Where this copy came from: settlement key, tamer id, or "assoc". */
  from: string;
  hops: number;
}

/** A scheduled rumor transfer: one event, one destination, one due tick. */
export interface RumorTransfer {
  eventId: string;
  toKey: string;
  dueTick: number;
  confidence: number;
  from: string;
  hops: number;
}

/** Sparse reputation entry: existence = known; v may sit at 0. */
export interface RepEntry {
  v: number;
  at: number;
}

/** Reputation ledgers for the player and every tamer, four independent scopes (reputation.ts). */
export interface ReputationState {
  /** Subject id → nation id → entry. */
  nations: Record<string, Record<string, RepEntry>>;
  /** Subject id → association id → entry. */
  assocs: Record<string, Record<string, RepEntry>>;
  /** Subject id → settlement key → entry. */
  settlements: Record<string, Record<string, RepEntry>>;
  /** Subject id → guild chapter id → entry (Update D; backfilled for older saves). */
  guilds?: Record<string, Record<string, RepEntry>>;
}

/* ---------------- Living world: economy, trade, developments (Update E) ---------------- */

/** The abstract goods a settlement's granaries and warehouses hold. Bounded counts. */
export type GoodId = "food" | "materials" | "wares";

/**
 * One settlement's economy — the concrete stores and coin behind its needs.
 * Kept per settlement key (`s:x:y`) alongside SettlementNeeds (which stays the
 * contract board's heartbeat): daily production and consumption move these
 * stores, and shortages or surpluses then nudge the needs through
 * applyNeedDelta. The same save always rebuilds the same starting stores.
 */
export interface SettlementEcon {
  food: number;
  materials: number;
  wares: number;
  /** The settlement's coin — drained buying in, filled selling out. Bounded. */
  treasury: number;
  /** In-world day of the last economic step (catch-up is bounded). */
  day: number;
  /** In-world day of the last market day (trade.ts runs it once per day). */
  tradeDay?: number;
}

/** The condition of one trade route between two settlements, key = `r:<aKey>|<bKey>`. */
export interface RouteState {
  /** 0–100: 100 = open road. Disruptions cut it; a slow daily drift repairs it. */
  cond: number;
  /** In-world day of the last route update (catch-up is bounded). */
  day: number;
}

/** The kind of a persistent world development — what the land and its folk are living through. */
export type DevKind = "shortage" | "predators" | "trade" | "discovery" | "bloom";

/** How a development ended: the traveler's work, the world's own hands, or quietly with the season. */
export type DevOutcome = "player" | "world" | "lapsed";

/** A persistent world development in progress — an instance, never the definition. */
export interface DevInstance {
  /** Stable id, also the idempotency key for derived effects. */
  id: string;
  /** Which definition spawned it (DevDef.id in worldevents.ts). */
  defId: DevKind;
  /** Target settlement key (`s:x:y`) — developments always anchor to a community. */
  key: string;
  /** The settlement's own name, frozen at spawn. */
  name: string;
  startedDay: number;
  endsDay: number;
  /** Free parameters: the predator species, the disrupted route key, aid counters. */
  speciesId?: string;
  routeKey?: string;
  progress?: number;
}

/** A finished development in the world's living memory. Bounded. */
export interface DevRecord {
  id: string;
  defId: DevKind;
  key: string;
  name: string;
  startedDay: number;
  endedDay: number;
  outcome: DevOutcome;
}

/** The living-world ledger: bounded active developments, bounded history, spawn cooldowns. */
export interface LivingWorldState {
  active: DevInstance[];
  history: DevRecord[];
  /** Last day a (development kind, settlement) pair fired, key = `${defId}:${key}`. */
  lastFired: Record<string, number>;
  seq: number;
}

/* --------------------------- Tournaments (Update F) ------------------------- */

/** The circuit's formats. Only the Grand Melee is playable; the rest are registered for later phases. */
export type TournamentFormat = "grand_melee" | "round_robin" | "gauntlet" | "team_relay" | "special_trial";

export type TournamentPhase = "registration" | "underway" | "completed";

/** Who steps into the ring: the player, a rival tamer (PAT), or a historical name kept on the circuit's records. */
export type EntrantKind = "player" | "pat" | "historical";

/** A registration-time snapshot of one entrant monster — records, never live bodies. */
export interface EntrantMonster {
  speciesId: string;
  level: number;
  name: string;
}

export interface TourneyEntrant {
  /** "player", a tamer id, or `h:<n>` for a historical name. */
  id: string;
  kind: EntrantKind;
  name: string;
  /** Team as weighed in at registration; used for headless resolution and match bodies. */
  team: EntrantMonster[];
  /** Entry fee actually paid (0 for historical names). */
  feePaid: number;
}

export interface TourneyMatch {
  id: string;
  round: number;
  /** Entrant ids; null on the empty side of a bye. */
  a: string | null;
  b: string | null;
  winner: string | null;
  /** Day the match was decided (null = pending). */
  resolvedDay: number | null;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  /** Host settlement key "x,y", name and tile. */
  hostKey: string;
  hostName: string;
  fx: number;
  fy: number;
  /** Sanctioned events answer to an association; unsanctioned ones answer to no one. */
  sanctioned: boolean;
  assocId: string | null;
  entryFee: number;
  /** Prize gold escrowed from the host's treasury (plus entry fees), paid out exactly once. */
  purse: number;
  /** Eligibility gates (null = open). */
  minRating: number | null;
  maxLevel: number | null;
  createdDay: number;
  /** Registration closes at the end of this day. */
  openDay: number;
  phase: TournamentPhase;
  entrants: TourneyEntrant[];
  /** Generated exactly once, when registration closes; round 0 first. */
  rounds: TourneyMatch[][];
  champion: string | null;
  runnerUp: string | null;
  /** The player's live match in progress, if any (instanced through the real combat engine). */
  pending?: { matchId: string; creatureId: string; x: number; y: number } | null;
  /** Day the current round became due — the player has that day to fight before a forfeit. */
  roundDay?: number;
}

/** One row of the circuit's F–S ranking table, keyed by participant id. */
export interface RatingRow {
  rating: number;
  wins: number;
  losses: number;
  titles: number;
  peak: number;
}

export interface TournamentHistoryEntry {
  id: string;
  day: number;
  name: string;
  hostName: string;
  championId: string;
  championName: string;
  runnerUpName: string;
  entrants: number;
  sanctioned: boolean;
  purse: number;
}

/* ------------- Historical worldbuilding: the generational past (Update G.1) ------------- */

/** What a notable figure of the past did for a living. */
export type HistoricalProfession = "champion" | "explorer" | "scholar" | "official";

/**
 * A figure's state when the player arrives — fixed at generation time and
 * never advanced afterwards. Historical figures are records, never lives:
 * no aging, no roster churn, no new relationships after the player lands.
 */
export type HistoricalStatus = "living" | "retired" | "deceased" | "missing";

export type HistoricalEventKind =
  | "triumph" // took a title on the sand
  | "rivalry" // a standing feud sealed in a bracket
  | "discovery" // a landmark found, a species catalogued
  | "theory" // a scholar's claim about the world
  | "expedition" // an organized journey to verify or recover
  | "failure" // an expedition that came home short
  | "death" // a career ended by the land
  | "disappearance" // a career ended by mystery
  | "founding" // a charter, a circuit, a chapter house
  | "retirement"; // a quiet end, on the figure's own terms

/** One notable figure of the world's past. Ids are also circuit register ids (`h:` prefix). */
export interface HistoricalFigure {
  /** `h:g<n>` — doubles as the tournament circuit's register/ratings id. */
  id: string;
  name: string;
  epithet: string;
  profession: HistoricalProfession;
  /** 1 = founding, 2 = established, 3 = contemporary. */
  generation: number;
  status: HistoricalStatus;
  /** Notables get full biographies, memorials and lore; the ordinary get light records. */
  notability: "notable" | "ordinary";
  homeKey: string;
  homeName: string;
  homeX: number;
  homeY: number;
  /** For the missing: the last place they were credibly seen (a wild landmark). */
  lastX?: number;
  lastY?: number;
  lastPlace?: string;
  /** Negative historical day the career ended (death, disappearance, retirement). */
  endedDay?: number;
  titles: number;
  /** Circuit rating at the end of their career (champions; register rating otherwise). */
  rating: number;
  /** 0–100 — drives dialogue, memorials and lore detail. */
  fame: number;
  /** Built from their own events at generation time; never changes after. */
  bio: string;
  /** Signature beasts, snapshots with real species and lineage ids. */
  team: { speciesId: string; level: number; name: string; lineageId: string | null }[];
  eventIds: string[];
  rivals: string[];
}

/** One entry of the world's event archive — bounded, append-only, causally linked. */
export interface HistoricalEvent {
  /** `he<n>`, in strict day order. */
  id: string;
  /** Negative historical day (−1400…−1): strictly ordered, so causality reads forward. */
  day: number;
  kind: HistoricalEventKind;
  text: string;
  figureIds: string[];
  placeName: string;
  x: number;
  y: number;
  /** Antecedent event ids this event follows from. */
  refs: string[];
  /** The circuit record this event came from, when one exists (`H:`-prefixed id). */
  tourId?: string;
}

/** How a piece of lore was preserved — the provenance the chronicles show. */
export type LoreReliability = "record" | "hearsay";

/** A discoverable reading entry. Records are authoritative; hearsay exaggerates or contradicts. */
export interface LoreEntry {
  /** `lr<n>`. */
  id: string;
  title: string;
  text: string;
  /** Where this copy is kept, as a readable phrase ("the coliseum records at X"). */
  source: string;
  reliability: LoreReliability;
  /** True for hearsay that contradicts the authoritative record of the same events. */
  disputed?: boolean;
  eventId?: string;
  figureId?: string;
  /** The legendary individual (Update G.2) this entry introduces, key into LEGENDS. */
  legendId?: string;
  /** Where the record physically sits — a monument, a hall, a ruin. */
  x?: number;
  y?: number;
}

/** A settlement's persistent tradition, derived from its dominant historical events. */
export interface SettlementCulture {
  key: string;
  tradition: string;
  text: string;
}

/** The world's generational past: figures, their archive, lore and traditions (Update G.1). */
export interface HistoryState {
  figures: HistoricalFigure[];
  events: HistoricalEvent[];
  lore: LoreEntry[];
  /** Settlement traditions, key = settlement id `s:x:y`. */
  cultures: Record<string, SettlementCulture>;
  /** Lore the player has actually read, key = lore id — the discovery gate. */
  found: Record<string, 1>;
  seq: number;
}

/** The tournament circuit's persistent state: bounded actives, bounded history, ratings and payout guards. */
export interface TournamentState {
  seq: number;
  active: Tournament[];
  history: TournamentHistoryEntry[];
  ratings: Record<string, RatingRow>;
  /** Idempotency guards for every payout, key = prize id. */
  paid: Record<string, 1>;
  /** Last day each settlement hosted, key = settlement key. */
  lastHostDay: Record<string, number>;
  /** Historical names ever entered — records only, never simulated lives. */
  register: Record<string, { name: string; rating: number }>;
  /** The player's live match, if one is on the sand right now. */
  pending?: { matchId: string; creatureId: string; x: number; y: number } | null;
}

/* ------------------------- Settlement needs & contracts ---------------------- */

/** What a settlement is like to live in — derived deterministically from seed, biome and tier. */
export type SettlementProfile = "farming" | "mining" | "frontier" | "market";

/**
 * Six bounded (0–100) community stocks for one settlement. Low food, materials
 * or security are open needs the contract board answers; trade and population
 * shape how much work a settlement offers; prosperity scales its pay.
 * Persisted per settlement key (`s:x:y`) and backfilled lazily.
 */
export interface SettlementNeeds {
  food: number;
  materials: number;
  security: number;
  trade: number;
  population: number;
  prosperity: number;
  /** The settlement's way of life (derived once, deterministic). */
  profile: SettlementProfile;
  /** In-world day of the last drift update (drift catch-up is bounded). */
  day: number;
}

/** The eight contract categories. Only categories with working gameplay hooks are ever offered. */
export type ContractCategory =
  | "hunting" // cull N of a real local species
  | "gathering" // bring N of a locally gatherable item
  | "delivery" // bring N trade goods (consumed at the issuing settlement)
  | "exploration" // first-time discovery of a named landmark
  | "monster_handling" // befriend (tame) N monsters — association commissions
  | "investigation" // framework only — no gameplay hook yet, never offered
  | "protection" // framework only — no gameplay hook yet, never offered
  | "ecological"; // framework only — no gameplay hook yet, never offered

export type ContractStatus = "offered" | "active" | "completed" | "failed" | "expired";

export type ContractObjectiveKind = "kill" | "forage" | "deliver" | "discover" | "befriend";

/** One tracked objective. Progress moves only through authoritative gameplay events. */
export interface ContractObjective {
  kind: ContractObjectiveKind;
  /** Player-facing text, e.g. "Cull 3 Cindermaws". */
  label: string;
  /** Hunting / monster handling target species. */
  speciesId?: string;
  /** Gathering / delivery item. */
  itemId?: ItemId;
  /** Exploration destination landmark kind. */
  featureKind?: FeatureId;
  /** Exploration destination (name + coordinates to travel toward). */
  target?: { x: number; y: number; name: string };
  count: number;
  progress: number;
}

export interface ContractReward {
  gold: number;
  items: { id: ItemId; n: number }[];
  /** Settlement-scope reputation (nation/association hear half of it). */
  rep: number;
}

export interface Contract {
  /** Stable id: `c:<x>:<y>:<postedDay>:<slot>` — also the payout idempotency key. */
  id: string;
  category: ContractCategory;
  title: string;
  blurb: string;
  issuer: string;
  issuerRole: string;
  /** Issuing settlement key (`s:x:y`). */
  settlementKey: string;
  settlementName: string;
  /** 1–5, drives pay and expiry. */
  difficulty: number;
  postedDay: number;
  expiresDay: number;
  objectives: ContractObjective[];
  reward: ContractReward;
  status: ContractStatus;
  acceptedDay?: number;
  finishedDay?: number;
}

/** Contract board state: posted offers per settlement, the player's active work, bounded history. */
export interface ContractState {
  /** Offers currently posted, key = settlement key (`s:x:y`). */
  offers: Record<string, Contract[]>;
  active: Contract[];
  /** Bounded, newest last. */
  history: Contract[];
  declined: Record<string, 1>;
  seq: number;
}

/* --------------------- Expeditioner's Guild (Update D) --------------------- */

/** What an expedition is about. The objective framework below is category-agnostic. */
export type ExpeditionCategory =
  | "exploration" // chart the unknown
  | "recovery" // bring back rare resources
  | "investigation" // caves and ruins
  | "tracking" // dangerous monster work
  | "artifact" // recover relics from dangerous places
  | "legendary"; // follow rumors of legendary activity

export type ExpeditionObjectiveKind = "discover" | "reach" | "investigate" | "gather" | "defeat" | "observe";

/** One expedition objective — definition and live progress in one record. */
export interface ExpeditionObjective {
  kind: ExpeditionObjectiveKind;
  /** Player-facing text, e.g. "Discover Gallowfen Ruin". */
  label: string;
  /** Defeat / observe target species. */
  speciesId?: string;
  /** Gather target item. */
  itemId?: ItemId;
  /** Where the work happens (discover/reach/investigate). */
  target?: { x: number; y: number; name: string };
  count: number;
  progress: number;
  /** Index of the objective that must complete first (multi-stage expeditions). */
  prereq?: number;
}

/** Who asked for this work — always distinct from the Guild that administers it. */
export interface ExpeditionCommission {
  kind: "assoc" | "settlement";
  /** Organization id (association id or settlement key). */
  id: string;
  name: string;
}

export interface ExpeditionReward {
  gold: number;
  items: { id: ItemId; n: number }[];
  /** Guild standing gain on completion. */
  standing: number;
  /** Association standing gain (association commissions only). */
  assocRep?: { assocId: string; delta: number };
  /** Settlement standing gain (settlement commissions only). */
  settlementRep?: { key: string; delta: number };
  /** Knowledge the Guild pays for: logged on claim, remembered in history. */
  clue?: string;
}

/** A resolved expedition posted on a chapter's board — definition bound to this world. */
export interface ExpeditionOffer {
  /** Stable id `e:<gx>:<gy>:<day>:<slot>` — also the payout idempotency key. */
  id: string;
  /** The authored definition this offer was resolved from. */
  defId: string;
  title: string;
  blurb: string;
  category: ExpeditionCategory;
  /** 1–5. */
  difficulty: number;
  /** Issuing chapter id (`g:x:y`) and settlement name — the Guild administers. */
  guildKey: string;
  guildName: string;
  /** Commissioning organization, if any — never the Guild itself. */
  commission: ExpeditionCommission | null;
  destName: string;
  dest: { x: number; y: number };
  region: string;
  postedDay: number;
  expiresDay: number;
  objectives: ExpeditionObjective[];
  reward: ExpeditionReward;
  /** Supplies the Guild recommends for the known conditions. */
  recommended: ItemId[];
  /** Minimum party size the Guild will register. */
  minParty: number;
  /** Minimum Guild standing to see (and take) this work. */
  minStanding: number;
  /** The board lifecycle: offered, until a registration takes it. */
  status: "offered" | "active";
}

/** The player's live participation in one expedition. */
export interface ExpeditionInstance {
  offer: ExpeditionOffer;
  /** Participating party monster uids. */
  party: string[];
  /** Supplies deducted from the bag at departure, usable en route. */
  supplies: { id: ItemId; n: number }[];
  /** Supplies actually spent en route (recorded for the results screen). */
  consumed: { id: ItemId; n: number }[];
  startDay: number;
  deadlineDay: number;
  /** Complications survived — field dangers met and lived through. */
  complications: number;
  status: "active" | "completed" | "failed" | "abandoned";
  claimed?: boolean;
}

/** A finished expedition, kept for review (bounded). */
export interface ExpeditionRecord {
  offer: ExpeditionOffer;
  party: string[];
  outcome: "completed" | "failed" | "abandoned";
  day: number;
  objectivesDone: number;
  objectivesTotal: number;
  /** What was actually paid out, as display text. */
  rewardsText: string;
}

/** Guild membership, boards, active work and history (backfilled by migrateExpeditions). */
export interface ExpeditionState {
  /** Tick the player joined the Guild (absent = not a member). */
  memberSince?: number;
  /** Day-stamped board per chapter, key = `g:x:y`. */
  offers?: Record<string, ExpeditionOffer[]>;
  declined?: Record<string, 1>;
  active: ExpeditionInstance[];
  /** Bounded, oldest first. */
  history: ExpeditionRecord[];
  seq: number;
}

/** Construction state of one homestead facility (Update C). */
export interface FacilityState {
  /** Completed levels of this facility. */
  level: number;
  /** The level currently under construction, if any. */
  building?: number;
  /** Tick the current construction job finishes at. */
  completeTick?: number;
}

/** A rectangle of world tiles (Update C.1 property/building/room geometry). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a homestead room does: its designation (Update C.1). */
export type RoomFacility =
  | "housing"
  | "breeding"
  | "nursery"
  | "kitchen"
  | "workshop"
  | "storage"
  | "study"
  | "bedroom";

export type RoomDesignation = RoomFacility | "undesignated";

/** One automatically generated piece of furniture or decoration (Update C.1). */
export interface FurnitureItem {
  /** Deterministic kind key, e.g. "trough" or "shelf". */
  kind: string;
  /** World tile of the piece's origin (inside its room). */
  x: number;
  y: number;
  /** Footprint in tiles (Update C.2; 1×1 when absent). */
  w?: number;
  h?: number;
  /** Decorative pieces never unlock gameplay; functional pieces render the room's function. */
  decorative: boolean;
}

/** A doorway: a wall tile held open between two spaces (Update C.2). */
export interface Doorway {
  x: number;
  y: number;
}

/** A room of a homestead building (Update C.1; true walls per Update C.2). */
export interface RoomRecord {
  id: string;
  buildingId: string;
  /** Interior area in world tiles, walls excluded. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Every doorway on this room's wall ring — interior doorways shared with a
   *  neighbouring room appear in both rooms' lists (Update C.2; backfilled
   *  from the single legacy C.1 door by migrateBuildings). */
  doors: Doorway[];
  designation: RoomDesignation;
  complete: boolean;
  completeTick?: number;
  /** Architectural style id (data-driven visual layer). */
  style: string;
  furniture: FurnitureItem[];
}

/** A prefab-constructed building on the homestead (Update C.1). */
export interface BuildingRecord {
  id: string;
  prefabId: string;
  /** Bounding box in world tiles (walls included). */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 90;
  style: string;
  complete: boolean;
  completeTick?: number;
}

/** The player's owned homestead — one plot of land near a settlement (Update C). */
export interface HomesteadState {
  /** Stable id derived from the owning settlement: `h:<x>:<y>`. */
  id: string;
  name: string;
  /** The settlement the plot was bought from. */
  settlement: { id: string; name: string; x: number; y: number };
  /** The plot tile, just outside the settlement. */
  x: number;
  y: number;
  boughtTick: number;
  /** Facilities built on the plot, key = facility id (backfilled by migrateHomestead). */
  facilities: Record<string, FacilityState>;
  /** Stored goods — the same ItemId keys as the bag (backfilled by migrateHomestead). */
  storage: Partial<Record<ItemId, number>>;
  /** The walkable property bounds (Update C.1; backfilled by migrateHomestead). */
  property?: Rect;
  /** Prefab buildings on the property (Update C.1; backfilled by migrateHomestead). */
  buildings?: BuildingRecord[];
  /** Rooms, flat, each referencing its building (Update C.1; backfilled by migrateHomestead). */
  rooms?: RoomRecord[];
  /** Permanently purchased designation sets, key = facility id (Update C.1; backfilled by migrateHomestead). */
  designations?: Partial<Record<RoomFacility, 1>>;
  /** Id counters for rooms and buildings (Update C.1). */
  roomSeq?: number;
  buildSeq?: number;
  /** Architectural style of the whole homestead (Update C.1). */
  style?: string;
}

/** An egg stolen into the player's pack — living cargo that carries its bloodline. */
export interface CarriedEgg {
  id: string;
  speciesId: string;
  /** The assembled genetic outcome, fixed at conception — the same blueprint a bred baby is born from. */
  child: ChildBlueprint;
  /** Tick the egg was stolen. */
  stolenTick: number;
  /** Tick the egg is ready to hatch (species-dependent incubation). */
  hatchTick: number;
  /** True when taken from a population nursery — this egg was the abstract flock's future. */
  nursery?: boolean;
  /** True when the egg rests in the homestead's nursery (Update C) — it frees a pack slot. */
  homestead?: boolean;
  /** Set the first time the egg announces readiness. */
  announced?: boolean;
  /** Set once the keep-or-release hatch prompt has been shown and put off. */
  prompted?: boolean;
}

export interface GameState {
  version: number;
  seedText: string;
  seed: number;
  tick: number;
  player: Player;
  party: Monster[];
  pen: Monster[];
  bag: Partial<Record<ItemId, number>>;
  creatures: Record<string, WildCreature>;
  loadedChunks: string[];
  removed: Record<string, number>;
  depleted: Record<string, number>;
  log: LogEntry[];
  logSeq: number;
  seen: Record<string, boolean>;
  tamed: Record<string, boolean>;
  regions: Record<string, string>;
  lastWeather: WeatherId;
  lastRegion: string;
  /** Nation id the player currently stands in ("" = unclaimed wilds). */
  lastNation: string;
  stats: GameStats;
  /** Party monster positions on the live map, key = monster uid. */
  field: Record<string, { x: number; y: number }>;
  /** Party standing orders, key = monster uid. */
  orders: Record<string, FieldOrder>;
  /** Per-monster aggression, key = monster uid; a missing key means "neutral". */
  aggr: Record<string, Aggression>;
  /** Queued skill commands, key = monster uid; resolved on the monster's next turn. */
  skillQ: Record<string, SkillOrder>;
  /** The creature the party is currently targeting (wild creature id). */
  target: string | null;
  /** The wild creature the player is tracking (log hints + purple outline). */
  tracked: string | null;
  /** Tick of the last tracking log hint (throttles the stream). */
  trackedHint: number;
  /** Sparse fire/terrain overlays on the live map, key = "x,y". */
  ground: Record<string, GroundTile>;
  /** Combat state per combatant: party uids and wild creature ids. */
  fighters: Record<string, FighterState>;
  uidSeq: number;
  /** Persistent nests built by females, key = nest id. */
  nests: Record<string, Nest>;
  /** Reproductive developments (eggs, gestations), key = development id. */
  developments: Record<string, ReproductiveDevelopment>;
  /** Id counter for nests and development records. */
  broodSeq: number;
  /** Persistent ecological territories, key = territory id. */
  territories: Record<string, Territory>;
  /** Id counter for territories. */
  territorySeq: number;
  /** Population ecology state (Phase 7; backfilled by migrateEcology on load). */
  ecology?: EcologyState;
  /** Persistent lineage records, key = lineage id (Phase 10; backfilled by migrateLineages). */
  lineages?: Record<string, LineageRecord>;
  /** Bounded parent → child ids index for lineage queries (Phase 10). */
  childIndex?: Record<string, string[]>;
  /** Abstract distant populations, key = `d:<layer>:<cx>,<cy>` (Phase 11; backfilled by migrateDistant). */
  distant?: Record<string, DistantRegion>;
  /** Fallen remains that scavengers eat and time rots, key = carrion id (backfilled by migrateCarrion). */
  carrion?: Record<string, Carrion>;
  /** Id counter for carrion. */
  carrionSeq?: number;
  /** Stolen eggs riding in the pack, in carry order (backfilled by migrateEggs). */
  eggs?: CarriedEgg[];
  /** Persistent rival tamers, key = tamer id (backfilled by migrateTamers). */
  tamers?: Record<string, Tamer>;
  /** Id counter for tamers. */
  tamerSeq?: number;
  /** Authoritative career events, oldest first (bounded). */
  events?: WorldEvent[];
  /** Id counter for events. */
  eventSeq?: number;
  /** Rumor memories held per settlement, key = "x,y" (bounded per settlement). */
  rumorBoard?: Record<string, RumorMemory[]>;
  /** Scheduled rumor transfers still on the road. */
  rumorQ?: RumorTransfer[];
  /** Reputation ledgers (backfilled by migrateTamers). */
  rep?: ReputationState;
  /** Idempotency guard: reputation applied per event per community, key = `eventId:settlementKey`. */
  repApplied?: Record<string, 1>;
  /** Rival tamers the player has actually met, key = tamer id. */
  metTamers?: Record<string, { name: string; tick: number }>;
  /** Open grudges between allegiances (tamer ids or "player"), key = sorted pair. */
  grudges?: Record<string, 1>;
  /** Per-settlement community stocks, key = `s:x:y` (backfilled by migrateContracts). */
  settlementNeeds?: Record<string, SettlementNeeds>;
  /** The contract board, active work and history (backfilled by migrateContracts). */
  contracts?: ContractState;
  /** Cooking ledgers: discovered recipes and camp equipment (backfilled by migrateProvisions). */
  cooking?: ProvisionState;
  /** Crafting ledgers: discovered recipes (backfilled by migrateProvisions). */
  crafting?: ProvisionState;
  /** The player's owned homestead, once bought (Update C; backfilled by migrateHomestead). */
  homestead?: HomesteadState;
  /** The Expeditioner's Guild: membership, boards, active expeditions, history (backfilled by migrateExpeditions). */
  expeditions?: ExpeditionState;
  /** Settlement economies — the stores and coin behind the needs (Update E; backfilled by migrateLivingWorld). */
  economy?: Record<string, SettlementEcon>;
  /** Trade-route conditions between settlements, key = `r:<aKey>|<bKey>` (Update E; backfilled by migrateLivingWorld). */
  routes?: Record<string, RouteState>;
  /** The living-world ledger: active developments, history, cooldowns (Update E; backfilled by migrateLivingWorld). */
  living?: LivingWorldState;
  /** The tournament circuit: active events, history, ratings (Update F; backfilled by migrateTournaments). */
  tournaments?: TournamentState;
  /** The world's generational past — figures, archive, lore, traditions (Update G.1; rebuilt from the seed when absent). */
  history?: HistoryState;
  /** Per-legendary discovery ladder, key = legendary species id (Update G.2; backfilled by migrateLegends). */
  legends?: Record<string, LegendaryProgress>;
  knowledge: WorldKnowledge;
}

/** The discovery ladder of one legendary individual (Update G.2). */
export interface LegendaryProgress {
  /** How far the player has come, from first rumor to the final disposition. */
  stage: LegendaryStage;
  /** Tick of the most recent stage change (throttles logging). */
  since: number;
  /** Tick until which a withdrawn body stays home (post-fight cooldown). */
  calmUntil?: number;
}

/** Lifecycle of a legendary individual: rumor → evidence → territory → encounter → disposition. */
export type LegendaryStage =
  | "undiscovered" // nothing known — no lore read, no marker, no body
  | "rumored" // the chronicle entry has been read
  | "evidence" // the physical sign near the territory has been found
  | "located" // the territory itself has been reached
  | "available" // encounter conditions met — the body is present and fightable
  | "fought" // it withdrew; re-challengeable after a cooldown
  | "defeated" // driven off for good — never a death
  | "tamed"; // it chose to follow the player — the body is gone from the wild
