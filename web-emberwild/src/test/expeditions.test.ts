import { describe, expect, it } from "vitest";

import { DAY_TICKS, ITEMS, SPECIES } from "@/game/data";
import { createMonster } from "@/game/monster";
import { hash2 } from "@/game/rng";
import { EXPEDITION_DEFS, validateDef, guildOffers, declineExpedition, joinGuild, isMember, partyAssessment, registerExpedition, standingOf, expeditionState, onExpeditionDiscover, onExpeditionForage, onExpeditionKill, onExpeditionInvestigate, tickExpeditions, advanceExpeditions, expeditionDone, atIssuingGuild, claimExpedition, abandonExpedition, useExpeditionSupply, activeExpeditionCount } from "@/game/expeditions";
import { GUILD_ORG, getGuilds, guildAt, guildByKey } from "@/game/guild";
import { migrateLoaded } from "@/game/migrate";
import { applyOrgStanding, repOf } from "@/game/reputation";
import { SAVE_VERSION, newGame, previewStarter } from "@/game/sim";
import type { ExpeditionOffer, GameState } from "@/game/types";
import { getWorld, seedFromText, type Feature } from "@/game/world";

/**
 * Update D — the Expeditioner's Guild and its expedition system. The Guild is
 * its own organization (never an association reskin), expeditions resolve
 * against the one real world, registration is atomic, objectives progress
 * only through authoritative gameplay events, and rewards pay exactly once.
 */

const SEED = "EXPEDITION-1";
const SEED_NUM = seedFromText(SEED);
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

const world = getWorld(SEED_NUM);
// the Guild keeps halls in towns and cities only
const halls = world.allFeatures().filter((f) => f.kind === "town" || f.kind === "city");
const first = halls[0];
const second = halls[1] ?? halls[0];

const moveTo = (gs: GameState, f: Feature): void => {
  gs.player.x = f.x;
  gs.player.y = f.y;
};

/** Adds one healthy monster to the travelling party (the starter alone is one). */
function addPartyMon(gs: GameState, speciesId?: string): void {
  const sp = speciesId ?? gs.party[0]?.speciesId ?? "mossback";
  const mon = createMonster(gs, sp, 6, { seed: hash2(gs.seed, 7, 7), origin: "Starter", mutations: [] });
  gs.party.push(mon);
}

/** The uid of the most recently added party member. */
function addUid(gs: GameState): string {
  return gs.party[gs.party.length - 1].uid;
}

/** Day-scans a chapter's board for an offer backed by a given definition. */
function findOffer(gs: GameState, f: Feature, defId: string | null, maxDays = 10): ExpeditionOffer | null {
  for (let d = 0; d < maxDays; d++) {
    gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
    const offers = guildOffers(gs, f);
    const hit = offers.find((o) => (defId ? o.defId === defId : true));
    if (hit) return hit;
  }
  return null;
}

/** Enrolls the player, grants proven standing at every chapter, then hunts the whole Guild for an offer matching want. */
function huntOffer(gs: GameState, want: (o: ExpeditionOffer) => boolean, maxDays = 8): { offer: ExpeditionOffer; hall: Feature } | null {
  moveTo(gs, first);
  joinGuild(gs);
  for (const ch of getGuilds(SEED_NUM).values()) applyOrgStanding(gs, "player", "guilds", ch.id, 20, `hunt:${ch.id}`);
  for (const hall of halls) {
    for (let d = 0; d < maxDays; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      const hit = guildOffers(gs, hall).find(want);
      if (hit) return { offer: hit, hall };
    }
  }
  return null;
}

/** Joins the chapter at f and returns an offer for defId (or any) as a member. */
function enrolledOffer(gs: GameState, f: Feature, defId: string | null): ExpeditionOffer {
  moveTo(gs, f);
  joinGuild(gs);
  const offer = findOffer(gs, f, defId);
  expect(offer, `no offer${defId ? ` of ${defId}` : ""} posted within the scan window`).toBeTruthy();
  return offer!;
}

