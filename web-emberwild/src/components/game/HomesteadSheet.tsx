/**
 * The Monster Homestead (Updates C & C.1) — the player's own plot of land.
 *
 * One sheet: Overview (buildings, rooms, construction, facility upgrades),
 * Build (prefab plans with map placement + room extensions), Sets (permanent
 * designation sets and per-room naming), and the function tabs — Pens, Cellar,
 * Breeding, Nursery — whose actions are gated on standing inside the right
 * room (the sim re-validates; the UI only mirrors it). Every mutation goes
 * through the authoritative act() into sim.ts wrappers.
 */
import { useEffect, useState } from "react";
import { Home, Hammer, PawPrint, Package, HeartHandshake, Egg, Building2, Tags, Maximize, RotateCw } from "lucide-react";
import { DAY_TICKS, ITEMS, SPECIES, SYNTH_MIN_LEVEL, ELEMENTS } from "@/game/data";
import { previewBreeding } from "@/game/breeding";
import { eggProgress, eggReady, hatchCarriedEgg } from "@/game/eggs";
import { canMate } from "@/game/mating";
import {
  FACILITIES, costLabel, levelOf, nurseryCapacityOf, nurseryEggs, packEggCount,
  penCapacityOf, storageCapacityOf, storageUsedOf,
} from "@/game/homestead";
import {
  DESIGNATIONS, DESIGNATION_ORDER, PREFABS, designationName, doorCandidates,
  expansionPlan, prefabOf, roomAccessReason, suitability, validateExpansion,
  growRoomPlan, sideHasDoor, type ExpansionKind, type Side,
} from "@/game/homesteadBuildings";
import {
  homesteadAddRoom, homesteadBuild, homesteadBuySet, homesteadDeposit, homesteadDesignate,
  homesteadExpandRoom, homesteadWithdraw, nurseryStoreEgg, nurseryTakeBackEgg, requestBreeding, swapPartyPenGuarded,
} from "@/game/sim";
import { displayName, geneGrade, statOf } from "@/game/monster";
import { expressGene, sizeToFootprint } from "@/game/genetics";
import { GENE_LABEL, SEX_INFO } from "@/game/monster";
import { act } from "@/game/store";
import type { CarriedEgg, GameState, ItemId, Monster, RoomFacility, RoomRecord } from "@/game/types";
import { cn } from "@/lib/utils";
import { Bar, Portrait, SectionTitle, Sheet, hpColor } from "./ui";
import { toast } from "sonner";

const TABS = [
  { id: "overview", label: "Homestead", icon: Home },
  { id: "build", label: "Build", icon: Hammer },
  { id: "sets", label: "Sets", icon: Tags },
  { id: "pens", label: "Pens", icon: PawPrint },
  { id: "cellar", label: "Cellar", icon: Package },
  { id: "breeding", label: "Breeding", icon: HeartHandshake },
  { id: "nursery", label: "Nursery", icon: Egg },
] as const;
type TabId = (typeof TABS)[number]["id"];
export type HomesteadTab = TabId;

const bagItems = (gs: GameState): ItemId[] => (Object.keys(gs.bag) as ItemId[]).filter((k) => (gs.bag[k] ?? 0) > 0);

function daysLeft(gs: GameState, completeTick: number): string {
  const d = Math.max(1, Math.ceil((completeTick - gs.tick) / DAY_TICKS));
  return `~${d} ${d === 1 ? "day" : "days"}`;
}

function buildDays(gs: GameState, ticks: number): string {
  const d = Math.max(1, Math.ceil(ticks / DAY_TICKS));
  return `${d} ${d === 1 ? "day" : "days"}`;
}

function MonPick({ m, active, onClick, badge }: { m: Monster; active?: boolean; onClick: () => void; badge?: React.ReactNode }) {
  const max = statOf(m, "hp");
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border-2 p-1.5 text-left transition-colors",
        active ? "border-gold bg-gold/10" : "border-frame/40 bg-night-3/40 hover:border-frame",
      )}
    >
      <Portrait speciesId={m.speciesId} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-pixel text-[14px] text-parchment">{displayName(m)}</span>
          <span className="font-mono text-[11px] text-parchment/60">Lv{m.level}</span>
        </div>
        <Bar value={m.hp} max={max} color={hpColor(m.hp / max)} className="mt-1 h-1.5" />
      </div>
      {badge}
    </button>
  );
}

