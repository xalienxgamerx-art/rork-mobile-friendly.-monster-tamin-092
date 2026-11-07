import { DAY_TICKS, SPECIES, SPECIES_LIST, WORLD_SIZE } from "./data";
import { GENE_KEYS } from "./genetics";
import { getFactions } from "./factions";
import { addLog } from "./log";
import { hash2, hashString } from "./rng";
import { isSettlement, settlementId, settlementTier } from "./settlement";
import { runHistoricalTournament, tourneysOf } from "./tournaments";
import type {
  HistoricalEvent,
  HistoricalEventKind,
  HistoricalFigure,
  HistoricalProfession,
  HistoricalStatus,
  GameState,
  Genes,
  HistoryState,
  LineageRecord,
  LoreEntry,
  SettlementCulture,
  TourneyEntrant,
  Tournament,
} from "./types";
import { FEATURE_CELL, getWorld, type Feature } from "./world";
import { appendLegendLore, legendLoreRead } from "./legends";

/**
 * The world's generational past (Update G.1).
 *
 * Before the player arrives, three generations of notable tamers — champions,
 * explorers, scholars, officials — live and work in these lands. Their
 * careers run through the existing engines (the Update F tournament circuit
 * resolves every historical bracket headlessly; monster teams come from the
 * real species tables with real lineage ids), and their deeds leave an event
 * archive that lore, settlement traditions and mysteries are derived from.
 *
 * House rules, the same as every other system here:
 *  - DETERMINISTIC. Every roll is a hash of the world seed; identical seeds
 *    raise identical pasts. No Math.random, no wall clock.
 *  - RECORDS, NOT LIVES. Historical figures never enter the autonomous
 *    tamer loop: no aging, no roster churn, no new relationships after
 *    generation. Identities are seed facts; only the records they generated
 *    (careers, events, tournament results, lore) are persisted, in
 *    gs.history, because they depend on simulated outcomes.
 *  - ONE TOURNAMENT ENGINE. Historical competitions are real entries in the
 *    circuit's own ledgers with `H:`-prefixed ids and negative days.
 *  - BOUNDED BY CONSTRUCTION. Caps on figures, events, lore and famous
 *    bloodlines; per-figure detail tiering (full biographies for notables,
 *    light records for the ordinary population).
 */

/* --------------------------------- config ----------------------------------- */

/** Historical day windows per generation — all before the player's day 1. */
const GEN_WINDOWS: [number, number][] = [
  [-1400, -1000],
  [-950, -500],
  [-460, -10],
];
/** Notable figures per generation — about fifty lives in total. */
const PER_GEN = [20, 18, 14];
/** Hard caps: the archive stays a bounded part of the save. */
const TOURNAMENT_CAP = 14;
const MEMORIAL_CAP = 8;
const LORE_CAP = 64;
const FAMOUS_LINES_CAP = 10;

const FIRST_NAMES = ["Sefa", "Brant", "Orlo", "Yara", "Colm", "Reva", "Verel", "Wren", "Ulla", "Nash", "Mera", "Doss", "Kell", "Iva", "Piet", "Tam", "Halvard", "Ysolt", "Maro", "Bren", "Osric", "Petra", "Quill", "Ansel", "Dagna", "Merrit", "Ista", "Grita"];
const EPITHETS = ["the Elder", "the Unbroken", "the Quiet", "the Bold", "the Grey", "the Steady", "the Patient", "the Late", "the Younger", "the Keen", "the Far-Walked", "the Stone-Wise", "the Twice-Crowned", "the Lost", "the Just", "the Kindled", "the Frostbound", "the Shielded"];
/** The earliest, half-forgotten names — fields too thin for even the records. */
const DUST_NAMES = ["Aldous", "Berrin", "Casca", "Dunny", "Effram", "Flett", "Gower", "Hob", "Isley", "Jarn"];

const HIST_TOURN_NAMES = ["The Copper Cup", "The Charter Games", "The Silver Leash", "The Horn & Hoof Open", "The Founder's Melee", "The Hearth Cup", "The Dawnstone Open", "The Long Sand Cup"];

const CULTURE_BY_PROFESSION: Record<HistoricalProfession, { tradition: string; text: (name: string, place: string) => string }> = {
  champion: {
    tradition: "competitive town",
    text: (n, p) => `The sand is swept daily and the ledger is never closed — ${p} rears champions the way other towns rear sheep. Elders still name ${n} among their own.`,
  },
  explorer: {
    tradition: "expedition port",
    text: (n, p) => `Rope, boots and hard cheese are stocked year-round — ${p} outfits expeditions the way other towns hold markets. Every path out of town is named for someone who did not come back, ${n}'s among them.`,
  },
  scholar: {
    tradition: "scholars' rest",
    text: (n, p) => `Questions are respectable here, and the association hall keeps its lamps lit late — ${p} argues over bloodlines the way other towns argue over water rights. ${n}'s notes are still passed around.`,
  },
  official: {
    tradition: "seat of charters",
    text: (n, p) => `Charters are read aloud on the green and disputes settle in writing before they settle in blood — ${p} keeps the paperwork of half the region. ${n} signed more of it than anyone.`,
  },
};

