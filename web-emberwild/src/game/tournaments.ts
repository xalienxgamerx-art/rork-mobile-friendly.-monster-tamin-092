import { DAY_TICKS, PARTY_MAX, SPECIES } from "./data";
import { engage } from "./combat";
import { addTreasury, econOf, econPeek, settlementHere } from "./economy";
import { getFactions } from "./factions";
import { addLog } from "./log";
import { createMonster, displayName } from "./monster";
import { hash01, hash2, hashString, Rng } from "./rng";
import { recordEvent } from "./rumors";
import { applyOrgStanding } from "./reputation";
import { isSettlement, settlementId, settlementTier } from "./settlement";
import { makeCreature, partyCanFight } from "./sim";
import { nurseBack, skirmish } from "./tamers";
import type {
  EntrantMonster,
  EntrantKind,
  GameState,
  RatingRow,
  Tournament,
  TournamentFormat,
  TournamentHistoryEntry,
  TournamentState,
  TourneyEntrant,
  TourneyMatch,
} from "./types";
import { getWorld, type Feature } from "./world";

/**
 * The tournament circuit (Update F) — a persistent, world-integrated arena
 * system. Settlements with real wealth host real events; the beast-tamer
 * associations sanction some of them and leave the dustpits to themselves;
 * rival tamers enter on their own judgment; and the whole circuit keeps one
 * shared F–S rating table.
 *
 * Shape of the system, in the project's house style:
 *  - FORMAT DEFINITIONS are static data (below); only the Grand Melee is
 *    playable — the other formats are registered for later phases.
 *  - INSTANCES (Tournament in gs.tournaments.active) are bounded records with
 *    a validated lifecycle: registration → underway → completed → history.
 *  - HOSTING is scaled by settlement tier and treasury: a host escrows its
 *    purse out of its own treasury at creation, so a broke town hosts nothing.
 *  - RESOLUTION uses the one authoritative ruleset at two levels of detail:
 *    the player fights live through the real combat engine (an instanced
 *    body, no overworld side effects), while NPC matches resolve headlessly
 *    through skirmish() — the same coreExchange hit/damage rules the live
 *    map uses. Nothing here keeps a second combat model.
 *  - PRIZES are atomic and idempotent: escrowed gold pays out exactly once,
 *    guarded by gs.tournaments.paid; a failed registration consumes nothing.
 *  - HISTORICAL TAMERS are records, never lives: they fill thin brackets,
 *    keep a rating on the circuit's table, and have no existence beyond it.
 *
 * Every probability is a hash of seed + day + identity — no Math.random, no
 * wall clock; the same save always plays out the same circuit.
 */

/* --------------------------------- config ---------------------------------- */

const ACTIVE_CAP = 3;
/** Sized to hold the full historical record (G.1) plus a living circuit's worth of entries. */
const HISTORY_CAP = 56;
/** Days before the same settlement hosts again, by tier. */
const HOST_COOLDOWN: Record<string, number> = { city: 8, town: 12 };
/** Daily hosting chance once a settlement's cooldown has passed. */
const HOST_CHANCE: Record<string, number> = { city: 0.22, town: 0.14 };
/** Registration window in days. */
const REG_WINDOW: Record<string, number> = { city: 4, town: 3 };
/** Purse range (gold), by tier — funded from the host's treasury. */
const PURSE: Record<string, [number, number]> = { city: [140, 300], town: [50, 120] };
/** PATs decide daily whether to enter, within this range of the host. */
const TOUR_REGION = 200;
/** A thin bracket is padded to at least this many names from the circuit's records. */
const MIN_FIELD = 4;
/** Bracket field is capped here — a Grand Melee is one day's crowd, not a war. */
const MAX_FIELD = 8;
/** How far a live match body may drift from its mark before it is set back. */
const DRIFT_LIMIT = 4;
/** Elo spread per match. */
const K_FACTOR = 24;
const DEFAULT_RATING = 1200;

/** The one mutable ledger, backfilled for older saves. */
export function tourneysOf(gs: GameState): TournamentState {
  const t = (gs.tournaments ??= { seq: 0, active: [], history: [], ratings: {}, paid: {}, lastHostDay: {}, register: {} });
  t.active ??= [];
  t.history ??= [];
  t.ratings ??= {};
  t.paid ??= {};
  t.lastHostDay ??= {};
  t.register ??= {};
  t.seq ??= 0;
  return t;
}

/* ------------------------------- definitions -------------------------------- */

/**
 * Format registry: static, data-driven configuration. Each definition names
 * its resolvable field size and whether the player's own matches go through
 * the live engine. Only the Grand Melee resolves today; the rest are
 * registered so later phases can schedule them without new architecture.
 */
export interface FormatDef {
  id: TournamentFormat;
  name: string;
  /** True when the format resolves today (lifecycle, bracket, rewards). */
  playable: boolean;
  /** Nominal field size the host aims for. */
  field: number;
}