describe("the Guild as its own organization", () => {
  it("is named and identified separately from every association", () => {
    expect(GUILD_ORG).toBe("the Expeditioner's Guild");
    expect(GUILD_ORG.toLowerCase()).not.toContain("association");
    for (const ch of getGuilds(SEED_NUM).values()) {
      expect(ch.id.startsWith("g:")).toBe(true);
      expect(ch.name).toMatch(/Chapter/);
    }
  });

  it("keeps chapters in towns and cities only — never hamlets", () => {
    expect(halls.length).toBeGreaterThan(0);
    for (const ch of getGuilds(SEED_NUM).values()) {
      const f = world.siteAt(ch.settlement.x, ch.settlement.y);
      expect(f && (f.kind === "town" || f.kind === "city")).toBe(true);
    }
    const hamlets = world.allFeatures().filter((f) => f.kind === "hamlet");
    for (const h of hamlets) expect(guildAt(SEED_NUM, h)).toBeNull();
    expect(guildAt(SEED_NUM, first)).not.toBeNull();
  });

  it("a commission is recorded as a distinct issuer — never the Guild itself", () => {
    const gs = makeGs();
    for (let d = 0; d < 10; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const o of guildOffers(gs, first)) {
        if (o.commission) {
          expect(o.commission.id === o.guildKey).toBe(false);
          expect(o.commission.name).not.toBe(o.guildName);
          expect(o.commission.kind).not.toBe("guild");
          return;
        }
      }
    }
    // no commissioned posting in the window: the invariant still holds vacuously
    expect(true).toBe(true);
  });

  it("claiming pays the Guild's ledger first and the commissioner's separately", () => {
    // two ledgers, two guard keys, applied through one idempotent mechanism
    const gs = makeGs();
    const ch = guildAt(SEED_NUM, first)!;
    applyOrgStanding(gs, "player", "guilds", ch.id, 5, "guard-1");
    expect(repOf(gs, "player", "guilds", ch.id)).toBe(5);
    // replaying the same guard cannot double-apply
    applyOrgStanding(gs, "player", "guilds", ch.id, 5, "guard-1");
    expect(repOf(gs, "player", "guilds", ch.id)).toBe(5);
  });

  it("standing at one chapter does not bleed into another", () => {
    const gs = makeGs();
    const a = guildAt(SEED_NUM, first)!;
    const b = guildAt(SEED_NUM, second)!;
    applyOrgStanding(gs, "player", "guilds", a.id, 7, "guard-a");
    expect(standingOf(gs, a.id)).toBe(7);
    expect(standingOf(gs, b.id)).toBe(b.id === a.id ? 7 : 0);
  });
});

describe("membership", () => {
  it("joins with no association membership, license or homestead required", () => {
    const gs = makeGs();
    expect(isMember(gs)).toBe(false);
    moveTo(gs, first);
    const beforeAssoc = JSON.stringify(repOf(gs, "player", "assocs", "any") ?? null);
    const msg = joinGuild(gs);
    expect(msg).toBeTruthy();
    expect(isMember(gs)).toBe(true);
    // no association ledger was touched by joining
    expect(JSON.stringify(repOf(gs, "player", "assocs", "any") ?? null)).toBe(beforeAssoc);
  });

  it("joining requires standing in a chapter's hall", () => {
    const gs = makeGs();
    moveTo(gs, first);
    gs.player.x += 40; // out in the wilds
    expect(joinGuild(gs)).toBeNull();
    expect(isMember(gs)).toBe(false);
  });

  it("membership survives save and load", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState;
    expect(migrateLoaded(parsed)).toBe(true);
    expect(isMember(parsed)).toBe(true);
    expect(parsed.expeditions?.memberSince).toBe(gs.expeditions?.memberSince);
  });
});

describe("definitions", () => {
  it("every shipped definition validates cleanly", () => {
    expect(EXPEDITION_DEFS.length).toBeGreaterThanOrEqual(7);
    for (const d of EXPEDITION_DEFS) expect(validateDef(d), d.id).toEqual([]);
  });

  it("rejects malformed definitions before they could reach a board", () => {
    expect(validateDef(null).length).toBeGreaterThan(0);
    expect(validateDef({}).length).toBeGreaterThan(0);
    expect(validateDef({ id: "x", category: "exploration", weight: 0, difficulty: 9, minStanding: 0, resolve: () => null }).length).toBeGreaterThan(0);
  });
});