/* ------------------------------- working types ------------------------------ */

/** An event before the archive is sorted and stamped with ids. */
interface DraftEvent {
  day: number;
  kind: HistoricalEventKind;
  text: string;
  figureIds: string[];
  placeName: string;
  x: number;
  y: number;
  refs: DraftEvent[];
  tourId?: string;
}

/* -------------------------------- generation -------------------------------- */

/** Settlements on a stride-3 sweep of the feature grid (the tamer roster's census). */
function censusSettlements(world: ReturnType<typeof getWorld>): Feature[] {
  const cells = Math.ceil(WORLD_SIZE / FEATURE_CELL);
  const out: Feature[] = [];
  for (let cy = 0; cy < cells; cy += 3) {
    for (let cx = 0; cx < cells; cx += 3) {
      const f = world.featureCell(cx, cy);
      if (f && isSettlement(f)) out.push(f);
    }
  }
  return out;
}

/** Wild landmarks (ruins, shrines) on a stride-2 sweep — where expeditions go missing. */
function censusLandmarks(world: ReturnType<typeof getWorld>): Feature[] {
  const cells = Math.ceil(WORLD_SIZE / FEATURE_CELL);
  const out: Feature[] = [];
  for (let cy = 0; cy < cells; cy += 2) {
    for (let cx = 0; cx < cells; cx += 2) {
      const f = world.featureCell(cx, cy);
      if (f && (f.kind === "ruin" || f.kind === "shrine")) out.push(f);
    }
  }
  return out;
}

function rollStatus(gen: number, h: number): HistoricalStatus {
  const r = (h >>> 24) % 100;
  if (gen === 1) return r < 58 ? "deceased" : r < 84 ? "retired" : "missing";
  if (gen === 2) return r < 34 ? "deceased" : r < 66 ? "retired" : r < 88 ? "living" : "missing";
  return r < 56 ? "living" : r < 78 ? "retired" : r < 90 ? "missing" : "deceased";
}

/**
 * Builds the whole generational past for a world. Deterministic from the
 * seed; runs once per game (newGame or first migration) and never advances
 * again afterwards.
 */