export const FORMATS: Record<TournamentFormat, FormatDef> = {
  grand_melee: { id: "grand_melee", name: "Grand Melee", playable: true, field: 8 },
  round_robin: { id: "round_robin", name: "Round Robin", playable: false, field: 6 },
  gauntlet: { id: "gauntlet", name: "Champion's Gauntlet", playable: false, field: 5 },
  team_relay: { id: "team_relay", name: "Team Relay", playable: false, field: 8 },
  special_trial: { id: "special_trial", name: "Special Trial", playable: false, field: 4 },
};

const SANCTIONED_NAMES = ["The Copper Cup", "The Charter Games", "The Silver Leash", "The Horn & Hoof Open", "The Founder's Melee", "The Hearth Cup"];
const ROGUE_NAMES = ["The Dustpit Trials", "The Backlot Melee", "The Moonlight Scrap", "The Bootleg Brawl", "The Gutter Games"];
/** Historical names kept on the circuit's records — they fill thin brackets and nothing more. */
const HIST_CORE = ["Sefa", "Brant", "Orlo", "Yara", "Colm", "Reva", "Verel", "Wren", "Ulla", "Nash"];
const HIST_EPITHET = ["the Elder", "the Unbroken", "the Quiet", "the Bold", "the Grey", "the Steady", "the Late", "the patient"];

/* --------------------------------- ratings ---------------------------------- */

/** One participant's row, created on first sight. Ids: "player", tamer ids, `h:<n>` historical. */
export function ratingRow(gs: GameState, id: string): RatingRow {
  const t = tourneysOf(gs);
  let r = t.ratings[id];
  if (!r) {
    // historical names start where their record left off; everyone else at par
    const prior = id.startsWith("h:") ? t.register[id]?.rating : undefined;
    r = { rating: prior ?? DEFAULT_RATING, wins: 0, losses: 0, titles: 0, peak: prior ?? DEFAULT_RATING };
    t.ratings[id] = r;
  }
  return r;
}

/** The F–S tier letter for a rating — the circuit's whole public language. */
export function tierOf(rating: number): "F" | "E" | "D" | "C" | "B" | "A" | "S" {
  if (rating >= 1560) return "S";
  if (rating >= 1460) return "A";
  if (rating >= 1360) return "B";
  if (rating >= 1260) return "C";
  if (rating >= 1160) return "D";
  if (rating >= 1060) return "E";
  return "F";
}

/** One Elo exchange, K-factor 24. Deterministic; both rows move. */
function applyResult(gs: GameState, winnerId: string, loserId: string): void {
  const w = ratingRow(gs, winnerId);
  const l = ratingRow(gs, loserId);
  const expW = 1 / (1 + Math.pow(10, (l.rating - w.rating) / 400));
  w.rating = Math.round(w.rating + K_FACTOR * (1 - expW));
  l.rating = Math.round(Math.max(100, l.rating + K_FACTOR * (0 - expW)));
  w.wins += 1;
  l.losses += 1;
  w.peak = Math.max(w.peak, w.rating);
  l.peak = Math.max(l.peak, l.rating);
}

/** The ranking table, best first (bounded to the rows that exist). */
export function rankings(gs: GameState, limit = 12): { id: string; name: string; row: RatingRow }[] {
  const t = tourneysOf(gs);
  const rows = Object.keys(t.ratings).map((id) => ({ id, name: displayNameOf(gs, id), row: t.ratings[id] }));
  rows.sort((a, b) => b.row.rating - a.row.rating || a.id.localeCompare(b.id));
  return rows.slice(0, limit);
}

function displayNameOf(gs: GameState, id: string): string {
  if (id === "player") return gs.player.name;
  if (gs.tamers?.[id]) return gs.tamers[id].name;
  return gs.tournaments?.register[id]?.name ?? id;
}

/* ------------------------------ team snapshots ------------------------------ */

/** A registration-time snapshot of a live team — records, never live bodies. */
function snapshotTeam(gs: GameState, team: { speciesId: string; level: number; uid: string }[]): EntrantMonster[] {
  return team.slice(0, PARTY_MAX).map((m) => ({ speciesId: m.speciesId, level: m.level, name: displayName(m as never) }));
}

/** Rebuilds a transient team from a snapshot for headless resolution. */
function materializeTeam(gs: GameState, entrant: TourneyEntrant, salt: number) {
  return entrant.team.map((m, i) =>
    createMonster(gs, m.speciesId, Math.max(1, m.level), { seed: hash2(gs.seed ^ 0x70a7 ^ salt, hashString(entrant.id), i + 1), origin: "The circuit", mutations: [] }),
  );
}

/* ------------------------------- eligibility -------------------------------- */

export interface Eligibility {
  ok: boolean;
  reason: string;
}

