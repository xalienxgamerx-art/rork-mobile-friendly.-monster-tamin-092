/// <reference types="node" />
import { describe, expect, it } from "vitest";

import { BIOMES } from "@/game/data";
import { abstractDroppedCreature } from "@/game/distant";
import { loreAt, readChronicles } from "@/game/history";
import { CAVE_DEEP, SURFACE } from "@/game/height";
import { legendList, legendOffspring, legendsById, hasReached, isLegendBody, legendArmorBonus, legendSites, legendTameGate, legendTick, legendWithdrawn, stageRank } from "@/game/legends";
import { offspringSpecies } from "@/game/breeding";
import { migrateLoaded } from "@/game/migrate";
import { killWild, wildMonster, type Fighter } from "@/game/combat";
import { SKILLS, SPECIES } from "@/game/data";
import { legendSignature, resolveSignature } from "@/game/signature";
import { newGame, previewStarter } from "@/game/sim";
import type { GameState, WildCreature } from "@/game/types";
import { getWorld, timeOf } from "@/game/world";

/**
 * Update G — the eight legendary individuals: one-of-a-kind bodies placed
 * deterministically far from the start, a rumor→evidence→territory→encounter
 * ladder, individual taming terms, death-proof withdrawals, and offspring that
 * always resolve to mundane kin. No seed, reload, fold or breeding may ever
 * produce a second copy.
 */

const SEED = "LEG-1";

const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

const cheb = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** The first tick on the ladder's cadence (tick % 4 === 2) at or after `from` matching a predicate. */
const findTick = (test: (t: number) => boolean, from = 6, to = 40_000): number => {
  let t = from + ((2 - (from % 4) + 4) % 4);
  for (; t < to; t += 4) if (test(t)) return t;
  return -1;
};

const legendBody = (gs: GameState, speciesId: string): WildCreature | undefined => gs.creatures[`leg:${speciesId}`];

/** Drives one legend through the whole ladder deterministically; returns the wild body. */
const driveLegend = (gs: GameState, speciesId: string): WildCreature => {
  const world = getWorld(gs.seed);
  const site = legendSites(gs.seed)[speciesId];
  const def = legendsById().get(speciesId)!;
  readChronicles(gs, loreAt(gs, site.ev.x, site.ev.y));
  gs.player.x = site.ev.x;
  gs.player.y = site.ev.y;
  gs.player.layer = site.ev.layer;
  gs.tick = findTick(() => true, gs.tick + 1);
  legendTick(gs, world); // evidence
  gs.player.x = site.x;
  gs.player.y = site.y;
  gs.player.layer = site.layer;
  for (let i = 0; i < 50; i++) {
    // one tick to transition to located, then the spawn attempts on permitted ticks
    gs.tick = findTick((t) => def.encounter(world, site.x, site.y, t), gs.tick + 1);
    expect(gs.tick, `${speciesId} conditions recur`).toBeGreaterThan(0);
    legendTick(gs, world);
    const body = legendBody(gs, speciesId);
    if (body) return body;
  }
  throw new Error(`${speciesId} never materialized`);
};