function generate(gs: GameState): HistoryState {
  const seed = gs.seed;
  // Regeneration must replay the past exactly: a first pass leaves end-of-career
  // ratings, titles and prize marks in the circuit's tables, and those would bend
  // the Elo replay. The historical namespace (`h:g<n>` figures, `h:f<n>` field
  // filler, `H:` tour ids) is ours alone — live fillers are bare `h:<number>` —
  // so purge it and replay from a clean slate. Live records are untouched.
  const t = gs.tournaments;
  if (t) {
    const histKey = /^(h:(?:g|f)\d+|H:)/;
    for (const k of Object.keys(t.register)) if (/^h:(?:g|f)\d+$/.test(k)) delete t.register[k];
    for (const k of Object.keys(t.ratings)) if (/^h:(?:g|f)\d+$/.test(k)) delete t.ratings[k];
    for (const k of Object.keys(t.paid)) if (k.includes(":H:")) delete t.paid[k];
    t.history = t.history.filter((h) => !histKey.test(h.id));
  }
  const world = getWorld(seed);
  const fac = getFactions(seed, world);
  const hist: HistoryState = { figures: [], events: [], lore: [], cultures: {}, found: {}, seq: 0 };
  const settlements = censusSettlements(world);
  const landmarks = censusLandmarks(world);
  const hostTowns = settlements.filter((f) => settlementTier(f) !== "hamlet");
  const hosts = hostTowns.length ? hostTowns : settlements;
  const usedNames = new Set<string>();
  const drafts: DraftEvent[] = [];
  let tourSeq = 0;
  let tournamentCount = 0;
  let memorialCount = 0;
  let loreCount = 0;

  const pickFrom = <T,>(arr: T[], h: number, shift: number): T => arr[(h >>> shift) % arr.length];

  for (let gen = 1; gen <= 3; gen++) {
    const [lo, hi] = GEN_WINDOWS[gen - 1];
    // -- the generation's people ------------------------------------------------
    const born: HistoricalFigure[] = [];
    for (let i = 0; i < PER_GEN[gen - 1]; i++) {
      const h = hash2(seed ^ 0x6e01, gen * 61 + i, 0x9e37);
      const home = pickFrom(settlements, h, 0);
      const profRoll = (h >>> 6) % 100;
      const profession: HistoricalProfession = profRoll < 40 ? "champion" : profRoll < 65 ? "explorer" : profRoll < 85 ? "scholar" : "official";
      const notability = (h >>> 12) % 100 < 60 ? "notable" : "ordinary";
      let name = "";
      for (let k = 0; k < FIRST_NAMES.length && !name; k++) {
        const candidate = `${FIRST_NAMES[(h >>> 8) % FIRST_NAMES.length]} ${EPITHETS[(h >>> (10 + 5 * k)) % EPITHETS.length]}`;
        if (!usedNames.has(candidate)) name = candidate;
      }
      if (!name) name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${DUST_NAMES[i % DUST_NAMES.length]}`;
      usedNames.add(name);
      const status = rollStatus(gen, h);
      const day = lo + (h >>> 4) % (hi - lo);
      const [name0, epithet] = splitName(name);
      const fig: HistoricalFigure = {
        id: `h:g${hist.figures.length + born.length + 1}`,
        name,
        epithet,
        profession,
        generation: gen,
        status,
        notability,
        homeKey: settlementId(home),
        homeName: home.name,
        homeX: home.x,
        homeY: home.y,
        titles: 0,
        rating: profession === "champion" ? 1150 + (h >>> 16) % 260 : 1000 + (h >>> 16) % 200,
        fame: notability === "notable" ? 20 : 6,
        bio: "",
        team: [],
        eventIds: [],
        rivals: [],
      };
      if (status === "deceased" || status === "missing") fig.endedDay = day;
      // signature beasts: real species of the home country, snapshot records
      const teamCount = profession === "champion" ? 2 + (h >>> 20) % 2 : 1 + (h >>> 20) % 2;
      for (let m = 0; m < teamCount; m++) {
        const biome = world.tile(home.x, home.y).biome;
        const sp = world.pickSpecies(biome, hash2(seed ^ 0x6e11, fig.id.length * 31 + m, i * 7 + m)) ?? Object.keys(SPECIES)[0];
        const level = Math.max(3, Math.round((fig.rating - 1000) / 22) + (profession === "champion" ? 2 : 0) - m);
        fig.team.push({ speciesId: sp, level, name: SPECIES[sp]?.name ?? "beast", lineageId: null });
      }
      born.push(fig);
    }
    hist.figures.push(...born);

    // -- careers: champions fight the real circuit ------------------------------
    for (const fig of born) {
      if (fig.profession !== "champion" || tournamentCount >= TOURNAMENT_CAP) continue;
      const h = hash2(seed ^ 0x6e21, hashString(fig.id), 0x51de);
      const tours = Math.min(2 + (h % 3), TOURNAMENT_CAP - tournamentCount);
      for (let k = 0; k < tours; k++) {
        const th = hash2(seed ^ 0x6e22, hashString(fig.id), k * 71 + 3);
        const day = fig.endedDay !== undefined ? Math.min(lo + (th % Math.max(1, fig.endedDay - lo)), fig.endedDay - 5) : lo + (th % (hi - lo));
        const host = pickFrom(hosts, th, 8);
        // a field of peers: other champions whose careers were still live that day
        const peers = hist.figures.filter(
          (f) => f.id !== fig.id && f.profession === "champion" && (f.status === "living" || f.status === "retired" || (f.endedDay ?? Infinity) > day),
        );
        const entrants: TourneyEntrant[] = [entrantOf(fig)];
        const field = 4 + (th >>> 10) % 4;
        for (let p = 0; p < field - 1 && peers.length; p++) {
          const peer = pickFrom(peers, th, 14 + p);
          if (!entrants.some((e) => e.id === peer.id)) entrants.push(entrantOf(peer));
        }
        while (entrants.length < Math.min(field, 8)) {
          const dn = DUST_NAMES[(th >>> (4 + entrants.length)) % DUST_NAMES.length];
          // `h:f<n>`: the historical-filler namespace — live fillers are bare numbers
          const did = `h:f${(hashString(`${fig.id}:${k}:${dn}`) & 0xffff) + 40000}`;
          if (entrants.some((e) => e.id === did)) break;
          entrants.push({ id: did, kind: "historical", name: `${dn} ${pickFrom(EPITHETS, th, 20)}`, team: fillerTeam(gs, host, th, entrants.length), feePaid: 0 });
        }
        const assoc = fac.associationAt(host) ?? fac.headquartersAt(host);
        const tour: Tournament = {
          id: `H:${++tourSeq}`,
          name: `${pickFrom(HIST_TOURN_NAMES, th, 24)}${assoc ? "" : " (unsanctioned)"}`,
          format: "grand_melee",
          hostKey: settlementId(host),
          hostName: host.name,
          fx: host.x,
          fy: host.y,
          sanctioned: !!assoc,
          assocId: assoc?.id ?? null,
          entryFee: 0,
          purse: 40 + (th >>> 6) % 160,
          minRating: null,
          maxLevel: null,
          createdDay: day,
          openDay: day - 1,
          phase: "registration",
          entrants: [],
          rounds: [],
          champion: null,
          runnerUp: null,
          pending: null,
        };
        runHistoricalTournament(gs, tour, entrants);
        tournamentCount++;
        const winnerFig = hist.figures.find((f) => f.id === tour.champion);
        const runnerFig = hist.figures.find((f) => f.id === tour.runnerUp);
        for (const e of entrants) {
          const f = hist.figures.find((x) => x.id === e.id);
          if (f) f.rating = gs.tournaments?.ratings[e.id]?.rating ?? f.rating;
        }
        if (winnerFig && winnerFig.id === fig.id) {
          fig.titles++;
          fig.fame = Math.min(100, fig.fame + 24);
          drafts.push({ day: day + 1, kind: "triumph", text: `${fig.name} took the ${tour.name} at ${host.name} over ${runnerFig?.name ?? tour.entrants.find((e) => e.id === tour.runnerUp)?.name ?? "an open field"}.`, figureIds: [fig.id], placeName: host.name, x: host.x, y: host.y, refs: [], tourId: tour.id });
        } else {
          const rival = winnerFig;
          if (rival && rival.id !== fig.id && !fig.rivals.includes(rival.id)) {
            fig.rivals.push(rival.id);
            if (!rival.rivals.includes(fig.id)) rival.rivals.push(fig.id);
          }
          drafts.push({
            day: day + 1,
            kind: rival ? "rivalry" : "failure",
            text: rival
              ? `${fig.name} fell to ${rival.name} in the ${tour.name} at ${host.name} — a feud the crowd kept score of for years.`
              : `${fig.name} entered the ${tour.name} at ${host.name} and left the sand quietly, beaten by ${tour.entrants.find((e) => e.id === tour.champion)?.name ?? "a name nobody kept"}.`,
            figureIds: [fig.id, ...(rival ? [rival.id] : [])],
            placeName: host.name,
            x: host.x,
            y: host.y,
            refs: [],
            tourId: tour.id,
          });
        }
      }
      const row = gs.tournaments?.ratings[fig.id];
      if (row) fig.titles = row.titles;
      const reg = tourneysOf(gs).register[fig.id];
      if (reg) reg.rating = fig.rating;
    }

    // -- careers: explorers, scholars, officials --------------------------------
    for (const fig of born) {
      const h = hash2(seed ^ 0x6e31, hashString(fig.id), 0x4e71);
      if (fig.profession === "explorer") {
        const trips = 1 + (h % 3);
        for (let k = 0; k < trips; k++) {
          const eh = hash2(seed ^ 0x6e32, hashString(fig.id), k * 53 + 7);
          const spot = pickFrom(landmarks, eh, 6);
          const day = fig.endedDay !== undefined && k === trips - 1 ? fig.endedDay : lo + (eh % Math.max(1, (fig.endedDay ?? hi) - lo));
          const last = k === trips - 1;
          if (last && fig.status === "missing") {
            fig.lastX = spot.x;
            fig.lastY = spot.y;
            fig.lastPlace = spot.name;
            drafts.push({
              day,
              kind: "disappearance",
              text: `${fig.name} set out from ${fig.homeName} for the ${spot.name} with two weeks of provisions. The search party found the camp tidy, the fire cold, and no tracks leaving.`,
              figureIds: [fig.id],
              placeName: spot.name,
              x: spot.x,
              y: spot.y,
              refs: [],
            });
            fig.fame = Math.min(100, fig.fame + 26);
          } else if (last && fig.status === "deceased") {
            drafts.push({ day, kind: "expedition", text: `${fig.name}'s last expedition pressed past the ${spot.name}, further than the maps allowed.`, figureIds: [fig.id], placeName: spot.name, x: spot.x, y: spot.y, refs: [] });
            drafts.push({ day: day + 1, kind: "death", text: `${fig.name} was carried home to ${fig.homeName} from the ${spot.name}. The beast that did it was never named.`, figureIds: [fig.id], placeName: spot.name, x: spot.x, y: spot.y, refs: [] });
            fig.fame = Math.min(100, fig.fame + 22);
          } else {
            const sp = world.pickSpecies(world.tile(spot.x, spot.y).biome, eh >>> 12);
            drafts.push({
              day,
              kind: "discovery",
              text: `${fig.name} reached the ${spot.name}${sp ? ` and brought back a live sketch of a ${SPECIES[sp]?.name.toLowerCase() ?? "beast"} nobody could name` : " and returned with maps that changed the trade roads"}.`,
              figureIds: [fig.id],
              placeName: spot.name,
              x: spot.x,
              y: spot.y,
              refs: [],
            });
            fig.fame = Math.min(100, fig.fame + 20);
          }
        }
      }
      // the missing of any profession need a last-known landmark — the waystone
      // that keeps their mystery open (the Narrative Event Orchestrator's seed corn)
      if (fig.profession !== "explorer" && fig.status === "missing") {
        const mh = hash2(seed ^ 0x6e34, hashString(fig.id), 0x33ad);
        const spot = pickFrom(landmarks, mh, 6);
        fig.lastX = spot.x;
        fig.lastY = spot.y;
        fig.lastPlace = spot.name;
        drafts.push({
          day: fig.endedDay ?? hi - 10,
          kind: "disappearance",
          text: `${fig.name} walked out of ${fig.homeName} toward the ${spot.name} and did not come back. The waystone went up a season later.`,
          figureIds: [fig.id],
          placeName: spot.name,
          x: spot.x,
          y: spot.y,
          refs: [],
        });
        fig.fame = Math.min(100, fig.fame + 20);
      }
      if (fig.profession === "scholar") {
        const papers = 1 + (h % 2);
        for (let k = 0; k < papers; k++) {
          const sh = hash2(seed ^ 0x6e33, hashString(fig.id), k * 47 + 11);
          // a theory is written about something: the newest discovery before the theory's day
          const prior = drafts.filter((d) => d.kind === "discovery" && d.day < lo + (sh % Math.max(1, hi - lo)));
          const basis = prior.length ? prior[prior.length - 1] : null;
          const day = Math.max(lo, basis ? basis.day + 30 + (sh % 60) : lo + (sh % (hi - lo)));
          const sp = SPECIES_LIST[(sh >>> 8) % SPECIES_LIST.length];
          const theory: DraftEvent = {
            day,
            kind: "theory",
            text: `${fig.name} of ${fig.homeName} argued${basis ? `, against the plain reading of ${basis.placeName}` : ""}, that the ${sp.name} breeds true only where the old stones still stand. The chapter hall called it speculation.`,
            figureIds: [fig.id],
            placeName: fig.homeName,
            x: fig.homeX,
            y: fig.homeY,
            refs: basis ? [basis] : [],
          };
          drafts.push(theory);
          fig.fame = Math.min(100, fig.fame + 16);
          // sometimes an expedition later verifies or buries the theory
          if (sh % 2 === 0) {
            const verifier = hist.figures.find((f) => f.profession === "explorer" && f.generation >= fig.generation && f.id !== fig.id && (f.status === "living" || f.status === "retired" || (f.endedDay ?? Infinity) > day + 40));
            const spot = pickFrom(landmarks, sh, 14);
            const vday = Math.min(day + 60 + (sh % 120), hi);
            if (verifier) {
              drafts.push({
                day: vday,
                kind: sh % 4 === 0 ? "failure" : "expedition",
                text:
                  sh % 4 === 0
                    ? `${verifier.name}'s expedition to the ${spot.name} was meant to test ${fig.name}'s claim about the ${sp.name}. It came home short two tamers, and the question open.`
                    : `${verifier.name} confirmed what ${fig.name} only dared argue: the ${sp.name} keeps to the old stones. The chapter hall rewrote its notices.`,
                figureIds: [fig.id, verifier.id],
                placeName: spot.name,
                x: spot.x,
                y: spot.y,
                refs: [theory],
              });
              fig.fame = Math.min(100, fig.fame + 12);
            }
          }
        }
      }
      if (fig.profession === "official") {
        const deeds = h % 2 === 0 ? 1 : 2;
        for (let k = 0; k < deeds; k++) {
          const oh = hash2(seed ^ 0x6e34, hashString(fig.id), k * 41 + 13);
          const day = lo + (oh % Math.max(1, hi - lo));
          const here = pickFrom(hosts, oh, 6);
          const tourHere = drafts.find((d) => (d.kind === "triumph" || d.kind === "rivalry") && d.placeName === here.name && d.day < day);
          drafts.push({
            day,
            kind: "founding",
            text: tourHere
              ? `${fig.name} chartered the ${here.name} games into the association's calendar, ending years of disputes over purses and brands — ${tourHere.text}`
              : `${fig.name} settled the ${here.name} brand dispute in writing: every beast entered at the scales bears the hall's mark, and the fee pays the steward.`,
            figureIds: [fig.id],
            placeName: here.name,
            x: here.x,
            y: here.y,
            refs: tourHere ? [tourHere] : [],
          });
          fig.fame = Math.min(100, fig.fame + 18);
        }
      }
    }

    // -- mentors: the older generation trains the next at the same home ---------
    for (const fig of born) {
      const elder = hist.figures.find((f) => f.generation === gen - 1 && f.homeKey === fig.homeKey && (f.profession === "champion" || f.profession === "scholar") && f.status !== "missing");
      if (elder) fig.bio = `${fig.name} trained under ${elder.name} of ${elder.homeName}, as did half the tamers of this generation. `;
    }
  }

  // -- stamp the archive: strict day order, stable ids, resolved references ----
  drafts.sort((a, b) => a.day - b.day || a.placeName.localeCompare(b.placeName));
  const ids = new Map<DraftEvent, string>();
  for (const d of drafts) ids.set(d, `he${hist.seq++}`);
  for (const d of drafts) {
    const ev: HistoricalEvent = {
      id: ids.get(d)!,
      day: d.day,
      kind: d.kind,
      text: d.text,
      figureIds: [...new Set(d.figureIds)],
      placeName: d.placeName,
      x: d.x,
      y: d.y,
      refs: d.refs.map((r) => ids.get(r)!).filter(Boolean),
      tourId: d.tourId,
    };
    hist.events.push(ev);
    for (const fid of ev.figureIds) {
      const f = hist.figures.find((x) => x.id === fid);
      if (f) f.eventIds.push(ev.id);
    }
  }

  // -- biographies: composed from each figure's own recorded deeds -------------
  for (const fig of hist.figures) {
    fig.bio += bioOf(fig, hist);
  }

  // -- famous bloodlines: the real lineage system, seeded by the past ----------
  const famous = hist.figures.filter((f) => f.fame >= 55 && f.team.length).slice(0, FAMOUS_LINES_CAP);
  for (const fig of famous) {
    const lid = `L:${fig.id}`;
    const peak = {} as Genes;
    const h = hash2(seed ^ 0x6e41, hashString(fig.id), 0x9e37);
    for (const k of GENE_KEYS) peak[k] = 62 + (h >>> (k.length % 24)) % 36;
    const rec: LineageRecord = {
      id: lid,
      speciesId: fig.team[0].speciesId,
      foundedTick: (GEN_WINDOWS[fig.generation - 1]?.[0] ?? -1400) * DAY_TICKS,
      depth: fig.generation + 1,
      living: 0,
      historical: 4 + h % 8,
      peakGenes: peak,
      notable: [],
      members: [],
    };
    gs.lineages = gs.lineages ?? {};
    gs.lineages[lid] = rec;
    fig.team[0].lineageId = lid;
  }

  // -- settlement cultures: the archive's dominant note becomes a tradition ----
  const tally = new Map<string, Map<HistoricalProfession, number>>();
  const firstCitizen = new Map<string, HistoricalFigure>();
  for (const ev of hist.events) {
    const key = `s:${ev.x}:${ev.y}`;
    const fig = hist.figures.find((f) => f.id === ev.figureIds[0]);
    if (!fig) continue;
    const prof = fig.profession;
    if (!tally.has(key)) tally.set(key, new Map());
    const m = tally.get(key)!;
    m.set(prof, (m.get(prof) ?? 0) + 1);
    const incumbent = firstCitizen.get(key);
    if (!incumbent || fig.fame > incumbent.fame) firstCitizen.set(key, fig);
  }
  for (const [key, m] of tally) {
    let best: HistoricalProfession = "champion";
    let bestN = -1;
    for (const [prof, n] of m) if (n > bestN) ((best = prof), (bestN = n));
    const citizen = firstCitizen.get(key);
    if (!citizen) continue;
    const def = CULTURE_BY_PROFESSION[best];
    hist.cultures[key] = { key, tradition: def.tradition, text: def.text(citizen.name, key) };
  }

  // -- lore: records and the rumors that grow around them ----------------------
  for (const ev of hist.events) {
    if (loreCount >= LORE_CAP) break;
    const fig = hist.figures.find((f) => f.id === ev.figureIds[0]);
    if (!fig || fig.notability !== "notable") continue;
    if (ev.kind === "discovery") {
      hist.lore.push({
        id: `lr${hist.lore.length}`,
        title: `The ${ev.placeName} journal`,
        text: ev.text,
        source: `a weathered expedition journal, filed at the ${ev.placeName}`,
        reliability: "record",
        eventId: ev.id,
        figureId: fig.id,
        x: ev.x,
        y: ev.y,
      });
      loreCount++;
      if (loreCount < LORE_CAP && hash2(seed ^ 0x6e51, hashString(ev.id), 7) % 10 < 4) {
        const exaggeration = `${fig.name}, they say, walked into the ${ev.placeName} alone and came out leading a beast no leash could hold. The journal version is duller, and duller things are usually true.`;
        hist.lore.push({
          id: `lr${hist.lore.length}`,
          title: `What they say about the ${ev.placeName}`,
          text: exaggeration,
          source: `tavern talk, carried back to ${fig.homeName}`,
          reliability: "hearsay",
          disputed: true,
          eventId: ev.id,
          figureId: fig.id,
          x: fig.homeX,
          y: fig.homeY,
        });
        loreCount++;
      }
    } else if (ev.kind === "triumph") {
      hist.lore.push({
        id: `lr${hist.lore.length}`,
        title: `${fig.name} — a champion's record`,
        text: `${ev.text} The circuit's own ledger keeps the bracket; the crowd kept the rest.`,
        source: `the coliseum records at ${ev.placeName}`,
        reliability: "record",
        eventId: ev.id,
        figureId: fig.id,
        x: ev.x,
        y: ev.y,
      });
      loreCount++;
    } else if (ev.kind === "theory") {
      hist.lore.push({
        id: `lr${hist.lore.length}`,
        title: `${fig.name}'s notes on the old stones`,
        text: ev.text,
        source: `research notes, kept at the hall in ${fig.homeName}`,
        reliability: "record",
        disputed: ev.refs.length > 0 && hist.events.some((e) => e.id === ev.refs[0] && e.kind === "failure"),
        eventId: ev.id,
        figureId: fig.id,
        x: ev.x,
        y: ev.y,
      });
      loreCount++;
    }
  }
  // memorials: the notable dead are remembered at home (bounded)
  for (const fig of hist.figures) {
    if (memorialCount >= MEMORIAL_CAP || loreCount >= LORE_CAP) break;
    if (fig.notability !== "notable" || (fig.status !== "deceased" && fig.status !== "missing")) continue;
    hist.lore.push({
      id: `lr${hist.lore.length}`,
      title: fig.status === "missing" ? `${fig.name} — never found` : `The memorial of ${fig.name}`,
      text: fig.bio,
      source: fig.status === "missing" ? `the waystone at the ${fig.lastPlace ?? "wilds"}` : `the memorial stone at ${fig.homeName}`,
      reliability: "record",
      figureId: fig.id,
      x: fig.status === "missing" ? (fig.lastX ?? fig.homeX) : fig.homeX,
      y: fig.status === "missing" ? (fig.lastY ?? fig.homeY) : fig.homeY,
    });
    loreCount++;
    memorialCount++;
  }
  // the five scorched legend-stones (Update G) — appended once, guarded
  appendLegendLore(hist, seed);
  return hist;
}