/** Whether one participant may enter one tournament — pure checks, no side effects. */
export function checkEligibility(gs: GameState, tour: Tournament, entrantId: string, kind: EntrantKind, team: EntrantMonster[], gold: number): Eligibility {
  if (tour.phase !== "registration") return { ok: false, reason: "Registration is closed." };
  if (tour.entrants.some((e) => e.id === entrantId)) return { ok: false, reason: "Already entered." };
  if (tour.entrants.length >= MAX_FIELD) return { ok: false, reason: "The field is full." };
  if (kind !== "historical") {
    if (gold < tour.entryFee) return { ok: false, reason: "The entry fee is beyond your purse." };
    if (tour.minRating !== null && ratingRow(gs, entrantId).rating < tour.minRating) return { ok: false, reason: "Your circuit rating is too low for this bracket." };
    if (tour.maxLevel !== null && team.length && Math.max(...team.map((m) => m.level)) > tour.maxLevel) return { ok: false, reason: "This bracket is for lesser teams." };
    if (!team.length) return { ok: false, reason: "No beast to enter." };
  }
  return { ok: true, reason: "" };
}

/* ------------------------------- registration ------------------------------- */

/** The player enters one tournament: fee paid once, party weighed in as-is. Never heals, never invents strength. */
export function registerPlayer(gs: GameState, tourId: string): string | null {
  const t = tourneysOf(gs);
  const tour = t.active.find((x) => x.id === tourId);
  if (!tour) return "No such tournament.";
  const here = settlementHere(gs);
  if (!here || settlementId(here) !== tour.hostKey) return "You must stand in the host settlement to enter.";
  const team = snapshotTeam(gs, gs.party);
  const el = checkEligibility(gs, tour, "player", "player", team, gs.player.gold);
  if (!el.ok) return el.reason;
  gs.player.gold -= tour.entryFee;
  tour.purse += tour.entryFee;
  tour.entrants.push({ id: "player", kind: "player", name: gs.player.name, team, feePaid: tour.entryFee });
  addLog(gs, `You enter ${tour.name} at ${tour.hostName} — ${tour.entryFee} gold on the line, your team weighed in as it stands.`, "event");
  return null;
}

/** Rival tamers decide for themselves, once a day, from where they stand. */
function patRegistration(gs: GameState, tour: Tournament, day: number): void {
  const tamers = gs.tamers;
  if (!tamers) return;
  for (const t of Object.values(tamers)) {
    if (t.tourney) continue;
    if (t.recoverUntil > gs.tick) continue;
    if (Math.max(Math.abs(t.x - tour.fx), Math.abs(t.y - tour.fy)) > TOUR_REGION) continue;
    const team = snapshotTeam(gs, t.team);
    if (!checkEligibility(gs, tour, t.id, "pat", team, t.gold).ok) continue;
    const roll = hash01(gs.seed ^ 0x70e2, day, hashString(t.id) ^ hashString(tour.id));
    if (roll > 0.35) continue;
    t.gold -= tour.entryFee;
    tour.purse += tour.entryFee;
    t.tourney = tour.id;
    tour.entrants.push({ id: t.id, kind: "pat", name: t.name, team, feePaid: tour.entryFee });
  }
}

/** Historical names fill a thin bracket: records only, drawn from the circuit's own register. */
function fillHistorical(gs: GameState, tour: Tournament): void {
  const t = tourneysOf(gs);
  let n = 0;
  // the circuit's own past walks in first: living champions of the old
  // generations still compete (Update G.1), ordered by a deterministic hash.
  // Retired, deceased and missing figures never register — records, not lives.
  const living = gs.history
    ? gs.history.figures
        .filter((f) => f.status === "living" && f.profession === "champion" && !tour.entrants.some((e) => e.id === f.id))
        .sort((a, b) => hash2(gs.seed ^ 0x70e9, hashString(a.id), hashString(b.id)) - hash2(gs.seed ^ 0x70e9, hashString(b.id), hashString(a.id)))
    : [];
  for (const f of living) {
    if (tour.entrants.length >= MIN_FIELD) break;
    t.register[f.id] = t.register[f.id] ?? { name: f.name, rating: f.rating };
    tour.entrants.push({
      id: f.id,
      kind: "historical",
      name: f.name,
      team: f.team.map((m) => ({ speciesId: m.speciesId, level: m.level, name: m.name })),
      feePaid: 0,
    });
  }
  while (tour.entrants.length < MIN_FIELD && tour.entrants.length < MAX_FIELD) {
    const h = hash2(gs.seed ^ 0x70e3, hashString(tour.id), n * 31 + 7);
    const core = HIST_CORE[h % HIST_CORE.length];
    const epi = HIST_EPITHET[(h >>> 9) % HIST_EPITHET.length];
    const name = `${core} ${epi}`;
    const hid = `h:${hashString(`${tour.id}:${name}`) & 0xffff}`;
    if (tour.entrants.some((e) => e.id === hid)) break;
    // the register keeps their name and last rating — records, never lives
    const prior = t.register[hid];
    t.register[hid] = prior ?? { name, rating: 1150 + (h >>> 16) % 250 };
    const rating = t.register[hid].rating;
    const level = Math.max(3, Math.round((rating - 1000) / 22));
    const world = getWorld(gs.seed);
    const team: EntrantMonster[] = [];
    for (let i = 0; i < 2; i++) {
      const sp = world.pickSpecies(world.tile(tour.fx, tour.fy).biome, hash2(h, i + 1, 17)) ?? Object.keys(SPECIES)[0];
      team.push({ speciesId: sp, level, name: SPECIES[sp]?.name ?? "beast" });
    }
    tour.entrants.push({ id: hid, kind: "historical", name, team, feePaid: 0 });
    n++;
  }
}