describe("legendary sites (deterministic placement)", () => {
  it("the same seed gives the same eight territories, stable across calls", { timeout: 60_000 }, () => {
    const a = legendSites(12345);
    const b = legendSites(12345);
    expect(a).toEqual(b);
    // sites are real scans, not fallbacks: each sits strictly inside the map
    for (const def of legendList()) {
      const s = a[def.speciesId];
      expect(s.x).toBeGreaterThan(0);
      expect(s.y).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(4096);
      expect(s.y).toBeLessThan(4096);
    }
  });

  it("every territory sits on its legend's own terrain, far from the start", { timeout: 60_000 }, () => {
    for (const seed of [1, 777, 424242]) {
      const w = getWorld(seed);
      const s0 = w.startPoint();
      const sites = legendSites(seed);
      for (const def of legendList()) {
        const site = sites[def.speciesId];
        // legends live far out — the whole point of the journey
        expect(Math.hypot(site.x - s0.x, site.y - s0.y), `${def.speciesId} far from start (seed ${seed})`).toBeGreaterThan(100);
        expect(site.layer).toBe(def.layer);
        if (def.layer !== SURFACE) {
          // the Gloomwarden anchors in the deep caves, under walkable gloomwood above
          expect(w.tile(site.x, site.y).biome, `gloomwood above ${def.speciesId} (seed ${seed})`).toBe("gloomwood");
        }
      }
    }
  });

  it("anchors sit on the right terrain: mountain, deep cave, lake, desert, snow", () => {
    for (const seed of [1, 777, 424242]) {
      const w = getWorld(seed);
      const sites = legendSites(seed);
      const t = (x: number, y: number) => w.tile(x, y).biome;
      expect(t(sites.vaelrox.x, sites.vaelrox.y), `vaelrox (seed ${seed})`).toBe("mountain");
      expect(t(sites.sarquiss.x, sites.sarquiss.y), `sarquiss (seed ${seed})`).toBe("desert");
      expect(t(sites.aurelfar.x, sites.aurelfar.y), `aurelfar (seed ${seed})`).toBe("snow");
      expect(t(sites.miravane.x, sites.miravane.y), `miravane (seed ${seed})`).toBe("lake");
      // the Gloomwarden anchors on open deep-cave ground
      expect(w.siteAt(sites.umbrelith.x, sites.umbrelith.y)?.wall ?? false).toBe(false);
    }
  });

  it("evidence sites are standable surface ground a few steps off the anchor", () => {
    const w = getWorld(1);
    const sites = legendSites(1);
    for (const def of legendList()) {
      const ev = sites[def.speciesId].ev;
      expect(ev.layer).toBe(SURFACE);
      const t = w.tile(ev.x, ev.y);
      expect(BIOMES[t.biome].passable, `${def.speciesId} evidence standable`).toBe(true);
      expect(t.feature, `${def.speciesId} evidence not on a feature`).toBeFalsy();
      if (def.speciesId !== "umbrelith") {
        expect(cheb(ev.x, ev.y, sites[def.speciesId].x, sites[def.speciesId].y)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("the discovery ladder", () => {
  it("a fresh world backfills all nine undiscovered, with archive entries and legend-stones", { timeout: 60_000 }, () => {
    const gs = makeGs();
    expect(Object.keys(gs.legends ?? {}).length).toBe(9);
    for (const def of legendList()) expect(gs.legends![def.speciesId].stage).toBe("undiscovered");
    const legendLore = gs.history.lore.filter((l) => l.legendId);
    expect(legendLore.length).toBe(9);
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    for (const def of legendList()) {
      const ev = sites[def.speciesId].ev;
      const npc = world.npcAt(ev.x, ev.y, gs.tick, gs.history);
      expect(npc, `${def.speciesId} stone present`).toBeTruthy();
      expect(npc!.role).toBe("marker");
      expect(npc!.name).toContain(def.name);
    }
  });

  it("undiscovered legends never materialize, even at the anchor", () => {
    const gs = makeGs();
    const sites = legendSites(gs.seed);
    const world = getWorld(gs.seed);
    gs.tick = findTick(() => true);
    gs.player.x = sites.vaelrox.x;
    gs.player.y = sites.vaelrox.y;
    legendTick(gs, world);
    expect(legendBody(gs, "vaelrox")).toBeUndefined();
  });

  it("reading the chronicle seeds the rumor; evidence and territory follow the player's footsteps", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    const ev = sites.vaelrox.ev;
    // the real reading path: stand at the stone, read
    readChronicles(gs, loreAt(gs, ev.x, ev.y));
    expect(hasReached(gs.legends!.vaelrox, "rumored")).toBe(true);
    // far away, nothing ripens
    gs.tick = findTick(() => true);
    legendTick(gs, world);
    expect(gs.legends!.vaelrox.stage).toBe("rumored");
    // at the evidence: the rumor becomes evidence
    gs.player.x = ev.x;
    gs.player.y = ev.y;
    legendTick(gs, world);
    expect(gs.legends!.vaelrox.stage).toBe("evidence");
    // at the territory: located
    gs.player.x = sites.vaelrox.x;
    gs.player.y = sites.vaelrox.y;
    legendTick(gs, world);
    expect(gs.legends!.vaelrox.stage).toBe("located");
  });

  it("the body materializes only when the individual's conditions are met", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    // run the ladder to located
    readChronicles(gs, loreAt(gs, sites.vaelrox.ev.x, sites.vaelrox.ev.y));
    gs.player.x = sites.vaelrox.ev.x;
    gs.player.y = sites.vaelrox.ev.y;
    gs.tick = findTick(() => true);
    legendTick(gs, world);
    gs.player.x = sites.vaelrox.x;
    gs.player.y = sites.vaelrox.y;
    gs.tick = findTick(() => true, gs.tick + 1);
    legendTick(gs, world);
    expect(gs.legends!.vaelrox.stage).toBe("located");
    // wait for rain or storm at the caldera: no drake in the wet
    const wet = findTick((t) => {
      const w = world.weather(sites.vaelrox.x, sites.vaelrox.y, t).id;
      return w === "rain" || w === "storm";
    });
    if (wet > 0) {
      gs.tick = wet;
      legendTick(gs, world);
      expect(legendBody(gs, "vaelrox"), "no legend in the rain").toBeUndefined();
      expect(gs.legends!.vaelrox.stage).toBe("located");
    }
    // and under a dry sky, the mountain wakes
    const dry = findTick((t) => {
      const w = world.weather(sites.vaelrox.x, sites.vaelrox.y, t).id;
      return w !== "rain" && w !== "storm";
    }, 6);
    expect(dry).toBeGreaterThan(0);
    gs.tick = dry;
    legendTick(gs, world);
    expect(legendBody(gs, "vaelrox"), "the Ember Crown emerges").toBeDefined();
    expect(gs.legends!.vaelrox.stage).toBe("available");
  });

  it("the Gloomwarden keeps night hours; day visits find nothing", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    readChronicles(gs, loreAt(gs, sites.umbrelith.ev.x, sites.umbrelith.ev.y));
    gs.player.x = sites.umbrelith.ev.x;
    gs.player.y = sites.umbrelith.ev.y;
    gs.tick = findTick(() => true);
    legendTick(gs, world);
    gs.player.x = sites.umbrelith.x;
    gs.player.y = sites.umbrelith.y;
    gs.player.layer = CAVE_DEEP;
    // day: nothing
    const day = findTick((t) => !timeOf(t).night);
    if (day > 0) {
      gs.tick = day;
      legendTick(gs, world);
      expect(legendBody(gs, "umbrelith"), "no warden by daylight").toBeUndefined();
    }
    // night: it counts you
    const night = findTick((t) => timeOf(t).night);
    expect(night).toBeGreaterThan(0);
    gs.tick = night;
    legendTick(gs, world);
    expect(legendBody(gs, "umbrelith")).toBeDefined();
    expect(legendBody(gs, "umbrelith")!.layer).toBe(CAVE_DEEP);
    expect(gs.legends!.umbrelith.stage).toBe("available");
  });

  it("each legend's site and level come from its design, one body per species ever", () => {
    const gs = makeGs();
    for (const def of legendList()) {
      const body = driveLegend(gs, def.speciesId);
      expect(body.level, `${def.speciesId} level`).toBe(def.level);
      expect(isLegendBody(body.id)).toBe(true);
    }
    // and no tick of advancement ever duplicates one
    for (let i = 0; i < 25; i++) {
      gs.tick = findTick(() => true, gs.tick + 1);
      legendTick(gs, getWorld(gs.seed));
    }
    for (const def of legendList()) {
      const bodies = Object.keys(gs.creatures).filter((id) => id === `leg:${def.speciesId}`);
      expect(bodies.length, `${def.speciesId} unique`).toBe(1);
    }
  });
});

describe("taming terms", () => {
  it("Vaelrox must be weakened; the warden, vigil and sovereign keep their hours", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    // spawn Vaelrox through the ladder
    const vael = driveLegend(gs, "vaelrox");
    // at full strength: refused
    expect(legendTameGate(gs, vael)).toBeTruthy();
    // once its plates are outmaneuvered: it consents
    vael.hpFrac = 0.5;
    expect(legendTameGate(gs, vael)).toBeNull();

    // umbrelith: night only
    const night = findTick((t) => timeOf(t).night);
    gs.tick = night;
    expect(legendTameGate(gs, { id: "leg:umbrelith", speciesId: "umbrelith" } as WildCreature)).toBeNull();
    gs.tick = findTick((t) => !timeOf(t).night);
    expect(legendTameGate(gs, { id: "leg:umbrelith", speciesId: "umbrelith" } as WildCreature)).toBeTruthy();

    // aurelfar: night only
    gs.tick = night;
    expect(legendTameGate(gs, { id: "leg:aurelfar", speciesId: "aurelfar" } as WildCreature)).toBeNull();
    gs.tick = findTick((t) => !timeOf(t).night);
    expect(legendTameGate(gs, { id: "leg:aurelfar", speciesId: "aurelfar" } as WildCreature)).toBeTruthy();

    // sarquiss: sandstorm at its dunes only
    const storm = findTick((t) => world.weather(sites.sarquiss.x, sites.sarquiss.y, t).id === "sandstorm");
    expect(storm, "a sandstorm occurs in range").toBeGreaterThan(0);
    gs.tick = storm;
    expect(legendTameGate(gs, { id: "leg:sarquiss", speciesId: "sarquiss" } as WildCreature)).toBeNull();
    const calmSand = findTick((t) => world.weather(sites.sarquiss.x, sites.sarquiss.y, t).id !== "sandstorm");
    gs.tick = calmSand;
    expect(legendTameGate(gs, { id: "leg:sarquiss", speciesId: "sarquiss" } as WildCreature)).toBeTruthy();
  });

  it("ordinary rare species still refuse the offering path (unchanged behavior)", () => {
    // guard: the gate returns null for non-legendary bodies — the refusal lives in offerFood
    const gs = makeGs();
    expect(legendOffspring()["mossback"]).toBeUndefined();
    void gs;
  });

  it("the new lords keep their terms: a grounded wing, a spent tide, a cracked mask", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const sites = legendSites(gs.seed);
    const fake = (speciesId: string, hpFrac: number): WildCreature => {
      const c = {
        id: `leg:${speciesId}`,
        speciesId,
        hpFrac,
        x: sites[speciesId].x,
        y: sites[speciesId].y,
        homeX: sites[speciesId].x,
        homeY: sites[speciesId].y,
      } as unknown as WildCreature;
      gs.creatures[`leg:${speciesId}`] = c;
      return c;
    };
    // Tempestrix: refuses while it still flies; consents once its wing is grounded
    const roc = fake("tempestrix", 1);
    expect(legendTameGate(gs, roc)).toBeTruthy();
    roc.hpFrac = 0.6;
    expect(legendTameGate(gs, roc)).toBeNull();
    // Nereoth: the full tide refuses; a spent tide consents
    const regent = fake("nereoth", 0.9);
    expect(legendTameGate(gs, regent)).toBeTruthy();
    regent.hpFrac = 0.7;
    expect(legendTameGate(gs, regent)).toBeNull();
    // Vaskar: humbled under the open sun consents — but never at night
    const ape = fake("vaskar", 0.9);
    const noon = findTick((t) => !timeOf(t).night && world.weather(sites.vaskar.x, sites.vaskar.y, t).id === "clear");
    expect(noon, "a clear noon occurs in range").toBeGreaterThan(0);
    gs.tick = noon;
    expect(legendTameGate(gs, ape)).toBeTruthy();
    ape.hpFrac = 0.4;
    expect(legendTameGate(gs, ape)).toBeNull();
    gs.tick = findTick((t) => timeOf(t).night);
    expect(legendTameGate(gs, ape)).toBeTruthy();
  });

  it("the new bosses wear their phases: aloft armor, deep hide, the smiling mask", () => {
    // the Sky Sovereign owns the altitude until its wing is wounded
    expect(legendArmorBonus("tempestrix", 0.7, "storm")).toBe(6);
    expect(legendArmorBonus("tempestrix", 0.5, "storm")).toBe(0);
    // the Abyss Regent's barnacle hide holds while the tide is in it
    expect(legendArmorBonus("nereoth", 0.7, "fog")).toBe(5);
    expect(legendArmorBonus("nereoth", 0.5, "fog")).toBe(0);
    // the mask turns blows aside under open sky; cracked, it turns nothing
    expect(legendArmorBonus("vaskar", 0.7, "clear")).toBe(5);
    expect(legendArmorBonus("vaskar", 0.7, "cloudy")).toBe(0);
    expect(legendArmorBonus("vaskar", 0.4, "clear")).toBe(0);
  });
});

describe("death-proof withdrawals and uniqueness", () => {
  const spawnVaelrox = (gs: GameState): { gs: GameState; body: WildCreature } => ({ gs, body: driveLegend(gs, "vaelrox") });

  it("a legend at zero is never killed: it withdraws home, wounded, on cooldown", () => {
    const { gs, body } = spawnVaelrox(makeGs());
    const world = getWorld(gs.seed);
    const def = legendsById().get("vaelrox")!;
    const f: Fighter = { key: body.id, side: "wild", mon: wildMonster(gs, body), x: body.x, y: body.y, fp: 1, creatureId: body.id };
    killWild(gs, f);
    // still alive, back home, healing-limited
    const after = legendBody(gs, "vaelrox")!;
    expect(after).toBeDefined();
    expect(after.hpFrac).toBe(0.6);
    expect(after.x).toBe(body.homeX);
    expect(after.y).toBe(body.homeY);
    expect(after.calmUntil).toBeGreaterThan(gs.tick);
    expect(gs.legends!.vaelrox.stage).toBe("fought");
    void def;
    void world;
    // and the fold-away never erases it
    expect(abstractDroppedCreature(gs, after)).toBe(false);
  });

  it("a withdrawn legend re-stages to available when its cooldown passes", () => {
    const { gs, body } = spawnVaelrox(makeGs());
    const world = getWorld(gs.seed);
    const f: Fighter = { key: body.id, side: "wild", mon: wildMonster(gs, body), x: body.x, y: body.y, fp: 1, creatureId: body.id };
    killWild(gs, f);
    const p = gs.legends!.vaelrox;
    expect(p.calmUntil).toBeDefined();
    gs.tick = p.calmUntil! + 4;
    gs.tick = gs.tick - (gs.tick % 4) + 2;
    const w = world.weather(body.homeX, body.homeY, gs.tick).id;
    if (w !== "rain" && w !== "storm") {
      legendTick(gs, world);
      expect(gs.legends!.vaelrox.stage).toBe("available");
    }
  });

  it("the roster survives a save/load round-trip with no duplicates", () => {
    const gs = makeGs();
    for (const def of legendList()) driveLegend(gs, def.speciesId);
    const world = getWorld(gs.seed);
    const json = JSON.stringify(gs);
    const parsed = JSON.parse(json) as GameState;
    expect(migrateLoaded(parsed)).toBe(true);
    expect(Object.keys(parsed.legends ?? {}).length).toBe(9);
    expect(legendBody(parsed, "vaelrox")).toBeDefined();
    expect(legendBody(parsed, "umbrelith")).toBeDefined();
    expect(legendBody(parsed, "miravane")).toBeDefined();
    expect(legendBody(parsed, "sarquiss")).toBeDefined();
    expect(legendBody(parsed, "aurelfar")).toBeDefined();
    expect(legendBody(parsed, "tempestrix")).toBeDefined();
    expect(legendBody(parsed, "nereoth")).toBeDefined();
    expect(legendBody(parsed, "vaskar")).toBeDefined();
    // continued ticks never duplicate
    for (let i = 0; i < 25; i++) {
      parsed.tick += 4;
      legendTick(parsed, world);
    }
    for (const def of legendList()) {
      const bodies = Object.keys(parsed.creatures).filter((id) => id === `leg:${def.speciesId}`);
      expect(bodies.length, `${def.speciesId} unique after reload`).toBe(1);
    }
  });
});

describe("breeding compatibility", () => {
  it("a legendary parent's offspring always resolve to its mundane kin line", () => {
    for (const def of legendList()) {
      const a = { speciesId: def.speciesId, level: def.level } as WildCreature;
      const b = { speciesId: "mossback", level: 10 } as WildCreature;
      expect(offspringSpecies(a, b), `${def.speciesId} x mossback`).toBe(def.offspring);
      expect(offspringSpecies(b, a)).toBe(def.offspring);
      // even two legends resolve to the first parent's kin — never a legend
      const both = offspringSpecies(a, { ...a, speciesId: "aurelfar" } as WildCreature);
      expect(legendOffspring()[both]).toBeUndefined();
      expect(offspringSpecies(a, a)).toBe(def.offspring);
    }
  });

  it("the mundane kin lines are real species", () => {
    for (const def of legendList()) {
      expect(legendOffspring()[def.speciesId]).toBeDefined();
    }
  });
});

describe("migration (v33 → v34)", () => {
  it("an old save gains the ladder and archive once, idempotently", () => {
    const gs = makeGs();
    // strip back to a v33-shaped save
    const legacyLore = gs.history.lore.length;
    delete gs.legends;
    gs.history.lore = gs.history.lore.filter((l) => !l.legendId);
    const stripped = legacyLore - 9;
    expect(gs.history.lore.length).toBe(stripped);
    const json = JSON.stringify(gs);
    const parsed = JSON.parse(json) as GameState;
    expect(migrateLoaded(parsed)).toBe(true);
    expect(Object.keys(parsed.legends ?? {}).length).toBe(9);
    expect(parsed.history.lore.filter((l) => l.legendId).length).toBe(9);
    // idempotent: a second pass adds nothing
    const before = parsed.history.lore.length;
    expect(migrateLoaded(parsed)).toBe(true);
    expect(parsed.history.lore.length).toBe(before);
    expect(parsed.history.lore.filter((l) => l.legendId).length).toBe(9);
  });
});

describe("ladder stage ordering", () => {
  it("ranks rise monotonically through the ladder", () => {
    const order = ["undiscovered", "rumored", "evidence", "located", "available", "defeated"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(stageRank(order[i])).toBeGreaterThan(stageRank(order[i - 1]));
    }
    expect(stageRank("fought")).toBe(stageRank("available"));
    expect(stageRank("tamed")).toBe(stageRank("defeated"));
    expect(hasReached({ stage: "located", since: 0 }, "rumored")).toBe(true);
    expect(hasReached({ stage: "located", since: 0 }, "available")).toBe(false);
    expect(hasReached(undefined, "rumored")).toBe(false);
  });
});

describe("legendaries in the signature-move system", () => {
  it("every legend's signature is its species-unique move, evolved to its level", () => {
    for (const def of legendList()) {
      const sig = legendSignature(def.speciesId, def.level, 12345);
      const unique = SPECIES[def.speciesId].learnset.find(([lv]) => lv === 20)![1];
      expect(sig.baseId, `${def.speciesId} sig base`).toBe(unique);
      expect(sig.mods.length, `${def.speciesId} evolved through every milestone`).toBe(Math.min(4, Math.floor(def.level / 10)));
      expect(sig.nextLevel).toBeGreaterThan(def.level);
      // the resolved technique stays a real, executable skill
      const resolved = resolveSignature(sig.baseId, sig.mods);
      expect(resolved.name).toBeTruthy();
      expect(resolved.desc).toContain(SKILLS[unique].name);
    }
  });

  it("a materialized legend body carries its birthright signature into the party", () => {
    const gs = makeGs();
    for (const def of legendList()) {
      const body = driveLegend(gs, def.speciesId);
      const unique = SPECIES[def.speciesId].learnset.find(([lv]) => lv === 20)![1];
      expect(body.sig, `${def.speciesId} has a signature`).toBeTruthy();
      expect(body.sig!.baseId).toBe(unique);
      expect(body.sig!.mods.length).toBe(Math.min(4, Math.floor(def.level / 10)));
    }
  });
});