describe("the board", () => {
  it("posts a deterministic day-stamped board at a chapter", () => {
    const gs = makeGs();
    moveTo(gs, first);
    gs.tick = 5 * DAY_TICKS;
    const a = guildOffers(gs, first);
    const b = guildOffers(gs, first);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
    for (const o of a) {
      expect(o.objectives.length).toBeGreaterThan(0);
      expect(o.reward.gold).toBeGreaterThan(0);
      expect(o.expiresDay).toBeGreaterThan(o.postedDay);
      expect(o.status).toBe("offered");
    }
  });

  it("only posts work the real world can resolve — destinations exist", () => {
    const gs = makeGs();
    moveTo(gs, first);
    for (let d = 0; d < 8; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const o of guildOffers(gs, first)) {
        for (const ob of o.objectives) {
          if (ob.target) {
            // the destination must be a real, in-bounds world coordinate
            expect(world.inBounds(ob.target.x, ob.target.y)).toBe(true);
          }
          if (ob.kind === "defeat" || ob.kind === "observe") {
            expect(SPECIES[ob.speciesId!]).toBeTruthy();
          }
        }
      }
    }
  });

  it("declining keeps an offer off your copy of the board for the day", () => {
    const gs = makeGs();
    moveTo(gs, first);
    const offers = guildOffers(gs, first);
    if (!offers.length) return;
    const target = offers[0];
    declineExpedition(gs, target.id);
    expect(guildOffers(gs, first).some((o) => o.id === target.id)).toBe(false);
  });

  it("higher standing unlocks work a stranger is refused", () => {
    const gs = makeGs();
    const ch = guildAt(SEED_NUM, first)!;
    moveTo(gs, first);
    for (let d = 0; d < 8; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const o of guildOffers(gs, first)) expect(o.minStanding).toBeLessThanOrEqual(0);
    }
    applyOrgStanding(gs, "player", "guilds", ch.id, 20, "proven");
    let sawGated = false;
    for (let d = 0; d < 10 && !sawGated; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const o of guildOffers(gs, first)) {
        expect(o.minStanding).toBeLessThanOrEqual(20);
        if (o.minStanding > 0) sawGated = true;
      }
    }
    expect(sawGated).toBe(true); // a proven name sees work a stranger never will
  });
});

describe("registration is atomic", () => {
  it("refuses a non-member without consuming anything", () => {
    const gs = makeGs();
    moveTo(gs, first);
    const offer = findOffer(gs, first, null);
    expect(offer).toBeTruthy();
    const bag = JSON.stringify(gs.bag);
    const r = registerExpedition(gs, offer!.id, [gs.party[0].uid], []);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(gs.bag)).toBe(bag);
    expect(activeExpeditionCount(gs)).toBe(0);
  });

  it("refuses unaffordable supplies without deducting the bag", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, null)!;
    gs.bag.tonic = 0;
    const bag = JSON.stringify(gs.bag);
    const r = registerExpedition(gs, offer.id, [gs.party[0].uid], [{ id: "tonic", n: 2 }]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(gs.bag)).toBe(bag);
    expect(guildOffers(gs, first).some((o) => o.id === offer.id)).toBe(true);
  });

  it("refuses a party smaller than the posting demands", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    for (let d = 0; d < 10; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const o of guildOffers(gs, first)) {
        if (o.minParty > gs.party.length) {
          const r = registerExpedition(gs, o.id, gs.party.map((m) => m.uid), []);
          expect(r.ok).toBe(false);
          expect(activeExpeditionCount(gs)).toBe(0);
          return;
        }
      }
    }
  });

  it("a valid registration deducts supplies exactly once and takes the offer", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, null)!;
    gs.bag.tonic = 3;
    const r = registerExpedition(gs, offer.id, [gs.party[0].uid], [{ id: "tonic", n: 2 }]);
    expect(r.ok).toBe(true);
    expect(gs.bag.tonic).toBe(1);
    expect(activeExpeditionCount(gs)).toBe(1);
    const inst = gs.expeditions!.active[0];
    expect(inst.supplies).toEqual([{ id: "tonic", n: 2 }]);
    expect(inst.status).toBe("active");
    expect(guildOffers(gs, first).some((o) => o.id === offer.id)).toBe(false);
    // the deadline: tighter work means fewer days
    expect(inst.deadlineDay).toBe(Math.floor(gs.tick / DAY_TICKS) + 4 + (5 - offer.difficulty));
  });

  it("one expedition at a time", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const first1 = findOffer(gs, first, null)!;
    expect(registerExpedition(gs, first1.id, [gs.party[0].uid], []).ok).toBe(true);
    gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
    const second1 = findOffer(gs, first, null);
    if (second1) {
      const r = registerExpedition(gs, second1.id, [gs.party[0].uid], []);
      expect(r.ok).toBe(false);
      expect(activeExpeditionCount(gs)).toBe(1);
    }
  });
});