/* ----------------------------- bracket building ----------------------------- */

/** Deterministic single-elimination seed order for a power-of-two field. */
function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(order.length * 2 - 1 - s);
    }
    order = next;
  }
  return order;
}

/**
 * Builds the Grand Melee bracket exactly once: entrants seeded by rating
 * (ties by id), byes to the top seeds when the field is not a power of two.
 */
function buildBracket(gs: GameState, tour: Tournament): void {
  const sorted = [...tour.entrants].sort((a, b) => {
    const ra = a.id === "player" ? ratingRow(gs, "player").rating : a.id.startsWith("h:") ? gs.tournaments?.register[a.id]?.rating ?? DEFAULT_RATING : ratingRow(gs, a.id).rating;
    const rb = b.id === "player" ? ratingRow(gs, "player").rating : b.id.startsWith("h:") ? gs.tournaments?.register[b.id]?.rating ?? DEFAULT_RATING : ratingRow(gs, b.id).rating;
    return rb - ra || a.id.localeCompare(b.id);
  });
  let size = 1;
  while (size < sorted.length) size *= 2;
  const order = seedOrder(size);
  const slot: (string | null)[] = [];
  for (let i = 0; i < size; i++) slot.push(order[i] < sorted.length ? sorted[order[i]].id : null);
  const rounds: TourneyMatch[][] = [];
  let width = size / 2;
  for (let r = 0; width >= 1; r++) {
    const matches: TourneyMatch[] = [];
    for (let m = 0; m < width; m++) {
      matches.push({
        id: `${tour.id}:r${r}m${m}`,
        round: r,
        a: r === 0 ? slot[m * 2] : null,
        b: r === 0 ? slot[m * 2 + 1] : null,
        winner: null,
        resolvedDay: null,
      });
    }
    rounds.push(matches);
    width /= 2;
  }
  tour.rounds = rounds;
  tour.phase = "underway";
  tour.roundDay = Math.floor(gs.tick / DAY_TICKS);
}

/* -------------------------------- resolution -------------------------------- */

/** The current round: the first with any undecided match (null when done). */
function currentRound(tour: Tournament): { round: number; matches: TourneyMatch[] } | null {
  for (let r = 0; r < tour.rounds.length; r++) {
    if (tour.rounds[r].some((m) => !m.winner)) return { round: r, matches: tour.rounds[r] };
  }
  return null;
}

function winnerOfMatch(gs: GameState, tour: Tournament, match: TourneyMatch, winnerId: string, day: number): void {
  if (match.winner) return; // duplicate advancement is a no-op
  match.winner = winnerId;
  match.resolvedDay = day;
  // feed the next round
  for (let r = match.round + 1; r < tour.rounds.length; r++) {
    const next = tour.rounds[r].find((m) => m.id === `${tour.id}:r${r}m${Math.floor(Number(match.id.split("m")[1]) / 2 ** (r - match.round))}`);
    if (!next) break;
    if (next.a === null) next.a = winnerId;
    else if (next.b === null) next.b = winnerId;
    break;
  }
  // records: Elo for both sides, careers for rival tamers
  const loserId = winnerId === match.a ? match.b : match.a;
  if (loserId) {
    applyResult(gs, winnerId, loserId);
    for (const [id, won] of [[winnerId, true], [loserId, false]] as [string, boolean][]) {
      if (!id.startsWith("t")) continue;
      const tamer = gs.tamers?.[id];
      if (!tamer) continue;
      tamer.career.battles += 1;
      if (won) tamer.career.wins += 1;
      else {
        tamer.career.losses += 1;
        tamer.tourney = null; // a beaten tamer is out and about again
      }
    }
  }
}

/** One headless NPC-vs-NPC match: the shared combat rules, no map. */
function resolveNpcMatch(gs: GameState, tour: Tournament, match: TourneyMatch, day: number): void {
  const a = tour.entrants.find((e) => e.id === match.a);
  const b = tour.entrants.find((e) => e.id === match.b);
  if (!a || !b) return;
  const sideA = { id: a.id, name: a.name, team: materializeTeam(gs, a, 1) };
  const sideB = { id: b.id, name: b.name, team: materializeTeam(gs, b, 2) };
  const won = skirmish(gs, sideA, sideB) === "a";
  // transient bodies are nursed and dropped; the ledger keeps only the result
  nurseBack(gs, sideA.team);
  nurseBack(gs, sideB.team);
  winnerOfMatch(gs, tour, match, won ? a.id : b.id, day);
}