function EggRow({ gs, egg, onStore }: { gs: GameState; egg: CarriedEgg; onStore?: boolean }) {
  const ready = eggReady(gs, egg);
  const pct = Math.round(eggProgress(gs, egg) * 100);
  return (
    <div className="flex items-center gap-2.5 rounded-md border-2 border-frame/40 bg-night-3/40 p-1.5">
      <span className="grid h-10 w-10 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: "#efe3c8" }}>◍</span>
      <div className="min-w-0 flex-1">
        <div className="font-pixel text-[14px] text-parchment">{SPECIES[egg.speciesId].name} egg</div>
        {ready ? (
          <div className="font-mono text-[11px] text-teal">ready to hatch</div>
        ) : (
          <Bar value={pct} max={100} color="#e8c56a" className="mt-1 h-1.5" />
        )}
        <div className="mt-0.5 font-mono text-[10px] text-parchment/55">{ready ? "the shell is shivering" : `${pct}% incubated`}</div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {ready ? (
          <>
            <button className="btn-game btn-teal h-8 px-2 text-[12px]" onClick={() => { const r = act((g) => hatchCarriedEgg(g, egg.id, "keep")); if (r) toast(r); }}>Keep</button>
            <button className="btn-game btn-night h-8 px-2 text-[12px]" onClick={() => { const r = act((g) => hatchCarriedEgg(g, egg.id, "release")); if (r) toast(r); }}>Release</button>
          </>
        ) : onStore ? (
          <button className="btn-game btn-night h-8 px-2 text-[12px]" onClick={() => toast(act((g) => nurseryStoreEgg(g, egg.id)) ?? "")}>To Nursery</button>
        ) : (
          <button className="btn-game btn-night h-8 px-2 text-[12px]" onClick={() => toast(act((g) => nurseryTakeBackEgg(g, egg.id)) ?? "")}>To Pack</button>
        )}
      </div>
    </div>
  );
}

/** Banner for the physical-access rule: overview may look, only the room may act. */
function AccessNotice({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-gold/40 bg-gold/5 px-2.5 py-2 text-[12px] text-gold/90">
      <PawPrint className="h-4 w-4 shrink-0" /> <span>{reason}</span>
    </div>
  );
}

const SIDES: { id: Side; label: string }[] = [
  { id: "n", label: "North" },
  { id: "e", label: "East" },
  { id: "s", label: "South" },
  { id: "w", label: "West" },
];