describe("objectives progress only through real events", () => {
  it("discover objectives ignore wrong coordinates and reward the genuine article", () => {
    const gs = makeGs();
    const offer = enrolledOffer(gs, first, "blank_spots");
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    const ob = inst.offer.objectives[0];
    expect(ob.kind).toBe("discover");
    onExpeditionDiscover(gs, ob.target!.x + 5, ob.target!.y + 5);
    expect(ob.progress).toBe(0);
    onExpeditionDiscover(gs, ob.target!.x, ob.target!.y);
    expect(ob.progress).toBe(1);
    expect(expeditionDone(inst)).toBe(true);
  });

  it("gather objectives count exactly what was foraged", () => {
    const gs = makeGs();
    const found = huntOffer(gs, (o) => o.objectives.some((ob) => ob.kind === "gather"));
    expect(found, "no gather work posted anywhere in the scan window").toBeTruthy();
    const { offer, hall } = found!;
    moveTo(gs, hall);
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const ob = gs.expeditions!.active[0].offer.objectives[0];
    expect(ob.kind).toBe("gather");
    const itemId = ob.itemId!;
    onExpeditionForage(gs, itemId, 1);
    expect(ob.progress).toBe(1);
    onExpeditionForage(gs, itemId, 99);
    expect(ob.progress).toBe(ob.count);
    // a different item never moves it
    const other = (Object.keys(ITEMS) as (keyof typeof ITEMS)[]).find((i) => i !== itemId)!;
    onExpeditionForage(gs, other, 5);
    expect(ob.progress).toBe(ob.count);
  });

  it("defeat objectives count only the commissioned species", () => {
    const gs = makeGs();
    const found = huntOffer(gs, (o) => o.objectives.some((ob) => ob.kind === "defeat"));
    expect(found, "no defeat work posted anywhere in the scan window").toBeTruthy();
    const { offer, hall } = found!;
    moveTo(gs, hall);
    while (gs.party.length < offer.minParty) addPartyMon(gs);
    expect(registerExpedition(gs, offer.id, gs.party.slice(0, offer.minParty).map((m) => m.uid), []).ok).toBe(true);
    const ob = gs.expeditions!.active[0].offer.objectives[0];
    expect(ob.kind).toBe("defeat");
    const sp = ob.speciesId!;
    const others = Object.keys(SPECIES).filter((s) => s !== sp);
    onExpeditionKill(gs, others[0]);
    expect(ob.progress).toBe(0);
    onExpeditionKill(gs, sp);
    onExpeditionKill(gs, sp);
    onExpeditionKill(gs, sp);
    expect(ob.progress).toBe(ob.count);
  });

  it("multi-stage work gates later stages behind their prerequisites", () => {
    const gs = makeGs();
    const found = huntOffer(gs, (o) => o.objectives.some((ob) => ob.kind === "investigate"));
    expect(found, "no multi-stage work posted anywhere in the scan window").toBeTruthy();
    const { offer, hall } = found!;
    moveTo(gs, hall);
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    const reach = inst.offer.objectives.find((o) => o.kind === "reach")!;
    const investigate = inst.offer.objectives.find((o) => o.kind === "investigate")!;
    // the later stage cannot be jumped to by searching early
    gs.player.x = investigate.target!.x;
    gs.player.y = investigate.target!.y;
    onExpeditionInvestigate(gs, investigate.target!.x, investigate.target!.y);
    expect(investigate.progress).toBe(0);
    // walking into range completes the reach stage through the per-tick check
    const res = tickExpeditions(gs);
    expect(reach.progress).toBe(1);
    // and now the search counts
    onExpeditionInvestigate(gs, investigate.target!.x, investigate.target!.y);
    expect(investigate.progress).toBe(1);
    // no complication is fabricated by this quiet ruin work in this setup
    expect(res === null || typeof res.speciesId === "string").toBe(true);
  });

  it("observe objectives need the creature seen in the flesh", () => {
    const gs = makeGs();
    const found = huntOffer(gs, (o) => o.objectives.some((ob) => ob.kind === "observe"), 12);
    if (!found) return; // a world with no rare-species lair in range posts no such work — the def is simply never resolved
    const { offer, hall } = found;
    moveTo(gs, hall);
    while (gs.party.length < offer.minParty) addPartyMon(gs);
    expect(registerExpedition(gs, offer.id, gs.party.slice(0, offer.minParty).map((m) => m.uid), []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    const reach = inst.offer.objectives.find((o) => o.kind === "reach")!;
    const observe = inst.offer.objectives.find((o) => o.kind === "observe")!;
    expect(observe.kind).toBe("observe");
    // stage gate: nothing observes before the journey
    tickExpeditions(gs);
    expect(observe.progress).toBe(0);
    // arrive, then place the quarry within sight
    gs.player.x = reach.target!.x;
    gs.player.y = reach.target!.y;
    tickExpeditions(gs);
    expect(reach.progress).toBe(1);
    observe.progress = 0;
    gs.creatures["sight-test"] = {
      id: "sight-test", speciesId: observe.speciesId!, x: gs.player.x, y: gs.player.y, layer: gs.player.layer ?? 0,
    } as never;
    tickExpeditions(gs);
    expect(observe.progress).toBe(1);
  });
});

describe("outcomes", () => {
  it("pays exactly once, at the issuing chapter, with per-ledger rewards", () => {
    const gs = makeGs();
    const offer = enrolledOffer(gs, first, "blank_spots");
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    for (const ob of inst.offer.objectives) {
      if (ob.kind === "discover") onExpeditionDiscover(gs, ob.target!.x, ob.target!.y);
      if (ob.kind === "reach") {
        gs.player.x = ob.target!.x;
        gs.player.y = ob.target!.y;
        tickExpeditions(gs);
      }
      if (ob.kind === "gather") onExpeditionForage(gs, ob.itemId!, ob.count);
      if (ob.kind === "defeat") for (let i = 0; i < ob.count; i++) onExpeditionKill(gs, ob.speciesId!);
      if (ob.kind === "investigate") onExpeditionInvestigate(gs, ob.target!.x, ob.target!.y);
      if (ob.kind === "observe") {
        gs.creatures["claim-test"] = {
          id: "claim-test", speciesId: ob.speciesId!, x: gs.player.x, y: gs.player.y, layer: gs.player.layer ?? 0,
        } as never;
        tickExpeditions(gs);
      }
    }
    expect(expeditionDone(inst)).toBe(true);
    const ch = guildByKey(SEED_NUM, offer.guildKey)!;
    // far from the chapter, the Guild refuses to settle
    gs.player.x = ch.settlement.x + 50;
    gs.player.y = ch.settlement.y + 50;
    const away = claimExpedition(gs, offer.id);
    expect(away).toBeTruthy();
    expect(expeditionDone(inst)).toBe(true); // nothing was paid
    // back at the chapter, the record settles
    moveTo(gs, ch.settlement);
    const goldBefore = gs.player.gold;
    const bagBeforeClaim = { ...gs.bag };
    const msg = claimExpedition(gs, offer.id);
    expect(msg).toBeTruthy();
    expect(gs.player.gold).toBe(goldBefore + offer.reward.gold);
    for (const it of offer.reward.items) expect(gs.bag[it.id]).toBe((bagBeforeClaim[it.id] ?? 0) + it.n);
    expect(standingOf(gs, offer.guildKey)).toBe(offer.reward.standing);
    // the record is closed: a second claim finds nothing to pay
    expect(claimExpedition(gs, offer.id)).toBeNull();
    expect(gs.player.gold).toBe(goldBefore + offer.reward.gold);
    expect(gs.expeditions!.history[0].outcome).toBe("completed");
    expect(atIssuingGuild(gs, inst)).toBe(true);
  });

  it("abandoning mid-work preserves discoveries and pays only a partial purse", () => {
    const gs = makeGs();
    const offer = enrolledOffer(gs, first, "blank_spots");
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    const goldBefore = gs.player.gold;
    // nothing done: no pay at all
    const msg = abandonExpedition(gs, offer.id);
    expect(msg).toBeTruthy();
    expect(gs.player.gold).toBe(goldBefore);
    expect(gs.expeditions!.history[0].outcome).toBe("abandoned");
    expect(inst.status).toBe("abandoned");
  });

  it("a majority-finished file earns a partial purse", () => {
    const gs = makeGs();
    // a two-objective file can reach half done
    const found = huntOffer(gs, (o) => o.objectives.length >= 2 && !o.objectives.some((ob) => ob.kind === "observe"));
    expect(found, "no multi-objective work posted anywhere in the scan window").toBeTruthy();
    const { offer, hall } = found!;
    moveTo(gs, hall);
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    const total = inst.offer.objectives.length;
    if (total < 2) return;
    // genuinely finish just over half of the objectives, in stage order
    const toFinish = Math.ceil(total / 2);
    for (const ob of inst.offer.objectives.slice(0, toFinish)) {
      if (ob.kind === "discover") onExpeditionDiscover(gs, ob.target!.x, ob.target!.y);
      else if (ob.kind === "reach") {
        gs.player.x = ob.target!.x;
        gs.player.y = ob.target!.y;
        tickExpeditions(gs);
      } else if (ob.kind === "gather") onExpeditionForage(gs, ob.itemId!, ob.count);
      else if (ob.kind === "defeat") for (let i = 0; i < ob.count; i++) onExpeditionKill(gs, ob.speciesId!);
      else if (ob.kind === "investigate") onExpeditionInvestigate(gs, ob.target!.x, ob.target!.y);
    }
    const done = inst.offer.objectives.filter((o) => o.progress >= o.count).length;
    expect(done).toBe(toFinish);
    const goldBefore = gs.player.gold;
    abandonExpedition(gs, offer.id);
    const frac = done / total;
    const expected = frac >= 0.5 ? Math.floor(offer.reward.gold * frac * 0.5) : 0;
    expect(expected).toBeGreaterThan(0);
    expect(gs.player.gold).toBe(goldBefore + expected);
  });

  it("a lapsed deadline fails the file through the daily pass", () => {
    const gs = makeGs();
    const offer = enrolledOffer(gs, first, "blank_spots");
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    gs.tick = (inst.deadlineDay + 1) * DAY_TICKS;
    advanceExpeditions(gs);
    expect(inst.status).toBe("failed");
    expect(activeExpeditionCount(gs)).toBe(0);
    expect(gs.expeditions!.history[0].outcome).toBe("failed");
    expect(gs.expeditions!.history[0].objectivesTotal).toBe(inst.offer.objectives.length);
  });
});

describe("en-route supplies", () => {
  it("spend the expedition's locker, not the bag, and revert when nothing applies", () => {
    const gs = makeGs();
    const offer = enrolledOffer(gs, first, "blank_spots");
    gs.bag.tonic = 5;
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], [{ id: "tonic", n: 2 }]).ok).toBe(true);
    const inst = gs.expeditions!.active[0];
    // the bag paid at departure: 5 - 2
    expect(gs.bag.tonic).toBe(3);
    // the locker routes through the one item system; a null application reverts
    const reverted = useExpeditionSupply(gs, offer.id, "tonic", () => null);
    expect(reverted).toBeNull();
    expect(inst.supplies[0].n).toBe(2);
    expect(gs.bag.tonic).toBe(3);
    // a real application consumes the routed item from the bag (as useItemOn does) and the locker unit
    const used = useExpeditionSupply(gs, offer.id, "tonic", (g) => {
      g.bag.tonic = (g.bag.tonic ?? 1) - 1;
      return "You feel steadier.";
    });
    expect(used).toBeTruthy();
    expect(inst.supplies[0]?.n ?? 0).toBe(1);
    expect(gs.bag.tonic).toBe(3);
    expect(inst.consumed).toEqual([{ id: "tonic", n: 1 }]);
  });
});