/* --------------------------- the player's live match ------------------------ */

/** The player's undecided match in the current round, if any. */
export function playerMatch(gs: GameState): { tour: Tournament; match: TourneyMatch; opponent: TourneyEntrant } | null {
  const t = gs.tournaments;
  if (!t) return null;
  for (const tour of t.active) {
    if (tour.phase !== "underway") continue;
    const cur = currentRound(tour);
    if (!cur) continue;
    const match = cur.matches.find((m) => !m.winner && (m.a === "player" || m.b === "player"));
    if (!match) continue;
    const oppId = match.a === "player" ? match.b : match.a;
    const opponent = tour.entrants.find((e) => e.id === oppId);
    if (opponent) return { tour, match, opponent };
  }
  return null;
}

/**
 * Starts the player's pending match: the opponent's weighed-in team steps
 * onto the sand as one instanced body (id prefix `tour:`, no overworld side
 * effects) and the real combat engine takes over.
 */
export function fightPlayerMatch(gs: GameState): string | null {
  const pm = playerMatch(gs);
  if (!pm) return "No match is waiting for you.";
  const { tour, match, opponent } = pm;
  if (gs.tournaments?.pending) return "You are already in a match.";
  const here = settlementHere(gs);
  if (!here || settlementId(here) !== tour.hostKey) return "You must stand in the host settlement to fight.";
  if (!partyCanFight(gs)) return "Your team cannot fight — see a healer first.";
  const lead = opponent.team[0];
  if (!lead) return "Your opponent fields no beast.";
  const cid = `tour:${tour.id}:${match.id}`;
  const c = makeCreature(cid, lead.speciesId, gs.player.x, gs.player.y, Math.max(1, lead.level), hash2(gs.seed ^ 0x70e5, hashString(cid), 7), false);
  c.disposition = "aggressive";
  gs.creatures[cid] = c;
  const pend = { matchId: match.id, creatureId: cid, x: gs.player.x, y: gs.player.y };
  gs.tournaments.pending = pend;
  tour.pending = pend; // the bracket's own pointer to the live match
  engage(gs, cid, false);
  addLog(gs, `A hush, a horn — your match against ${opponent.name}'s ${SPECIES[lead.speciesId]?.name.toLowerCase() ?? "beast"} begins!`, "combat");
  return null;
}

/**
 * Per-tick watch over the player's live match: cheap early-exit otherwise.
 * A downed opponent ends the match in a win; a fainted team in a loss; a
 * long walk-away counts as yielding the field.
 */
export function tournamentsTick(gs: GameState): void {
  const pending = gs.tournaments?.pending;
  if (!pending) return;
  const t = tourneysOf(gs);
  const tour = t.active.find((x) => x.pending?.matchId === pending.matchId);
  const pm = playerMatch(gs);
  const match = pm?.tour.rounds.flat().find((m) => m.id === pending.matchId);
  if (!tour || !match) {
    gs.tournaments.pending = null;
    return;
  }
  const c = gs.creatures[pending.creatureId];
  // the opponent never wanders far from its mark — this is a ring, not the wilds
  if (c && Math.max(Math.abs(c.x - pending.x), Math.abs(c.y - pending.y)) > DRIFT_LIMIT) {
    c.x = pending.x;
    c.y = pending.y;
  }
  let won: boolean | null = null;
  if (!c) won = true; // downed: killWild removed the body
  else if (!partyCanFight(gs)) won = false;
  else if (Math.max(Math.abs(gs.player.x - pending.x), Math.abs(gs.player.y - pending.y)) > 20) won = false;
  if (won === null) return;
  const day = Math.floor(gs.tick / DAY_TICKS);
  gs.tournaments.pending = null;
  tour.pending = null;
  if (!c) {
    // win: the body is already gone; nothing else to clean
  } else {
    // loss or forfeit: the opponent returns to its pen — no body roams the world
    delete gs.creatures[c.id];
    delete gs.fighters[c.id];
    if (gs.target === c.id) gs.target = null;
  }
  const opponent = pm?.opponent;
  winnerOfMatch(gs, pm!.tour, match, won ? "player" : opponent!.id, day);
  addLog(gs, won ? `The match is yours — ${opponent!.name}'s beast yields the sand.` : `The match goes to ${opponent!.name}. The crowd is not kind.`, won ? "good" : "bad");
}

/* --------------------------------- rewards ---------------------------------- */