export function HomesteadSheet({
  gs, open, onClose, initialTab, onStartPlacing,
}: {
  gs: GameState;
  open: boolean;
  onClose: () => void;
  initialTab?: TabId;
  onStartPlacing?: (prefabId: string) => void;
}) {
  const [tab, setTab] = useState<TabId>(initialTab ?? "overview");
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  const h = gs.homestead!;
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const all = [...gs.party, ...gs.pen];
  const ma = all.find((m) => m.uid === a) ?? null;
  const mb = all.find((m) => m.uid === b) ?? null;
  const breedingBuilt = levelOf(gs, "breeding") > 0;
  const preview = ma && mb ? previewBreeding(ma, mb) : null;
  const mating = ma && mb ? canMate(ma, mb, "player", gs.tick) : null;
  const ready = !!ma && !!mb && ma.level >= SYNTH_MIN_LEVEL && mb.level >= SYNTH_MIN_LEVEL && all.length > 2 && !!mating?.ok && breedingBuilt;
  const stored = Object.keys(h.storage) as ItemId[];
  const cap = storageCapacityOf(gs);
  const used = storageUsedOf(gs);
  const nurseryCap = nurseryCapacityOf(gs);
  const racked = nurseryEggs(gs);
  const loose = (gs.eggs ?? []).filter((e) => !e.homestead);
  // physical access per function (the sim re-validates; this only mirrors it)
  const housingAccess = roomAccessReason(gs, "housing");
  const storageAccess = roomAccessReason(gs, "storage");
  const breedingAccess = roomAccessReason(gs, "breeding");
  const nurseryAccess = roomAccessReason(gs, "nursery");
  const ownedSets = DESIGNATION_ORDER.filter((f) => h.designations?.[f]);
  const rooms = h.rooms ?? [];

  const pick = (uid: string): void => {
    if (a === uid) setA("");
    else if (b === uid) setB("");
    else if (!a) setA(uid);
    else setB(uid);
  };

  return (
    <Sheet open={open} onClose={onClose} wide title={h.name} icon={<Home className="h-5 w-5 text-gold" />}>
      <div className="space-y-2.5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-parchment/60">
          <span>by {h.settlement.name} · {h.buildings?.length ?? 0} building{(h.buildings?.length ?? 0) === 1 ? "" : "s"} · {rooms.length} room{rooms.length === 1 ? "" : "s"}</span>
          <span>pen {gs.pen.length}/{penCapacityOf(gs)} · cellar {used}/{cap} · eggs {racked.length}/{nurseryCap}</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-md border-2 px-3 font-pixel text-[12px]",
                tab === id ? "border-ember bg-ember/15 text-gold" : "border-frame/40 text-parchment/70",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {/* ------------------------------- overview ------------------------------ */}
        {tab === "overview" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-parchment/70">
              Your own plot of land, walkable tile by tile. Name a room and it comes alive — a kitchen to cook in, a store room for the cellar, a bedroom to sleep till dawn. You must stand inside a room to use it.
            </p>
            {(h.buildings ?? []).map((bd) => {
              const def = prefabOf(bd.prefabId);
              const brooms = rooms.filter((r) => r.buildingId === bd.id);
              return (
                <div key={bd.id} className={cn("rounded-md border-2 p-2.5", bd.complete ? "border-frame/40 bg-night-3/40" : "border-teal/60 bg-teal/5")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-ink font-pixel text-base text-gold"><Building2 className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className="block truncate font-pixel text-[14px] text-parchment">{def?.name ?? bd.prefabId} <span className="ml-1 font-mono text-[10px] text-parchment/50">{bd.w}×{bd.h}</span></span>
                        <span className="block truncate font-mono text-[10px] text-parchment/55">{bd.style} · {brooms.length} room{brooms.length === 1 ? "" : "s"}</span>
                      </span>
                    </span>
                    {bd.complete ? (
                      <span className="shrink-0 rounded border border-teal/50 px-2 py-1 font-mono text-[10px] text-teal">standing</span>
                    ) : (
                      <span className="shrink-0 rounded border border-gold/50 px-2 py-1 font-mono text-[10px] text-gold">raising · {daysLeft(gs, bd.completeTick!)}</span>
                    )}
                  </div>
                  {brooms.map((r) => (
                    <div key={r.id} className="mt-1.5 flex items-center justify-between gap-2 rounded border border-frame/30 bg-black/10 px-2 py-1.5">
                      <span className="min-w-0 truncate text-[12px]">
                        <span className="font-pixel text-[12px] text-parchment/90">{designationName(r.designation)}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-parchment/50">{r.w}×{r.h} · {r.doors.length} door{r.doors.length === 1 ? "" : "s"} · {r.furniture.length} fittings</span>
                      </span>
                      {!r.complete ? <span className="shrink-0 font-mono text-[10px] text-gold">{daysLeft(gs, r.completeTick!)}</span> : null}
                    </div>
                  ))}
                </div>
              );
            })}
            <SectionTitle>Facilities & upgrades</SectionTitle>
            {Object.values(FACILITIES).map((def) => {
              const st = h.facilities[def.id];
              const lvl = levelOf(gs, def.id);
              const building = st?.building && gs.tick < (st.completeTick ?? 0) ? st.building : undefined;
              const next = def.future ? null : def.costs[lvl];
              const affordable = next ? gs.player.gold >= next.gold && Object.entries(next.items).every(([id, n]) => (gs.bag[id as ItemId] ?? 0) >= (n ?? 0)) : false;
              return (
                <div key={def.id} className={cn("rounded-md border-2 p-2.5", building ? "border-teal/60 bg-teal/5" : "border-frame/40 bg-night-3/40")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-ink font-pixel text-base text-gold">{def.glyph}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-pixel text-[14px] text-parchment">
                          {def.name}{lvl > 0 && !def.future ? <span className="ml-1 text-ember">· Lv{lvl}</span> : null}
                        </span>
                        <span className="block truncate font-body text-[11px] opacity-65">{def.blurb}</span>
                      </span>
                    </span>
                    {def.future ? (
                      <span className="shrink-0 rounded border border-frame/40 px-2 py-1 font-mono text-[10px] text-parchment/50">planned</span>
                    ) : building ? (
                      <span className="shrink-0 rounded border border-teal/50 px-2 py-1 font-mono text-[10px] text-teal">raising · {daysLeft(gs, st!.completeTick!)}</span>
                    ) : next ? (
                      <button
                        className="btn-game btn-parch h-9 shrink-0 px-2 text-[12px]"
                        disabled={!affordable}
                        onClick={() => { const r = act((g) => homesteadBuild(g, def.id)); if (r) toast(r); }}
                      >
                        <Hammer className="mr-1 inline h-3.5 w-3.5" />{lvl === 0 ? "Build" : `Lv${lvl + 1}`}
                      </button>
                    ) : (
                      <span className="shrink-0 rounded border border-gold/40 px-2 py-1 font-mono text-[10px] text-gold">complete</span>
                    )}
                  </div>
                  {next && !building ? <div className="mt-1.5 text-right font-mono text-[10px] text-parchment/55">{costLabel(next)} · takes {buildDays(gs, def.buildTicks)}</div> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* --------------------------------- build ------------------------------- */}
        {tab === "build" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-parchment/70">Raise prefab buildings anywhere on clear ground inside your bounds. Tap <span className="text-gold">Place</span>, then tap the map to position the plan — green means it may stand there.</p>
            <SectionTitle>Prefab plans</SectionTitle>
            {PREFABS.map((p) => {
              const affordable = gs.player.gold >= p.cost.gold && Object.entries(p.cost.items).every(([id, n]) => (gs.bag[id as ItemId] ?? 0) >= (n ?? 0));
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border-2 border-frame/40 bg-night-3/40 p-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-pixel text-[14px] text-parchment">{p.name} <span className="ml-1 font-mono text-[10px] text-parchment/50">{p.w}×{p.h} · {p.rooms.length} room{p.rooms.length === 1 ? "" : "s"}</span></span>
                    <span className="block truncate font-body text-[11px] opacity-65">{p.blurb}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-parchment/55">{costLabel(p.cost)} · takes {buildDays(gs, p.buildTicks)}</span>
                  </span>
                  <button
                    className="btn-game btn-parch h-9 shrink-0 px-2.5 text-[12px]"
                    disabled={!affordable || !onStartPlacing}
                    onClick={() => onStartPlacing?.(p.id)}
                  >
                    <RotateCw className="mr-1 inline h-3.5 w-3.5" /> Place
                  </button>
                </div>
              );
            })}
            <SectionTitle>Rooms & wings</SectionTitle>
            {(h.buildings ?? []).filter((bd) => bd.complete).length === 0 ? (
              <div className="rounded-md border border-dashed border-frame/40 p-3 text-center text-xs text-parchment/50">Finish a building first — wings and rooms attach to standing walls.</div>
            ) : null}
            {(h.buildings ?? []).filter((bd) => bd.complete).map((bd) => (
              <BuildingWings key={bd.id} gs={gs} buildingId={bd.id} />
            ))}
          </div>
        ) : null}

        {/* --------------------------------- sets -------------------------------- */}
        {tab === "sets" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-parchment/70">A designation set is bought once and owned forever — every room you own, now and later, may bear it. Naming a room refits it with furniture to match.</p>
            {DESIGNATION_ORDER.map((f) => {
              const def = DESIGNATIONS[f];
              const owned = !!h.designations?.[f];
              const affordable = gs.player.gold >= def.cost.gold && Object.entries(def.cost.items).every(([id, n]) => (gs.bag[id as ItemId] ?? 0) >= (n ?? 0));
              return (
                <div key={f} className={cn("rounded-md border-2 p-2.5", owned ? "border-teal/50 bg-teal/5" : "border-frame/40 bg-night-3/40")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-ink font-pixel text-base text-gold">{def.glyph}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-pixel text-[14px] text-parchment">{def.name}</span>
                        <span className="block truncate font-body text-[11px] opacity-65">{def.blurb}</span>
                      </span>
                    </span>
                    {owned ? (
                      <span className="shrink-0 rounded border border-teal/50 px-2 py-1 font-mono text-[10px] text-teal">owned</span>
                    ) : (
                      <button
                        className="btn-game btn-parch h-9 shrink-0 px-2.5 text-[12px]"
                        disabled={!affordable}
                        onClick={() => { const r = act((g) => homesteadBuySet(g, f)); if (r) toast(r); }}
                      >
                        Buy once
                      </button>
                    )}
                  </div>
                  {!owned ? <div className="mt-1.5 text-right font-mono text-[10px] text-parchment/55">{costLabel(def.cost)} · rooms of {def.minW}×{def.minH}+</div> : null}
                </div>
              );
            })}
            {rooms.length > 0 ? <SectionTitle>Name your rooms</SectionTitle> : null}
            {rooms.map((r) => (
              <RoomNaming key={r.id} gs={gs} room={r} ownedSets={ownedSets} />
            ))}
          </div>
        ) : null}

        {/* --------------------------------- pens -------------------------------- */}
        {tab === "pens" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-parchment/70">Monsters in the pen keep living, growing and ageing on their own. Swap them with the party here as freely as at any settlement.</p>
            <AccessNotice reason={housingAccess} />
            <SectionTitle>Party ({gs.party.length})</SectionTitle>
            {gs.party.map((m) => (
              <MonPick key={m.uid} m={m} onClick={() => { const r = act((g) => swapPartyPenGuarded(g, m.uid)); if (r) toast(r); }} />
            ))}
            <SectionTitle>Pen ({gs.pen.length}/{penCapacityOf(gs)})</SectionTitle>
            {gs.pen.length === 0 ? <div className="rounded-md border border-dashed border-frame/40 p-3 text-center text-xs text-parchment/50">The pens stand empty.</div> : null}
            {gs.pen.map((m) => (
              <MonPick key={m.uid} m={m} onClick={() => { const r = act((g) => swapPartyPenGuarded(g, m.uid)); if (r) toast(r); }} />
            ))}
          </div>
        ) : null}

        {/* -------------------------------- cellar ------------------------------- */}
        {tab === "cellar" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between font-pixel text-[13px] text-gold/80">
              <span>Root Cellar</span>
              <span className="font-mono text-[11px] text-parchment/60">{used}/{cap}</span>
            </div>
            {cap === 0 ? (
              <div className="rounded-md border border-dashed border-frame/40 p-4 text-center text-sm text-parchment/60">Build the Root Cellar on the Homestead tab to store goods here.</div>
            ) : (
              <>
                <AccessNotice reason={storageAccess} />
                <Bar value={used} max={cap} color="#b08a4a" className="h-2" />
                {bagItems(gs).length === 0 && stored.length === 0 ? <div className="p-3 text-center text-sm opacity-60">Nothing to store yet.</div> : null}
                {bagItems(gs).map((id) => (
                  <div key={id} className="flex items-center gap-2.5 rounded-md border border-frame/40 bg-black/5 p-2">
                    <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{ITEMS[id].name} <span className="font-mono text-[11px] font-normal opacity-60">×{gs.bag[id]}</span></span>
                    <button className="btn-game btn-night h-8 px-2 text-[12px]" onClick={() => toast(act((g) => homesteadDeposit(g, id, 1)) ?? "")}>+1</button>
                    <button className="btn-game btn-parch h-8 px-2 text-[12px]" onClick={() => toast(act((g) => homesteadDeposit(g, id, -1)) ?? "")}>All</button>
                  </div>
                ))}
                {stored.length > 0 ? <SectionTitle>In the cellar</SectionTitle> : null}
                {stored.map((id) => (
                  <div key={id} className="flex items-center gap-2.5 rounded-md border border-teal/30 bg-teal/5 p-2">
                    <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{ITEMS[id].name} <span className="font-mono text-[11px] font-normal opacity-60">×{h.storage[id]}</span></span>
                    <button className="btn-game btn-night h-8 px-2 text-[12px]" onClick={() => toast(act((g) => homesteadWithdraw(g, id, 1)) ?? "")}>+1</button>
                    <button className="btn-game btn-parch h-8 px-2 text-[12px]" onClick={() => toast(act((g) => homesteadWithdraw(g, id, -1)) ?? "")}>All</button>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : null}

        {/* -------------------------------- breeding ------------------------------ */}
        {tab === "breeding" ? (
          breedingBuilt ? (
            <div className="space-y-2">
              <p className="text-[13px] text-parchment/70">A quiet green hollow on your own land. Choose two monsters of level {SYNTH_MIN_LEVEL}+ — the same rites the shrines keep, and both parents stay with you.</p>
              <AccessNotice reason={breedingAccess} />
              {all.map((m) => (
                <MonPick
                  key={m.uid}
                  m={m}
                  active={m.uid === a || m.uid === b}
                  onClick={() => pick(m.uid)}
                  badge={m.level < SYNTH_MIN_LEVEL ? <span className="font-mono text-[10px] text-[#ff8a7a]">Lv{SYNTH_MIN_LEVEL}+</span> : m.uid === a ? <span className="font-pixel text-gold">A</span> : m.uid === b ? <span className="font-pixel text-gold">B</span> : null}
                />
              ))}
              {preview ? (
                <div className="panel-parchment p-3">
                  <div className="flex items-center gap-2">
                    <Portrait speciesId={preview.speciesId} size={56} />
                    <div>
                      <div className="font-serif text-lg font-extrabold">{SPECIES[preview.speciesId].name} <span className="font-pixel text-ember">+{preview.plus}</span></div>
                      <div className="text-[12px] opacity-70">{SPECIES[preview.speciesId].title} · <span style={{ color: ELEMENTS[SPECIES[preview.speciesId].element].color }}>{ELEMENTS[SPECIES[preview.speciesId].element].name}</span> · {SEX_INFO[preview.sex].glyph} {SEX_INFO[preview.sex].label}</div>
                    </div>
                  </div>
                  <div className="mt-2 font-mono text-[11px] opacity-70">skills: {preview.inherited.length ? preview.inherited.join(", ").replace(/_/g, " ") : "none"} · mutation chance {Math.round(preview.mutationChance * 100)}%</div>
                  <div className="mt-2 grid grid-cols-6 gap-1 text-center">
                    {(Object.keys(preview.genes) as (keyof typeof preview.genes)[]).map((k) => {
                      const p = preview.genes[k];
                      const expr = expressGene(p);
                      return (
                        <div key={k} className="rounded bg-black/5 py-1">
                          <div className="font-mono text-[10px] opacity-60">{GENE_LABEL[k]}</div>
                          <div className="font-pixel text-base">{k === "size" ? `${sizeToFootprint(expr)}×${sizeToFootprint(expr)}` : geneGrade(expr)}</div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="btn-game btn-teal mt-3 h-11 w-full text-sm"
                    disabled={!ready}
                    onClick={() => {
                      const out = act((g) => requestBreeding(g, a, b));
                      if (!out) return;
                      if ("reason" in out) {
                        toast(out.reason === "same_individual" ? "A monster cannot breed with itself." : out.reason === "biological_incompatibility" ? "These two are not biologically compatible right now." : "That pairing is not permitted.");
                        return;
                      }
                      setA("");
                      setB("");
                      toast("The rites take hold. A nest on your own land holds the future.");
                      onClose();
                    }}
                  >
                    Join their bloodlines
                  </button>
                </div>
              ) : (
                <div className="p-3 text-center text-sm opacity-60">Pick two monsters to see what they might raise.</div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-frame/40 p-4 text-center text-sm text-parchment/60">Build the Breeding Grounds on the Homestead tab first. Until then, the shrines keep the old rites.</div>
          )
        ) : null}

        {/* -------------------------------- nursery ------------------------------- */}
        {tab === "nursery" ? (
          <div className="space-y-2">
            <p className="text-[13px] text-parchment/70">Sand-warmed racks where stolen eggs incubate safely. Eggs here ride in no pack — each frees a hand, up to {nurseryCap} on the racks.</p>
            {nurseryCap === 0 ? (
              <div className="rounded-md border border-dashed border-frame/40 p-4 text-center text-sm text-parchment/60">Build the Hatchery Nursery on the Homestead tab first.</div>
            ) : (
              <>
                <AccessNotice reason={nurseryAccess} />
                <SectionTitle>On the racks ({racked.length}/{nurseryCap})</SectionTitle>
                {racked.length === 0 ? <div className="rounded-md border border-dashed border-frame/40 p-3 text-center text-xs text-parchment/50">No eggs resting here.</div> : null}
                {racked.map((egg) => <EggRow key={egg.id} gs={gs} egg={egg} />)}
                <SectionTitle>In your pack ({packEggCount(gs)}/4)</SectionTitle>
                {loose.length === 0 ? <div className="rounded-md border border-dashed border-frame/40 p-3 text-center text-xs text-parchment/50">No eggs riding with you.</div> : null}
                {loose.map((egg) => <EggRow key={egg.id} gs={gs} egg={egg} onStore />)}
              </>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** One room's designation picker: owned sets that fit, plus clear. */
function RoomNaming({ gs, room, ownedSets }: { gs: GameState; room: RoomRecord; ownedSets: RoomFacility[] }) {
  const bld = (gs.homestead!.buildings ?? []).find((b) => b.id === room.buildingId);
  const bname = prefabOf(bld?.prefabId ?? "")?.name ?? "Building";
  return (
    <div className="rounded-md border-2 border-frame/40 bg-night-3/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-pixel text-[13px] text-parchment">{bname} · room {room.w}×{room.h}</span>
        <span className={cn("shrink-0 rounded border px-2 py-0.5 font-mono text-[10px]", room.complete ? "border-teal/50 text-teal" : "border-gold/50 text-gold")}>
          {room.complete ? "standing" : "raising"}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-parchment/60">
        now: <span className="text-gold/90">{designationName(room.designation)}</span>
        {!room.complete ? " · furniture arrives when the building is done" : room.furniture.length > 0 ? ` · ${room.furniture.length} fittings` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {room.designation !== "undesignated" ? (
          <button className="btn-game btn-night h-8 px-2 text-[11px]" onClick={() => { const r = act((g) => homesteadDesignate(g, room.id, "undesignated")); if (r) toast(r); }}>
            Clear
          </button>
        ) : null}
        {ownedSets.map((f) => {
          const unfit = suitability(room, f);
          const active = room.designation === f;
          return (
            <button
              key={f}
              className={cn("btn-game h-8 px-2 text-[11px]", active ? "btn-ember" : "btn-parch")}
              disabled={active || (!!unfit && !active)}
              title={unfit || ""}
              onClick={() => { const r = act((g) => homesteadDesignate(g, room.id, f)); if (r) toast(r); }}
            >
              {DESIGNATIONS[f].glyph} {DESIGNATIONS[f].name}
            </button>
          );
        })}
        {ownedSets.length === 0 ? <span className="text-[11px] text-parchment/50">Buy a set above to name this room.</span> : null}
      </div>
      {ownedSets.filter((f) => room.designation !== f && suitability(room, f)).length > 0 ? (
        <div className="mt-1.5 font-mono text-[10px] text-parchment/50">
          {ownedSets.filter((f) => room.designation !== f && suitability(room, f)).map((f) => `${DESIGNATIONS[f].name}: ${suitability(room, f)}`).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One complete building's wings & rooms editor (Update C.2): attach rooms or
 * corridors on any side, choose the doorway position along the shared wall,
 * widen existing rooms — every plan previewed with its cost and its spoken
 * refusal before a single coin is spent.
 */
function BuildingWings({ gs, buildingId }: { gs: GameState; buildingId: string }) {
  const h = gs.homestead!;
  const bd = (h.buildings ?? []).find((b) => b.id === buildingId);
  if (!bd) return null;
  const def = prefabOf(bd.prefabId);
  const brooms = (h.rooms ?? []).filter((r) => r.buildingId === buildingId);
  const [kind, setKind] = useState<ExpansionKind>("room");
  const [side, setSide] = useState<Side | null>(null);
  const [doorIx, setDoorIx] = useState(0);

  const plan = bd && side ? expansionPlan(bd, side, kind) : null;
  const candidates = plan ? doorCandidates(gs, buildingId, plan) : [];
  const door = candidates.length > 0 ? candidates[Math.min(doorIx, candidates.length - 1)] : undefined;
  const reason = side ? validateExpansion(gs, buildingId, side, kind, kind === "room" ? door : undefined) : "";

  const choose = (s: Side): void => {
    if (side === s) {
      setSide(null);
      return;
    }
    setSide(s);
    setDoorIx(0);
  };

  return (
    <div className="rounded-md border-2 border-frame/40 bg-night-3/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-pixel text-[13px] text-parchment">{def?.name ?? bd.prefabId}</span>
        <div className="flex shrink-0 gap-1">
          {(["room", "corridor"] as ExpansionKind[]).map((k) => (
            <button
              key={k}
              className={cn("btn-game h-7 px-2 text-[10px]", kind === k ? "btn-ember" : "btn-night")}
              onClick={() => { setKind(k); setDoorIx(0); }}
            >
              {k === "room" ? "Room" : "Passage"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {brooms.map((r) => (
          <div key={r.id} className="rounded border border-frame/30 bg-black/10 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px]">
                <span className="font-pixel text-[12px] text-parchment/90">{designationName(r.designation)}</span>
                <span className="ml-1.5 font-mono text-[10px] text-parchment/50">
                  {r.w}×{r.h} · {r.doors.length} door{r.doors.length === 1 ? "" : "s"}
                  {r.complete ? ` · ${r.furniture.length} fittings` : " · raising"}
                </span>
              </span>
            </div>
            {r.complete ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="font-mono text-[10px] text-parchment/45">widen:</span>
                {SIDES.map(({ id, label }) => {
                  const doorInWall = sideHasDoor(r, id);
                  const gp = growRoomPlan(r, id);
                  const afford = gs.player.gold >= gp.cost.gold && Object.entries(gp.cost.items).every(([iid, n]) => (gs.bag[iid as ItemId] ?? 0) >= (n ?? 0));
                  return (
                    <button
                      key={id}
                      className="btn-game btn-night h-6 px-1.5 text-[10px]"
                      disabled={doorInWall || !afford}
                      title={doorInWall ? "A doorway stands in that wall." : `${costLabel(gp.cost)} · +1 pace ${label.toLowerCase()}`}
                      onClick={() => { const res = act((g) => homesteadExpandRoom(g, r.id, id)); toast(res || "Room widened."); }}
                    >
                      {label[0]}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {SIDES.map(({ id, label }) => (
          <button
            key={id}
            className={cn("btn-game h-8 px-1 text-[10px]", side === id ? "btn-ember" : "btn-night")}
            onClick={() => choose(id)}
          >
            <Maximize className="mr-0.5 inline h-3 w-3" />{kind === "room" ? "Room" : "Pass."} {label[0]}
          </button>
        ))}
      </div>

      {side && plan ? (
        <div className="mt-2 rounded border border-gold/40 bg-gold/5 p-2">
          <div className="text-[12px] text-parchment/80">
            {kind === "room"
              ? `A ${plan.room.w}×${plan.room.h} room on the ${side} side, opening into the building through a doorway in the shared wall.`
              : `A 1×${plan.room.h || plan.room.w} passage on the ${side} side — a door into the building, a door to the open air.`}
            {" "}{costLabel(plan.cost)} · takes {buildDays(gs, plan.ticks)}.
          </div>
          {kind === "room" && candidates.length > 1 ? (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-parchment/70">
              <span>Doorway:</span>
              <button className="btn-game btn-night h-7 w-7 text-[11px]" onClick={() => setDoorIx((i) => (i - 1 + candidates.length) % candidates.length)}>‹</button>
              <span className="font-mono">{doorIx + 1} of {candidates.length} · tile ({door?.x}, {door?.y})</span>
              <button className="btn-game btn-night h-7 w-7 text-[11px]" onClick={() => setDoorIx((i) => (i + 1) % candidates.length)}>›</button>
            </div>
          ) : null}
          {reason ? <div className="mt-1.5 text-[11px] text-[#ff8a7a]">{reason}</div> : null}
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-game btn-night h-9 px-3 text-[12px]" onClick={() => setSide(null)}>Cancel</button>
            <button
              className="btn-game btn-parch h-9 px-3 text-[12px]"
              disabled={!!reason}
              onClick={() => {
                const r = act((g) => homesteadAddRoom(g, buildingId, side, kind, kind === "room" ? door : undefined));
                toast(r || (kind === "corridor" ? "Passage construction started." : "Room construction started."));
                if (!r) setSide(null);
              }}
            >
              <Hammer className="mr-1 inline h-3.5 w-3.5" /> Build
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