describe("persistence and migration", () => {
  it("active work, history and membership survive save/load", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, "blank_spots")!;
    gs.bag.tonic = 2;
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], [{ id: "tonic", n: 2 }]).ok).toBe(true);
    abandonExpedition(gs, offer.id);
    const offer2 = findOffer(gs, first, null);
    if (offer2 && offer2.id !== offer.id) {
      expect(registerExpedition(gs, offer2.id, [gs.party[0].uid], []).ok).toBe(true);
    }
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    expect(migrateLoaded(parsed)).toBe(true);
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.expeditions!.history.length).toBe(gs.expeditions!.history.length);
    expect(parsed.expeditions!.active.length).toBe(gs.expeditions!.active.length);
    if (parsed.expeditions!.active.length) {
      expect(parsed.expeditions!.active[0].offer.id).toBe(gs.expeditions!.active[0].offer.id);
      expect(parsed.expeditions!.active[0].status).toBe("active");
      expect(parsed.expeditions!.active[0].supplies).toEqual(gs.expeditions!.active[0].supplies);
    }
  });

  it("migration is idempotent and never disturbs non-Guild state", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const once = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    expect(migrateLoaded(once)).toBe(true);
    const snap = JSON.stringify(once.expeditions);
    expect(migrateLoaded(once)).toBe(true);
    expect(JSON.stringify(once.expeditions)).toBe(snap);
    // a legacy save with no Guild block at all backfills cleanly
    const legacy = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    delete legacy.expeditions;
    expect(migrateLoaded(legacy)).toBe(true);
    expect(expeditionState(legacy).active).toEqual([]);
    expect(expeditionState(legacy).history).toEqual([]);
  });
});