/** Pays one prize exactly once, from the escrowed purse. */
function payPrize(gs: GameState, tour: Tournament, prizeId: string, entrant: TourneyEntrant, amount: number): void {
  if (amount <= 0) return;
  const t = tourneysOf(gs);
  const key = `pz:${tour.id}:${prizeId}`;
  if (t.paid[key]) return;
  t.paid[key] = 1;
  tour.purse -= amount;
  if (entrant.kind === "player") {
    gs.player.gold += amount;
    addLog(gs, `The steward of ${tour.hostName} counts ${amount} gold into your hand.`, "good");
  } else if (entrant.kind === "pat") {
    const tamer = gs.tamers?.[entrant.id];
    if (tamer) tamer.gold += amount;
  }
  // historical names keep the title, never the coin: leftovers stay escrowed
  // until the tournament closes and returns them to the host below
}

/* -------------------------------- completion -------------------------------- */

function completeTournament(gs: GameState, tour: Tournament, day: number, quiet = false): void {
  const finalRound = tour.rounds[tour.rounds.length - 1];
  const final = finalRound[0];
  if (!final?.winner) return;
  tour.champion = final.winner;
  tour.runnerUp = final.winner === final.a ? final.b : final.a;
  const champ = tour.entrants.find((e) => e.id === tour.champion);
  const second = tour.entrants.find((e) => e.id === tour.runnerUp);
  if (!champ) return;
  // prizes: 70/30 of the escrowed purse, each paid at most once
  payPrize(gs, tour, "c", champ, Math.round(tour.purse * 0.7));
  if (second) payPrize(gs, tour, "r", second, Math.round(tour.purse * 0.3));
  // anything left (a historical champion's unclaimed coin) returns to the host
  if (tour.purse > 0) addTreasury(gs, tour.hostKey, tour.purse);
  // titles and the sanctioned standing
  ratingRow(gs, champ.id).titles += 1;
  if (tour.sanctioned && tour.assocId) {
    applyOrgStanding(gs, champ.id, "assocs", tour.assocId, 4, `tourney:${tour.id}`);
    applyOrgStanding(gs, champ.id, "settlements", tour.hostKey, 2, `tourney:${tour.id}`);
  }
  // the champion's deed enters the world's own event ledger — historical
  // runs (Update G.1) keep their deeds in the archive instead, so the live
  // rumor world never hears about days before its own founding
  if (quiet) {
    finishHistory(gs, tour, champ, second, day);
    return;
  }
  const fac = getFactions(gs.seed);
  recordEvent(gs, {
    cat: "tourney",
    subject: champ.id,
    subjectName: champ.name,
    other: second?.id ?? "",
    otherName: second?.name ?? "an open field",
    x: tour.fx,
    y: tour.fy,
    tick: gs.tick,
    sig: tour.purse >= 200 ? 4 : tour.purse >= 100 ? 3 : 2,
    won: true,
    nationId: fac.nationAt(tour.fx, tour.fy)?.id ?? null,
    assocId: tour.sanctioned ? tour.assocId : null,
    alphaSpeciesId: null,
    alphaLevel: null,
  });
  // the circuit's history
  const rec: TournamentHistoryEntry = {
    id: tour.id,
    day,
    name: tour.name,
    hostName: tour.hostName,
    championId: champ.id,
    championName: champ.name,
    runnerUpName: second?.name ?? "—",
    entrants: tour.entrants.length,
    sanctioned: tour.sanctioned,
    purse: tour.purse,
  };
  const t = tourneysOf(gs);
  t.history.push(rec);
  if (t.history.length > HISTORY_CAP) t.history.splice(0, t.history.length - HISTORY_CAP);
  // entrants are free for the next event
  for (const e of tour.entrants) {
    if (e.kind !== "pat") continue;
    const tamer = gs.tamers?.[e.id];
    if (tamer && tamer.tourney === tour.id) tamer.tourney = null;
  }
  if (gs.knowledge.discovered[`f:${tour.fx}:${tour.fy}`]) {
    addLog(gs, `${tour.name} at ${tour.hostName} is over: ${champ.name} takes the title${second ? ` over ${second.name}` : ""}.`, champ.id === "player" ? "good" : "info");
  }
  tour.phase = "completed";
  t.active = t.active.filter((x) => x.id !== tour.id);
}

/** The shared tail of completion: titles, the history entry, entrant cleanup. */
function finishHistory(gs: GameState, tour: Tournament, champ: TourneyEntrant, second: TourneyEntrant | undefined, day: number): void {
  const t = tourneysOf(gs);
  const rec: TournamentHistoryEntry = {
    id: tour.id,
    day,
    name: tour.name,
    hostName: tour.hostName,
    championId: champ.id,
    championName: champ.name,
    runnerUpName: second?.name ?? "—",
    entrants: tour.entrants.length,
    sanctioned: tour.sanctioned,
    purse: tour.purse,
  };
  t.history.push(rec);
  if (t.history.length > HISTORY_CAP) t.history.splice(0, t.history.length - HISTORY_CAP);
  tour.phase = "completed";
}