function splitName(name: string): [string, string] {
  const i = name.indexOf(" the ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ""];
}

/** A registration-time entrant record for one historical figure. */
function entrantOf(fig: HistoricalFigure): TourneyEntrant {
  return {
    id: fig.id,
    kind: "historical",
    name: fig.name,
    team: fig.team.map((m) => ({ speciesId: m.speciesId, level: m.level, name: m.name })),
    feePaid: 0,
  };
}

/** Filler teams for the earliest, thinnest fields: home-biome beasts, real species. */
function fillerTeam(gs: GameState, host: Feature, h: number, i: number): { speciesId: string; level: number; name: string }[] {
  const world = getWorld(gs.seed);
  const out: { speciesId: string; level: number; name: string }[] = [];
  for (let m = 0; m < 2; m++) {
    const sp = world.pickSpecies(world.tile(host.x, host.y).biome, hash2(h, i * 7 + m, 17)) ?? Object.keys(SPECIES)[0];
    out.push({ speciesId: sp, level: 4 + ((h >>> m) % 5), name: SPECIES[sp]?.name ?? "beast" });
  }
  return out;
}

function bioOf(fig: HistoricalFigure, hist: HistoryState): string {
  const feats = hist.events.filter((e) => e.figureIds.includes(fig.id));
  const rival = fig.rivals.length ? hist.figures.find((f) => f.id === fig.rivals[0]) : null;
  const mentor = fig.bio ? fig.bio.replace(/ as did half the tamers of this generation\. /, "") : "";
  const parts: string[] = [];
  if (mentor && fig.bio) parts.push(mentor.trim());
  if (fig.profession === "champion") {
    parts.push(
      fig.status === "living"
        ? `${fig.titles} title${fig.titles === 1 ? "" : "s"} on the circuit and still walking the sand at ${fig.homeName}.`
        : fig.status === "retired"
          ? `Retired at ${fig.homeName} with ${fig.titles} title${fig.titles === 1 ? "" : "s"}; the records keep ${feats.length} fought days under the name.`
          : `${fig.titles} title${fig.titles === 1 ? "" : "s"}, ${feats.length} fought days, and an ending${fig.status === "missing" ? " nobody witnessed" : ""}.`,
    );
  } else if (fig.profession === "explorer") {
    const found = feats.filter((e) => e.kind === "discovery").length;
    parts.push(
      fig.status === "missing"
        ? `${found} mapped discoveries, then the ${fig.lastPlace ?? "wilds"} took the rest. Listed as missing, never as dead.`
        : `${found} discoveries in the record, each one a place the maps had to grow for.`,
    );
  } else if (fig.profession === "scholar") {
    parts.push(`${feats.filter((e) => e.kind === "theory").length} argument${feats.some((e) => e.kind === "theory" && e.refs.length) ? ", at least one of them vindicated" : "s with the chapter hall"}, all of them about what the land keeps in its old bones.`);
  } else {
    parts.push(`${feats.filter((e) => e.kind === "founding").length} charter${feats.length === 1 ? "" : "s"} and a signature that still appears on the association's forms.`);
  }
  if (rival) parts.push(`The rivalry with ${rival.name} is the part the ballads kept.`);
  return parts.join(" ");
}

/* --------------------------------- runtime ---------------------------------- */

/**
 * The world's history — generated once, deterministically, when a save first
 * meets this build. Old saves rebuild the identical past from their seed, so
 * migration is exact and idempotent.
 */
export function historyOf(gs: GameState): HistoryState {
  if (!gs.history) gs.history = generate(gs);
  return gs.history;
}

/** Fresh generation for a new game (the state is known to be historyless). */
export function generateHistory(gs: GameState): HistoryState {
  gs.history = generate(gs);
  return gs.history;
}

export function figureOf(gs: GameState, id: string): HistoricalFigure | null {
  return gs.history?.figures.find((f) => f.id === id) ?? null;
}

/** The living figures placed in the world — champions on the circuit, working scholars and officials. */
export function livingFigures(gs: GameState): HistoricalFigure[] {
  return gs.history ? gs.history.figures.filter((f) => f.status === "living") : [];
}

/** Lore entries anchored to a tile — monuments, journals, waystones. */
export function loreAt(gs: GameState, x: number, y: number): LoreEntry[] {
  return (gs.history?.lore ?? []).filter((l) => l.x === x && l.y === y);
}

/** Lore entries tied to one figure's life. */
export function loreForFigure(gs: GameState, figureId: string): LoreEntry[] {
  return (gs.history?.lore ?? []).filter((l) => l.figureId === figureId);
}

/**
 * Marks lore as actually read, once each, and says so in the log. This is
 * the chronicles' whole discovery gate: a record exists whether or not the
 * player has stood in front of it — but only found entries are readable.
 */
export function readChronicles(gs: GameState, entries: LoreEntry[]): number {
  if (!gs.history) return 0;
  let added = 0;
  let firstTitle = "";
  for (const e of entries) {
    if (gs.history.found[e.id]) continue;
    if (!firstTitle) firstTitle = e.title;
    gs.history.found[e.id] = 1;
    added++;
    // a legend's chronicle is the ladder's first rung (Update G)
    if (e.legendId) legendLoreRead(gs, e.legendId);
  }
  if (added === 1) addLog(gs, `You add “${firstTitle}” to your chronicles.`, "info");
  else if (added > 1) addLog(gs, `${added} records enter your chronicles.`, "info");
  return added;
}

/** One figure's tale: their lore, discovered in one reading. */
export function readFigure(gs: GameState, figureId: string): number {
  return readChronicles(gs, loreForFigure(gs, figureId));
}

/** What the player has actually read, oldest archive entry first. */
export function chronicleEntries(gs: GameState): { found: LoreEntry[]; locked: number } {
  const hist = gs.history;
  if (!hist) return { found: [], locked: 0 };
  const found = hist.lore.filter((l) => hist.found[l.id]);
  return { found, locked: hist.lore.length - found.length };
}

/** The persistent tradition of a settlement, if its past earned one. */
export function cultureOf(gs: GameState, key: string): SettlementCulture | undefined {
  return gs.history?.cultures[key];
}

/** The archive event this settlement remembers "on this day", rotating by the calendar. */
export function anniversaryEvent(gs: GameState, placeName: string, day: number): HistoricalEvent | null {
  const evs = (gs.history?.events ?? []).filter((e) => e.placeName === placeName);
  if (!evs.length) return null;
  return evs[((day % evs.length) + evs.length) % evs.length];
}

/** Reading a figure's own lines: dialogue drawn from their actual career. */
export function figureLines(gs: GameState, figureId: string): string[] {
  const fig = figureOf(gs, figureId);
  if (!fig) return [];
  const lines: string[] = [];
  if (fig.status === "living") lines.push(fig.bio);
  else if (fig.status === "retired") lines.push(`${fig.bio} The circuit moves on; the name stays in the book.`);
  switch (fig.profession) {
    case "champion":
      lines.push(fig.status === "living" ? "You'll want a settled team before you step where I step. The sand gives no discounts." : "These days I watch the brackets more than I fill them. The young fight prettier; we fought meaner.");
      break;
    case "explorer":
      lines.push("Half of exploring is turning back at the right rock. The other half is being wrong about which rock.");
      break;
    case "scholar":
      lines.push("Bloodlines remember what tamers forget. Bring me a beast with questions in it and I'll show you.");
      break;
    case "official":
      lines.push("Charters are dull until you need one. Then they are the only interesting thing in the world.");
      break;
  }
  if (fig.rivals.length) {
    const rival = figureOf(gs, fig.rivals[0]);
    if (rival) lines.push(`Ask me about ${rival.name} some other day. Some other year.`);
  }
  return lines;
}

/** Debug helper: bounded state size (mapcheck). */
export function historyStateSize(gs: GameState): number {
  const h = gs.history;
  return h ? h.figures.length + h.events.length + h.lore.length + Object.keys(h.cultures).length + Object.keys(h.found).length : 0;
}