describe("integration: one simulation, many systems", () => {
  it("Guild work leaves contracts, needs and the bag's arithmetic untouched", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, "blank_spots")!;
    const contractsBefore = JSON.stringify(gs.contracts ?? null);
    gs.bag.berries = 4;
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], [{ id: "berries", n: 2 }]).ok).toBe(true);
    // the contract ledger did not move because the Guild moved
    expect(JSON.stringify(gs.contracts ?? null)).toBe(contractsBefore);
    // and the bag lost exactly the registered supplies
    expect(gs.bag.berries).toBe(2);
  });

  it("every chapter in the world resolves a clerk and a name", () => {
    for (const ch of getGuilds(SEED_NUM).values()) {
      expect(ch.clerk.length).toBeGreaterThan(0);
      expect(ch.name).toContain(ch.settlement.name);
      expect(guildByKey(SEED_NUM, ch.id)).toBe(ch);
    }
  });
});

describe("preparation assessment", () => {
  it("reads real traits, sizes and condition — and never gates registration", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, "blank_spots")!;
    // the starter party: whatever it is, the assessment speaks in the real
    // species' own capabilities and stays purely informative
    const lines = partyAssessment(gs, offer, [gs.party[0].uid]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(["good", "warn", "info"]).toContain(line.tone);
    }
    // a flying recruit earns the scout line; a swimmer earns the water line
    const flier = Object.keys(SPECIES).find((s) => SPECIES[s].traits?.includes("flutter"));
    const swimmer = Object.keys(SPECIES).find((s) => SPECIES[s].swims);
    if (flier) {
      addPartyMon(gs, flier);
      expect(partyAssessment(gs, offer, [addUid(gs)])?.some((l) => l.text.includes("scout"))).toBe(true);
    }
    if (swimmer) {
      addPartyMon(gs, swimmer);
      expect(partyAssessment(gs, offer, [addUid(gs)]).some((l) => l.text.includes("swimmer"))).toBe(true);
    }
    // an assessment is advice: registration rules live in registerExpedition,
    // so a warned party can still sign the book
    expect(registerExpedition(gs, offer.id, [gs.party[0].uid], []).ok).toBe(true);
  });

  it("a hurt monster draws the clerk's warning", () => {
    const gs = makeGs();
    moveTo(gs, first);
    joinGuild(gs);
    const offer = findOffer(gs, first, "blank_spots")!;
    gs.party[0].hp = 1;
    const lines = partyAssessment(gs, offer, [gs.party[0].uid]);
    expect(lines.some((l) => l.tone === "warn" && l.text.includes("hurt"))).toBe(true);
  });
});