/**
 * Runs one historical tournament (Update G.1): the standard bracket over the
 * given entrants, every match resolved headlessly through the standard
 * skirmish machinery, the result filed in the circuit's own history. The tour
 * is never active — it happened before the player arrived. Entrant ids must
 * already be registered (`h:` prefix) so the bracket and ratings find them.
 */
export function runHistoricalTournament(gs: GameState, tour: Tournament, entrants: TourneyEntrant[]): void {
  const t = tourneysOf(gs);
  tour.entrants = entrants;
  for (const e of entrants) {
    if (!e.id.startsWith("h:")) continue;
    t.register[e.id] = t.register[e.id] ?? { name: e.name, rating: DEFAULT_RATING };
  }
  const day = tour.createdDay;
  buildBracket(gs, tour);
  // historical days are negative; matches resolve at the event's own day.
  // The materialized bodies are transient, and combat rolls hash the fighter
  // uid — so uidSeq is pinned per match to keep the replay exact no matter
  // when in a save's life the past is regenerated.
  const savedTick = gs.tick;
  const savedUid = gs.uidSeq;
  gs.tick = day * DAY_TICKS;
  let guard = 0;
  while (tour.phase === "underway" && guard++ < 8) {
    const cur = currentRound(tour);
    if (!cur) break;
    for (const m of cur.matches) {
      if (m.winner) continue;
      if (m.a && m.b) {
        gs.uidSeq = savedUid;
        resolveNpcMatch(gs, tour, m, day);
      } else if (m.a || m.b) winnerOfMatch(gs, tour, m, (m.a ?? m.b)!, day); // a bye walks through
    }
  }
  gs.uidSeq = savedUid;
  // the transient bodies left fighter-state behind — drop it, the ledger keeps only results
  const keep = new Set(Object.keys(gs.fighters));
  completeTournament(gs, tour, day, true);
  gs.tick = savedTick;
  for (const k of Object.keys(gs.fighters)) if (!keep.has(k)) delete gs.fighters[k];
}

/* --------------------------------- hosting ---------------------------------- */

/** The venue building of a host settlement, for lore and UI: the coliseum where one stands, else the chapter grounds, else the inn. */
export function venueName(gs: GameState, f: Feature): string {
  const layout = getWorld(gs.seed).settlementLayout(f);
  const b = layout.building("coliseum") ?? layout.building("association") ?? layout.building("assoc_hq") ?? layout.building("inn");
  return b?.type === "coliseum" ? `${f.name} Coliseum` : b?.type === "association" ? `the chapter grounds at ${f.name}` : b?.type === "assoc_hq" ? `the great hall at ${f.name}` : `the inn yard at ${f.name}`;
}

/** Creates one tournament at a settlement, funded from its own treasury. Exported for tests and future seasons. */
export function proclaimTournament(gs: GameState, f: Feature, day: number): Tournament | null {
  const t = tourneysOf(gs);
  const tier = settlementTier(f) === "city" ? "city" : "town";
  const fac = getFactions(gs.seed);
  const assoc = fac.associationAt(f) ?? fac.headquartersAt(f);
  const sanctioned = !!assoc;
  const h = hash2(gs.seed ^ 0x70e6, day, f.x * 7 + f.y);
  const [lo, hi] = PURSE[tier] ?? PURSE.town;
  econOf(gs, f); // the economy record must exist before the escrow lands in it
  // the host can only promise coin it actually has
  const econ = econPeek(gs, f);
  const purse = Math.min(hi - lo === 0 ? lo : lo + (h % Math.max(1, hi - lo)), Math.floor(((econ?.treasury ?? 0) - 10) * 0.5));
  if (purse < 20) return null;
  const namePool = sanctioned ? SANCTIONED_NAMES : ROGUE_NAMES;
  const name = `${namePool[h % namePool.length]}${sanctioned ? "" : " (unsanctioned)"}`;
  const tour: Tournament = {
    id: `T${(t.seq ?? 0) + 1}`,
    name,
    format: "grand_melee",
    hostKey: settlementId(f),
    hostName: f.name,
    fx: f.x,
    fy: f.y,
    sanctioned,
    assocId: assoc?.id ?? null,
    entryFee: Math.max(2, Math.round(purse * 0.08)),
    purse,
    minRating: null,
    maxLevel: !sanctioned && tier === "town" && h % 3 === 0 ? 10 : null,
    createdDay: day,
    openDay: day + (REG_WINDOW[tier] ?? 3),
    phase: "registration",
    entrants: [],
    rounds: [],
    champion: null,
    runnerUp: null,
    pending: null,
  };
  t.seq += 1;
  t.active.push(tour);
  t.lastHostDay[tour.hostKey] = day;
  addTreasury(gs, tour.hostKey, -purse); // escrow: the host's coin is promised
  if (gs.knowledge.discovered[`f:${f.x}:${f.y}`]) {
    addLog(gs, `${name} is proclaimed at ${venueName(gs, f)} — ${purse} gold in prizes, entry ${tour.entryFee} gold. Registration is open.`, "event");
  }
  return tour;
}

function worldTier(f: Feature): "town" | "city" {
  const k = f.kind;
  return k === "city" ? "city" : "town";
}

/**
 * The circuit's daily beat, inside advance()'s day block: close brackets,
 * resolve rounds, complete events, and let one new tournament be proclaimed.
 */
export function advanceTournaments(gs: GameState): void {
  const day = Math.floor(gs.tick / DAY_TICKS);
  const t = tourneysOf(gs);
  // 1. lifecycle for every active event
  for (const tour of [...t.active]) {
    if (tour.phase === "registration") {
      patRegistration(gs, tour, day);
      if (day >= tour.openDay) {
        if (tour.entrants.length < 2) {
          // too few names: every fee comes home and the escrow returns to the till —
          // a called-off event costs the entrants and the host nothing
          let fees = 0;
          for (const e of tour.entrants) {
            fees += e.feePaid;
            if (e.kind === "player") gs.player.gold += e.feePaid;
            else if (e.kind === "pat") {
              const tamer = gs.tamers?.[e.id];
              if (tamer) tamer.gold += e.feePaid;
            }
            if (e.kind === "pat") {
              const tamer = gs.tamers?.[e.id];
              if (tamer && tamer.tourney === tour.id) tamer.tourney = null;
            }
          }
          addTreasury(gs, tour.hostKey, tour.purse - fees);
          tour.purse = 0;
          t.active = t.active.filter((x) => x.id !== tour.id);
          if (gs.knowledge.discovered[`f:${tour.fx}:${tour.fy}`]) addLog(gs, `${tour.name} at ${tour.hostName} is quietly called off — too few names came forward.`, "info");
        } else {
          fillHistorical(gs, tour);
          buildBracket(gs, tour);
        }
      }
      continue;
    }
    if (tour.phase === "underway") {
      const cur = currentRound(tour);
      if (!cur) {
        completeTournament(gs, tour, day);
        continue;
      }
      const playerHere = playerMatch(gs)?.tour.id === tour.id;
      for (const m of cur.matches) {
        if (m.winner) continue;
        if (m.a === "player" || m.b === "player") {
          // the player's match: live when they show, a forfeit the day after
          if (day > (tour.roundDay ?? day) && !gs.tournaments?.pending) {
            const opponent = tour.entrants.find((e) => e.id === (m.a === "player" ? m.b : m.a));
            if (opponent) winnerOfMatch(gs, tour, m, opponent.id, day);
          }
          continue;
        }
        if (m.a && m.b) resolveNpcMatch(gs, tour, m, day);
        else winnerOfMatch(gs, tour, m, (m.a ?? m.b)!, day); // a bye walks through
      }
      if (playerHere && !gs.tournaments?.pending) tour.roundDay = day; // the player has today
      const still = currentRound(tour);
      if (!still) completeTournament(gs, tour, day);
      continue;
    }
  }
  // 2. at most one new event is proclaimed per day, world-wide
  if (t.active.length >= ACTIVE_CAP || t.active.some((x) => x.createdDay === day)) return;
  const world = getWorld(gs.seed);
  const hosts: Feature[] = [];
  for (const k in gs.knowledge.discovered) {
    if (!k.startsWith("f:")) continue;
    const [, x, y] = k.split(":").map(Number);
    const f = world.tile(x, y).feature;
    if (!f || !isSettlement(f)) continue;
    const tier = worldTier(f);
    if (tier !== "city" && tier !== "town") continue;
    const since = t.lastHostDay[settlementId(f)];
    if (since !== undefined && day - since < (HOST_COOLDOWN[tier] ?? 12)) continue;
    hosts.push(f);
  }
  if (!hosts.length) return;
  for (const f of hosts) {
    const tier = worldTier(f);
    const roll = hash01(gs.seed ^ 0x70e8, day, f.x * 13 + f.y);
    if (roll < (HOST_CHANCE[tier] ?? 0.14)) {
      proclaimTournament(gs, f, day);
      break;
    }
  }
}

/* --------------------------------- migration -------------------------------- */

/** Migration backfill (v32): the circuit's ledgers start empty. Idempotent. */
export function migrateTournaments(gs: GameState): void {
  tourneysOf(gs);
  for (const t of Object.values(gs.tamers ?? {})) t.tourney ??= null;
}

/* ------------------------------ size guard ---------------------------------- */

/** Debug helper: bounded state size (mapcheck). */
export function tournamentsStateSize(gs: GameState): number {
  const t = gs.tournaments;
  return (
    (t?.active.length ?? 0) +
    (t?.history.length ?? 0) +
    Object.keys(t?.ratings ?? {}).length +
    Object.keys(t?.paid ?? {}).length +
    Object.keys(t?.lastHostDay ?? {}).length +
    Object.keys(t?.register ?? {}).length
  );
}
