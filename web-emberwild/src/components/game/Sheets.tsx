import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Backpack, BedDouble, BookOpen, ChefHat, ClipboardList, Coins, Compass, Flame, FlaskConical, Footprints, Home, Landmark, Lock, Megaphone, PawPrint, ScrollText, Sparkles, Swords, Tent, Trophy, User, Utensils } from "lucide-react";
import { DAY_TICKS, ITEMS, PARTY_MAX, SHOP_STOCK, SPECIES, STAT_LABEL, SYNTH_MIN_LEVEL, ELEMENTS } from "@/game/data";
import { abandonContract, acceptContract, claimContract, claimReady, declineContract, offersAt, objectivesDone } from "@/game/contracts";
import { needsOf, NEED_KEYS } from "@/game/needs";
import { marketLine, settlementHere } from "@/game/economy";
import { settlementId } from "@/game/settlement";
import { devLines, devsAt, devsKnownToPlayer, shopPrice, PREDATOR_KILLS } from "@/game/worldevents";
import { NPC_ART, RIVAL_ART } from "@/game/assets";
import { previewBreeding } from "@/game/breeding";
import { PACK_EGG_CAP, eatCarriedEgg, eggProgress, eggReady, hatchCarriedEgg, postponeHatch, removeCarriedEgg } from "@/game/eggs";
import { canMate } from "@/game/mating";
import { getFactions } from "@/game/factions";
import { recruiterLines, residentLines, travelerLines } from "@/game/news";
import { repLabel, repOf } from "@/game/reputation";
import { anniversaryEvent, chronicleEntries, cultureOf, figureLines, loreAt, readChronicles, readFigure } from "@/game/history";
import { eventsKnownToPlayer } from "@/game/rumors";
import { getCleanSprite, onCleanSpriteReady } from "@/game/spritebg";
import { expressGene, sizeToFootprint } from "@/game/genetics";
import { GENE_LABEL, SEX_INFO, displayName, geneGrade, statOf } from "@/game/monster";
import { INN_COST, PEN_MAX, buyHomestead, buyItem, campRest, craftAtCamp, experimentAtCamp, experimentCraftAtCamp, cookAtCamp, hoursUntilDawn, innRest, moveInParty, offerFood, releaseMonster, sellItem, swapPartyPenGuarded, requestBreeding, useItemOn, addLog } from "@/game/sim";
import { COOK_RECIPES, EQUIP_METHOD, EQUIPMENT_IDS, METHOD_LABEL, isFavoriteMeal, isKnownRecipe, mealEffect, methodUnlocked, recipeFor } from "@/game/cooking";
import { PLOT_COST, costLabel, penCapacityOf } from "@/game/homestead";
import { roomAccessReason } from "@/game/homesteadBuildings";
import { CRAFT_RECIPES, isKnownCraft } from "@/game/crafting";
import { act } from "@/game/store";
import type { Contract, ContractCategory, DevInstance, GameState, GeneKey, ItemId, Monster } from "@/game/types";
import type { Feature, Npc } from "@/game/world";
import { getWorld } from "@/game/world";
import { cn } from "@/lib/utils";
import { MonsterDetail } from "./MonsterDetail";
import { Bar, Portrait, SectionTitle, Sheet, hpColor } from "./ui";
import { toast } from "sonner";

function MonRow({ m, active, onClick, right }: { m: Monster; active?: boolean; onClick: () => void; right?: React.ReactNode }) {
  const max = statOf(m, "hp");
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border-2 p-1.5 text-left transition-colors",
        active ? "border-gold bg-gold/10" : "border-frame/40 bg-night-3/40 hover:border-frame",
      )}
    >
      <Portrait speciesId={m.speciesId} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate font-pixel text-[15px] text-parchment">
            {displayName(m)}
            {m.plus ? <span className="text-ember"> +{m.plus}</span> : null}
            <span className="ml-1 font-mono text-[12px]" style={{ color: SEX_INFO[m.sex].color }}>{SEX_INFO[m.sex].glyph}</span>
          </span>
          <span className="font-mono text-[11px] text-parchment/60">Lv{m.level}</span>
        </div>
        <Bar value={m.hp} max={max} color={hpColor(m.hp / max)} className="mt-1 h-1.5" />
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-parchment/55">
          <span>{m.hp}/{max} HP</span>
          <span className={m.satiety < 25 ? "text-[#ff8a7a]" : ""}>Food {Math.round(m.satiety)}%</span>
        </div>
      </div>
      {right}
    </button>
  );
}

const FOOD_ITEMS = (gs: GameState): ItemId[] => (Object.keys(gs.bag) as ItemId[]).filter((k) => (gs.bag[k] ?? 0) > 0);

/* --------------------------------- Party ------------------------------------ */

export function PartySheet({ gs, open, onClose, atSettlement, atHomestead }: { gs: GameState; open: boolean; onClose: () => void; atSettlement: boolean; atHomestead?: boolean }) {
  const [sel, setSel] = useState<string>("");
  const [feeding, setFeeding] = useState<boolean>(false);
  const [rename, setRename] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<boolean>(false);
  const all = [...gs.party, ...gs.pen];
  const mon = all.find((m) => m.uid === sel) ?? gs.party[0];
  const inParty = gs.party.includes(mon);
  // pen swaps are free at any settlement; at the homestead they need a Monster Housing room (Update C.1)
  const atPen = atSettlement || (!!atHomestead && roomAccessReason(gs, "housing") === "");

  return (
    <Sheet open={open} onClose={onClose} wide title={`Monsters · ${gs.party.length}/${PARTY_MAX}`} icon={<PawPrint className="h-5 w-5" />}>
      <div className="flex flex-col gap-3 p-3 md:flex-row">
        <div className="space-y-1.5 md:w-72 md:shrink-0">
          <div className="font-pixel text-sm text-gold/80">Party</div>
          {gs.party.map((m, i) => (
            <MonRow
              key={m.uid}
              m={m}
              active={m.uid === mon?.uid}
              onClick={() => { setSel(m.uid); setFeeding(false); setConfirmRelease(false); }}
              right={
                <div className="flex flex-col">
                  <span role="button" aria-label="Move up" className={cn("grid h-6 w-7 place-items-center rounded text-parchment/70 hover:bg-white/10", i === 0 && "opacity-20")} onClick={(e) => { e.stopPropagation(); act((g) => moveInParty(g, m.uid, -1)); }}><ArrowUp className="h-3.5 w-3.5" /></span>
                  <span role="button" aria-label="Move down" className={cn("grid h-6 w-7 place-items-center rounded text-parchment/70 hover:bg-white/10", i === gs.party.length - 1 && "opacity-20")} onClick={(e) => { e.stopPropagation(); act((g) => moveInParty(g, m.uid, 1)); }}><ArrowDown className="h-3.5 w-3.5" /></span>
                </div>
              }
            />
          ))}
          <div className="flex items-center justify-between pt-2 font-pixel text-sm text-gold/80">
            <span>Pen at {gs.player.homeName}</span>
            <span className="font-mono text-[11px] text-parchment/50">{gs.pen.length}/{penCapacityOf(gs)}</span>
          </div>
          {gs.pen.length === 0 ? <div className="rounded-md border border-dashed border-frame/40 p-3 text-center text-xs text-parchment/50">Empty. Tamed monsters go here when your party is full.</div> : null}
          {!atPen && gs.pen.length > 0 ? <div className="text-[11px] text-parchment/50">Visit any settlement — or stand inside your Monster Housing room — to swap monsters in and out.</div> : null}
          {gs.pen.map((m) => (
            <MonRow key={m.uid} m={m} active={m.uid === mon?.uid} onClick={() => { setSel(m.uid); setFeeding(false); setConfirmRelease(false); }} />
          ))}
        </div>
        {mon ? (
          <div className="panel-parchment min-w-0 flex-1 p-4">
            <MonsterDetail mon={mon} />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button className="btn-game btn-ember h-11 text-sm" onClick={() => setFeeding((f) => !f)}><Utensils className="h-4 w-4" /> Feed</button>
              <button className="btn-game btn-night h-11 text-sm" onClick={() => setRename(rename === null ? displayName(mon) : null)}>Rename</button>
              <button
                className="btn-game btn-night h-11 text-sm"
                disabled={!atPen}
                onClick={() => { const r = act((g) => swapPartyPenGuarded(g, mon.uid)); if (r) toast(r); }}
              >
                {inParty ? "To Pen" : "To Party"}
              </button>
              {confirmRelease ? (
                <button className="btn-game h-11 bg-crimson text-sm text-parchment" onClick={() => { act((g) => releaseMonster(g, mon.uid)); setSel(""); setConfirmRelease(false); }}>Confirm</button>
              ) : (
                <button className="btn-game btn-night h-11 text-sm" disabled={inParty && gs.party.length <= 1} onClick={() => setConfirmRelease(true)}>Release</button>
              )}
            </div>
            {rename !== null ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => { mon.nickname = rename.trim() ? rename.trim().slice(0, 14) : null; });
                  setRename(null);
                }}
              >
                <input value={rename} onChange={(e) => setRename(e.target.value)} maxLength={14} className="h-11 min-w-0 flex-1 rounded-md border-2 border-frame bg-[#fff8e6] px-3 font-pixel text-ink outline-none" autoFocus />
                <button className="btn-game btn-teal h-11 text-sm">Save</button>
              </form>
            ) : null}
            {feeding ? <FeedGrid gs={gs} onPick={(item) => { const r = act((g) => useItemOn(g, mon, item)); if (r) { act((g) => addLog(g, r, "good")); toast(r); } }} speciesLikes={SPECIES[mon.speciesId].likes} /> : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function FeedGrid({ gs, onPick, speciesLikes, showLikes = true }: { gs: GameState; onPick: (i: ItemId) => void; speciesLikes?: ItemId; showLikes?: boolean }) {
  const items = FOOD_ITEMS(gs);
  if (!items.length) return <div className="mt-3 rounded-md border border-dashed border-frame/50 p-3 text-center text-sm opacity-70">Your bag is empty. Forage in the wild or visit a trader.</div>;
  // a cooked meal counts as the favorite when the raw favorite is an ingredient
  const loved = (id: ItemId): boolean => !!speciesLikes && (speciesLikes === id || isFavoriteMeal(speciesLikes, id));
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {items.map((id) => (
        <button key={id} onClick={() => onPick(id)} className={cn("flex items-center gap-2 rounded-md border-2 bg-black/5 p-2 text-left transition-transform active:scale-95", showLikes && loved(id) ? "border-ember" : "border-frame/40 hover:border-frame")}>
          <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">{ITEMS[id].name}</span>
            <span className="font-mono text-[11px] opacity-60">×{gs.bag[id]}{showLikes && loved(id) ? " · loves" : ""}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Bag ------------------------------------- */

export function BagSheet({ gs, open, onClose }: { gs: GameState; open: boolean; onClose: () => void }) {
  const [item, setItem] = useState<ItemId | null>(null);
  const [feedEgg, setFeedEgg] = useState<string | null>(null);
  const eggs = gs.eggs ?? [];
  const items = FOOD_ITEMS(gs);
  const it = item && (gs.bag[item] ?? 0) > 0 ? ITEMS[item] : null;
  return (
    <Sheet open={open} onClose={onClose} title="Bag" icon={<Backpack className="h-5 w-5" />}>
      <div className="p-3">
        <div className="mb-3 flex items-center gap-2 font-pixel text-gold"><Coins className="h-4 w-4" /> {gs.player.gold} gold</div>
        {eggs.length ? (
          <div className="mb-3">
            <SectionTitle>Eggs ({eggs.length}/{PACK_EGG_CAP})</SectionTitle>
            <div className="space-y-1.5">
              {eggs.map((egg) => {
                const ready = eggReady(gs, egg);
                const days = Math.max(1, Math.ceil((egg.hatchTick - gs.tick) / DAY_TICKS));
                const par = egg.child.parentNames;
                return (
                  <div key={egg.id} className={cn("rounded-md border-2 p-2", ready ? "border-gold/70 bg-gold/5" : "border-frame/40 bg-night-3/40")}>
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-night font-pixel text-xl text-gold">◍</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold text-parchment">{SPECIES[egg.speciesId].name} egg{egg.nursery ? " · wild flock" : ""}</span>
                        <span className="block truncate text-[12px] text-parchment/60">{par ? `Bloodline of ${par[0]} × ${par[1]}` : "No recorded parents"}</span>
                      </span>
                      <span className={cn("shrink-0 font-mono text-[11px]", ready ? "text-gold" : "text-parchment/60")}>{ready ? "ready" : `${days}d`}</span>
                    </div>
                    <Bar value={eggProgress(gs, egg)} max={1} color={ready ? "linear-gradient(180deg,#f2c14e,#c98a2b)" : "linear-gradient(180deg,#9fd3e6,#5a8aa0)"} className="mt-1.5 h-1.5" />
                    {ready ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button className="btn-game btn-ember h-9 flex-1 text-[12px]" onClick={() => { const msg = act((g) => hatchCarriedEgg(g, egg.id, "keep")); if (msg) { act((g) => postponeHatch(g, egg.id)); toast(msg); } }}>Keep</button>
                        <button className="btn-game btn-night h-9 flex-1 text-[12px]" onClick={() => { const msg = act((g) => hatchCarriedEgg(g, egg.id, "release")); if (msg) toast(msg); }}>Release</button>
                        <button className="btn-game btn-night h-9 flex-1 text-[12px]" onClick={() => { const msg = act((g) => eatCarriedEgg(g, egg.id)); if (msg) toast(msg); }}>Eat</button>
                        <button className={cn("btn-game h-9 flex-1 text-[12px]", feedEgg === egg.id ? "btn-ember" : "btn-night")} onClick={() => setFeedEgg(feedEgg === egg.id ? null : egg.id)}>Feed</button>
                      </div>
                    ) : null}
                    {ready && feedEgg === egg.id ? (
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                        {[...gs.party, ...gs.pen].map((m) => (
                          <button
                            key={m.uid}
                            className="flex items-center gap-2 rounded-md border-2 border-frame/40 bg-black/5 p-1.5 hover:border-frame active:scale-95"
                            onClick={() => {
                              const r = act((g) => {
                                const carried = removeCarriedEgg(g, egg.id);
                                if (!carried) return "That egg is no longer in your pack.";
                                return useItemOn(g, m, "egg");
                              });
                              if (r) toast(r);
                              setFeedEgg(null);
                            }}
                          >
                            <Portrait speciesId={m.speciesId} size={32} />
                            <span className="text-left text-[12px] font-bold leading-tight">{displayName(m)}<br /><span className="font-mono text-[10px] font-normal opacity-60">Food {Math.round(m.satiety)}%</span></span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {items.length === 0 ? <div className="rounded-md border border-dashed border-frame/50 p-6 text-center text-sm text-parchment/60">Nothing but crumbs. Press Forage on rich tiles to gather food.</div> : null}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {items.map((id) => (
            <button key={id} onClick={() => setItem(id)} className={cn("flex items-center gap-2.5 rounded-md border-2 p-2 text-left", item === id ? "border-gold bg-gold/10" : "border-frame/40 bg-night-3/40")}>
              <span className="grid h-9 w-9 place-items-center rounded bg-night font-pixel text-xl" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-parchment">{ITEMS[id].name}</span>
                <span className="block truncate text-[12px] text-parchment/60">{ITEMS[id].desc}</span>
              </span>
              <span className="font-mono text-sm text-parchment/80">×{gs.bag[id]}</span>
            </button>
          ))}
        </div>
        {it && item ? (
          <div className="panel-parchment mt-3 p-3">
            <div className="font-serif text-lg font-bold">{it.name}</div>
            <div className="text-[13px] opacity-75">{it.desc}</div>
            <div className="mt-1 font-mono text-[12px] opacity-70">Food +{it.food} · Heal +{it.heal} · Diets: {it.diets.join(", ") || "any"} · Worth {it.value}g</div>
            <SectionTitle>Give to</SectionTitle>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {gs.party.map((m) => (
                <button
                  key={m.uid}
                  className="flex items-center gap-2 rounded-md border-2 border-frame/40 bg-black/5 p-1.5 hover:border-frame active:scale-95"
                  onClick={() => { const r = act((g) => useItemOn(g, m, item)); if (r) { act((g) => addLog(g, r, "good")); toast(r); } }}
                >
                  <Portrait speciesId={m.speciesId} size={36} />
                  <span className="text-left text-[13px] font-bold leading-tight">{displayName(m)}<br /><span className="font-mono text-[10px] font-normal opacity-60">{m.hp}/{statOf(m, "hp")} · {Math.round(m.satiety)}%</span></span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* -------------------------------- Feed wild --------------------------------- */

export function OfferSheet({ gs, open, onClose, creatureId, onEngage }: { gs: GameState; open: boolean; onClose: () => void; creatureId: string | null; onEngage: (id: string) => void }) {
  const c = creatureId ? gs.creatures[creatureId] : null;
  return (
    <Sheet open={open && !!c} onClose={onClose} title={c ? `Offer food to ${SPECIES[c.speciesId].name}` : "Offer food"} icon={<Utensils className="h-5 w-5" />}>
      {c ? (
        <div className="p-3">
          <div className="panel-parchment p-3">
            <div className="flex items-center gap-3">
              <Portrait speciesId={c.speciesId} size={56} />
              <div className="text-[13px] leading-snug">
                Feed a creature its favourite food to calm it and win it over. Enough affection and it will follow you without a fight.
                <div className="mt-1 font-mono text-[12px]">Affection {c.affection}/100 · Diet <span className="capitalize">{SPECIES[c.speciesId].diet}</span></div>
                {c.feedUntil && c.feedUntil > gs.tick ? (
                  <div className="mt-1 font-mono text-[12px] text-ember">Still eating — it won't take more food for ~{Math.max(1, Math.ceil((c.feedUntil - gs.tick) / 12))}h</div>
                ) : null}
              </div>
            </div>
            <FeedGrid
              gs={gs}
              speciesLikes={SPECIES[c.speciesId].likes}
              showLikes={!!gs.seen[c.speciesId] || gs.player.origin === "scholar"}
              onPick={(item) => {
                const r = act((g) => offerFood(g, c.id, item));
                if (r?.engaged) {
                  onClose();
                  onEngage(r.engaged);
                } else if (!gs.creatures[c.id]) onClose();
              }}
            />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/* --------------------------------- Camp ------------------------------------- */

export function CampSheet({ gs, open, onClose, onEngage, onCook, onCraft }: { gs: GameState; open: boolean; onClose: () => void; onEngage: (id: string) => void; onCook: () => void; onCraft: () => void }) {
  const dawn = hoursUntilDawn(gs.tick);
  const run = (h: number): void => {
    const r = act((g) => campRest(g, h));
    onClose();
    if (r?.engaged) onEngage(r.engaged);
  };
  const owned = (id: string): boolean => !!gs.cooking?.equipment?.[id];
  return (
    <Sheet open={open} onClose={onClose} title="Make Camp" icon={<Tent className="h-5 w-5" />}>
      <div className="space-y-3 p-3">
        <div className="panel-parchment flex items-center gap-3 p-3">
          <Flame className="anim-flicker h-10 w-10 shrink-0 text-ember" fill="#f2c14e" />
          <p className="text-[13px] leading-snug">
            Rest heals your monsters and roasts any raw nuts you carry. Hungry monsters eat from your bag. The wild doesn't sleep, though. Predators may find your fire.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button className="btn-game btn-night h-14 flex-col gap-0 text-sm" onClick={() => run(2)}>2 hours<span className="font-body text-[11px] opacity-60">short rest</span></button>
          <button className="btn-game btn-night h-14 flex-col gap-0 text-sm" onClick={() => run(4)}>4 hours<span className="font-body text-[11px] opacity-60">long rest</span></button>
          <button className="btn-game btn-ember h-14 flex-col gap-0 text-sm" onClick={() => run(dawn)}>Until dawn<span className="font-body text-[11px] opacity-80">{dawn}h</span></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-game btn-night h-14 flex-col gap-0 text-sm" onClick={() => { onClose(); onCook(); }}>
            <span className="flex items-center gap-1.5"><ChefHat className="h-4 w-4" /> Cook</span>
            <span className="font-body text-[11px] opacity-60">{owned("skillet") && owned("cooking_pot") && owned("portable_oven") ? "all methods ready" : "roasting · more with gear"}</span>
          </button>
          <button className="btn-game btn-night h-14 flex-col gap-0 text-sm" onClick={() => { onClose(); onCraft(); }}>
            <span className="flex items-center gap-1.5"><FlaskConical className="h-4 w-4" /> Brew & Craft</span>
            <span className="font-body text-[11px] opacity-60">remedies, cures, brews</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* --------------------------- Cooking & Crafting ------------------------------- */

const TIER_ROMAN = ["I", "II", "III", "IV"] as const;

function IngChip({ id, have, need }: { id: ItemId; have: number; need: number }) {
  const ok = have >= need;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]", ok ? "border-frame/40 bg-black/5" : "border-[#ff8a7a]/60 bg-[#ff8a7a]/10 text-[#ff8a7a]")}>
      <span className="font-pixel" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
      {ITEMS[id].name} {have}/{need}
    </span>
  );
}

export function CookingSheet({ gs, open, onClose }: { gs: GameState; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"recipes" | "experiment">("recipes");
  const [picks, setPicks] = useState<ItemId[]>([]);
  const owned = (id: string): boolean => !!gs.cooking?.equipment?.[id];
  const cookables = FOOD_ITEMS(gs).filter((id) => ITEMS[id].food > 0);
  const toggle = (id: ItemId): void => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p));
  const cook = (recipeId: string): void => {
    const r = act((g) => cookAtCamp(g, recipeId));
    if (r) toast(r);
  };
  const simmer = (): void => {
    const r = act((g) => experimentAtCamp(g, picks));
    setPicks([]);
    if (r) toast(r);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Camp Cooking" icon={<ChefHat className="h-5 w-5 text-ember" />}>
      <div className="space-y-3 p-3">
        <div className="panel-parchment p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["roast", "grill", "stew", "bake"] as const).map((m) => {
              const eq = EQUIPMENT_IDS.find((e) => EQUIP_METHOD[e] === m);
              const ready = m === "roast" || (eq ? owned(eq) : false);
              return (
                <span key={m} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-pixel text-[11px]", ready ? "border-[#c98a3c]/60 bg-[#c98a3c]/15 text-[#a4611e]" : "border-frame/40 text-parchment/45 opacity-70")}>
                  {ready ? <Flame className="h-3 w-3" /> : <Lock className="h-3 w-3" />} {METHOD_LABEL[m]}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] leading-snug opacity-70">Every meal fills the belly and carries one lasting boon that fades with the days. Roasting needs no gear — the skillet, pot and oven are sold by traders.</p>
        </div>
        <div className="flex gap-2">
          {(["recipes", "experiment"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("h-9 flex-1 rounded-md border-2 font-pixel text-sm capitalize", tab === t ? "border-ember bg-ember/15" : "border-frame/40")}>{t}</button>
          ))}
        </div>
        {tab === "recipes" ? (
          <div className="space-y-2">
            {COOK_RECIPES.map((r) => {
              const known = isKnownRecipe(gs, r);
              const unlocked = methodUnlocked(gs, r.method);
              const have = (i: ItemId): number => r.ingredients.filter((x) => x === i).length;
              const ings = [...new Set(r.ingredients)];
              const can = known && unlocked && ings.every((i) => (gs.bag[i] ?? 0) >= have(i));
              const fx = mealEffect(r);
              return (
                <div key={r.id} className={cn("rounded-md border-2 p-2.5", known ? "border-frame/40 bg-black/5" : "border-dashed border-frame/40 opacity-75")}>
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[r.output].color }}>{known ? ITEMS[r.output].glyph : "?"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold leading-tight">{known ? r.name : `Unknown ${METHOD_LABEL[r.method].toLowerCase()} dish`}</div>
                      <div className="font-mono text-[10px] opacity-65">Tier {TIER_ROMAN[r.tier - 1]} · {METHOD_LABEL[r.method]} · +{fx.amount} {STAT_LABEL[fx.stat]} for {Math.round(fx.duration / 288 * 10) / 10}d</div>
                    </div>
                    {known ? (
                      <button className="btn-game btn-parch h-9 min-w-[64px] px-2 text-[13px]" disabled={!can} onClick={() => cook(r.id)}>Cook</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] opacity-60"><Lock className="h-3 w-3" /> experiment</span>
                    )}
                  </div>
                  {known ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {ings.map((i) => <IngChip key={i} id={i} have={gs.bag[i] ?? 0} need={have(i)} />)}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] opacity-60">Try {METHOD_LABEL[r.method].toLowerCase()} combinations in the Experiment tab to discover it.</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] leading-snug opacity-75">Pick one to four ingredients and see what the fire makes of them. Matches cook known dishes — or discover new ones. Mismatches feed the flames.</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {cookables.map((id) => (
                <button key={id} onClick={() => toggle(id)} className={cn("flex items-center gap-2 rounded-md border-2 bg-black/5 p-2 text-left transition-transform active:scale-95", picks.includes(id) ? "border-ember" : "border-frame/40 hover:border-frame")}>
                  <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{ITEMS[id].name}</span>
                    <span className="font-mono text-[11px] opacity-60">×{gs.bag[id]}</span>
                  </span>
                </button>
              ))}
            </div>
            <button className="btn-game btn-ember h-12 w-full text-sm" disabled={picks.length < 2} onClick={simmer}>
              <Flame className="h-4 w-4" /> Simmer ({picks.length}/4)
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function CraftingSheet({ gs, open, onClose }: { gs: GameState; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"recipes" | "experiment">("recipes");
  const [picks, setPicks] = useState<ItemId[]>([]);
  const mats = FOOD_ITEMS(gs).filter((id) => ITEMS[id].food > 0 || ITEMS[id].cures.length > 0 || ITEMS[id].grants);
  const toggle = (id: ItemId): void => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p));
  const craft = (recipeId: string): void => {
    const r = act((g) => craftAtCamp(g, recipeId));
    if (r) toast(r);
  };
  const brew = (): void => {
    const r = act((g) => experimentCraftAtCamp(g, picks));
    setPicks([]);
    if (r) toast(r);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Brew & Craft" icon={<FlaskConical className="h-5 w-5 text-teal" />}>
      <div className="space-y-3 p-3">
        <div className="panel-parchment p-3">
          <p className="text-[13px] leading-snug">Grind foraged herbs, caps and glintstone into remedies, cures and battle brews. Tier I recipes are common knowledge — the stronger brews wait to be discovered by experiment.</p>
        </div>
        <div className="flex gap-2">
          {(["recipes", "experiment"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("h-9 flex-1 rounded-md border-2 font-pixel text-sm capitalize", tab === t ? "border-ember bg-ember/15" : "border-frame/40")}>{t}</button>
          ))}
        </div>
        {tab === "recipes" ? (
          <div className="space-y-2">
            {CRAFT_RECIPES.map((r) => {
              const known = isKnownCraft(gs, r);
              const need = (i: ItemId): number => r.ingredients.filter((x) => x === i).length;
              const ings = [...new Set(r.ingredients)];
              const can = known && ings.every((i) => (gs.bag[i] ?? 0) >= need(i));
              return (
                <div key={r.id} className={cn("rounded-md border-2 p-2.5", known ? "border-frame/40 bg-black/5" : "border-dashed border-frame/40 opacity-75")}>
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[r.output].color }}>{known ? ITEMS[r.output].glyph : "?"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold leading-tight">{known ? r.name : "Unknown remedy"}</div>
                      <div className="font-mono text-[10px] opacity-65">Tier {TIER_ROMAN[r.tier - 1]} · {ITEMS[r.output].desc}</div>
                    </div>
                    {known ? (
                      <button className="btn-game btn-parch h-9 min-w-[64px] px-2 text-[13px]" disabled={!can} onClick={() => craft(r.id)}>Brew</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] opacity-60"><Lock className="h-3 w-3" /> experiment</span>
                    )}
                  </div>
                  {known ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {ings.map((i) => <IngChip key={i} id={i} have={gs.bag[i] ?? 0} need={need(i)} />)}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] opacity-60">Try combinations in the Experiment tab to discover it.</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] leading-snug opacity-75">Pick one to four materials and work them in the mortar. Matches brew known recipes — or discover new ones. Mismatches cost the materials.</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {mats.map((id) => (
                <button key={id} onClick={() => toggle(id)} className={cn("flex items-center gap-2 rounded-md border-2 bg-black/5 p-2 text-left transition-transform active:scale-95", picks.includes(id) ? "border-ember" : "border-frame/40 hover:border-frame")}>
                  <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{ITEMS[id].name}</span>
                    <span className="font-mono text-[11px] opacity-60">×{gs.bag[id]}</span>
                  </span>
                </button>
              ))}
            </div>
            <button className="btn-game btn-teal h-12 w-full text-sm" disabled={picks.length < 2} onClick={brew}>
              <FlaskConical className="h-4 w-4" /> Grind & Brew ({picks.length}/4)
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ----------------------------- Hamlet folk ---------------------------------- */

const NPC_ROLE: Record<Npc["role"], string> = { innkeep: "Innkeeper", trader: "Trader", penkeeper: "Pen Keeper", resident: "Resident", recruiter: "Association Recruiter", traveler: "Traveler", steward: "Coliseum Steward", champion: "Circuit Champion", scholar: "Scholar", explorer: "Explorer", official: "Association Official", memorial: "Memorial", marker: "Waystone" };
const NPC_ICON: Record<Npc["role"], typeof Home> = { innkeep: BedDouble, trader: Coins, penkeeper: PawPrint, resident: User, recruiter: Megaphone, traveler: Footprints, steward: Trophy, champion: Swords, scholar: BookOpen, explorer: Compass, official: ScrollText, memorial: Landmark, marker: Landmark };

export function NpcSheet({ gs, open, npc, onClose, onParty, onColiseum, onChronicles }: { gs: GameState; open: boolean; npc: Npc | null; onClose: () => void; onParty: () => void; onColiseum: () => void; onChronicles: () => void }) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const sellable = FOOD_ITEMS(gs);
  const isHome = gs.player.x === gs.player.homeX && gs.player.y === gs.player.homeY;
  const settlementName = npc?.settlement ?? "";
  if (!npc) return null;
  const Icon = NPC_ICON[npc.role];
  // the generational past (Update G.1): figures speak from their own careers;
  // stones speak for those who can no longer speak
  const isFigure = !!npc.figureId && (npc.role === "champion" || npc.role === "scholar" || npc.role === "explorer" || npc.role === "official");
  const isStone = npc.role === "memorial" || npc.role === "marker";
  const baseTalk = isFigure ? figureLines(gs, npc.figureId!) : npc.role === "resident" ? residentLines(gs, npc) : npc.role === "recruiter" ? recruiterLines(gs, npc) : npc.role === "traveler" ? travelerLines(gs, npc) : [npc.line];
  // a recruiter's trade is work: point strangers at the contract board
  const talk = npc.role === "recruiter" ? [...baseTalk, "Looking for work? The contract board on the green lists hunting, gathering and delivery work — honest pay for honest names."] : npc.role === "steward" ? [...baseTalk, "The circuit's ladder runs F to S — every match, here or abroad, moves your name on it."] : baseTalk;
  return (
    <Sheet open={open} onClose={onClose} title={`${npc.name} · ${NPC_ROLE[npc.role]}`} icon={<Icon className="h-5 w-5" />}>
      <div className="space-y-3 p-3">
        <div className="panel-parchment flex items-center gap-3 p-3">
          <img src={NPC_ART[npc.role]} alt="" className="h-16 w-16 shrink-0 object-contain" />
          <div>
            {talk.map((line, i) => (
              <div key={i} className="font-serif text-sm font-bold">“{line}”</div>
            ))}
            <div className="mt-1 font-mono text-[11px] opacity-60">{npc.name} of {settlementName}</div>
          </div>
        </div>
        <div className="flex items-center justify-between font-pixel text-gold"><span className="flex items-center gap-2"><Coins className="h-4 w-4" /> {gs.player.gold} gold</span>{isHome ? <span className="text-xs text-teal">Home</span> : null}</div>
        {npc.role === "innkeep" ? (
          <>
            <button className="btn-game btn-ember h-14 w-full flex-col gap-0 text-sm" disabled={gs.player.gold < INN_COST} onClick={() => { const r = act((g) => innRest(g)); if (r) { toast(r); onClose(); } }}>
              <span className="flex items-center gap-1.5"><BedDouble className="h-4 w-4" /> Rest at the Inn</span>
              <span className="font-body text-[11px] opacity-80">{INN_COST}g · full heal, fed, until dawn</span>
            </button>
            {!isHome ? (
              <button
                className="btn-game btn-night h-11 w-full text-sm"
                onClick={() => act((g) => { g.player.homeX = g.player.x; g.player.homeY = g.player.y; g.player.homeName = settlementName; addLog(g, `You make ${settlementName} your home. ${npc.name} promises to bring your monsters over.`, "good"); onClose(); })}
              >
                <Home className="h-4 w-4" /> Make {settlementName} your home
              </button>
            ) : null}
            {!gs.homestead ? (
              <button
                className="btn-game btn-night h-11 w-full flex-col gap-0 text-sm"
                onClick={() => { const r = act((g) => buyHomestead(g)); if (r) toast(r); }}
              >
                <span className="flex items-center gap-1.5"><Footprints className="h-4 w-4" /> Buy a homestead plot</span>
                <span className="font-body text-[11px] opacity-80">{costLabel(PLOT_COST)} · land of your own nearby</span>
              </button>
            ) : (
              <div className="text-center font-body text-[11px] text-parchment/50">Your homestead plot lies in the wilds nearby — visit it to build and store.</div>
            )}
          </>
        ) : null}
        {npc.role === "penkeeper" ? (
          <button className="btn-game btn-night h-14 w-full flex-col gap-0 text-sm" onClick={onParty}>
            <span className="flex items-center gap-1.5"><PawPrint className="h-4 w-4" /> Visit the Monster Pen</span>
            <span className="font-body text-[11px] opacity-60">{gs.pen.length} waiting · swap party members</span>
          </button>
        ) : null}
        {npc.role === "steward" ? (
          <button className="btn-game btn-ember h-14 w-full flex-col gap-0 text-sm" onClick={onColiseum}>
            <span className="flex items-center gap-1.5"><Trophy className="h-4 w-4" /> Approach the arena</span>
            <span className="font-body text-[11px] opacity-80">proclamations · your match · the F–S ladder</span>
          </button>
        ) : null}
        {isFigure && npc.figureId ? (
          <button
            className="btn-game btn-teal h-14 w-full flex-col gap-0 text-sm"
            onClick={() => {
              const n = act((g) => readFigure(g, npc.figureId!));
              if (n) toast(`${n} record${n === 1 ? "" : "s"} added to your chronicles.`);
              onChronicles();
            }}
          >
            <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> Read their chronicle</span>
            <span className="font-body text-[11px] opacity-80">the records of their life and times</span>
          </button>
        ) : null}
        {isStone && npc ? (
          <button
            className="btn-game btn-teal h-14 w-full flex-col gap-0 text-sm"
            onClick={() => {
              const n = act((g) => readChronicles(g, loreAt(g, npc.x, npc.y)));
              if (n) toast(`${n} record${n === 1 ? "" : "s"} added to your chronicles.`);
              else toast("The stone holds nothing more you have not read.");
              onChronicles();
            }}
          >
            <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> Read the stone</span>
            <span className="font-body text-[11px] opacity-80">what was written for those who came before</span>
          </button>
        ) : null}
        {npc.role === "trader" ? (
          <div className="panel-parchment p-3">
            <div className="mb-2 flex gap-2">
              {(["buy", "sell"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("h-9 flex-1 rounded-md border-2 font-pixel text-sm capitalize", tab === t ? "border-ember bg-ember/15" : "border-frame/40")}>{t}</button>
              ))}
            </div>
            {(() => {
              const here = settlementHere(gs);
              const line = here ? marketLine(gs, here) : null;
              return line ? <div className="mb-2 font-serif text-[12px] italic opacity-70">“{line}”</div> : null;
            })()}
            <div className="space-y-1.5">
              {(tab === "buy" ? SHOP_STOCK : sellable).map((id) => {
                const here = settlementHere(gs);
                const price = tab === "buy" ? (shopPrice(gs, here, id, "buy") ?? Math.ceil(ITEMS[id].value * 1.5)) : (shopPrice(gs, here, id, "sell") ?? ITEMS[id].value);
                const fair = tab === "buy" ? Math.ceil(ITEMS[id].value * 1.5) : ITEMS[id].value;
                return (
                  <div key={id} className="flex items-center gap-2.5 rounded-md border border-frame/40 bg-black/5 p-2">
                    <span className="grid h-8 w-8 place-items-center rounded bg-ink font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold">{ITEMS[id].name} {tab === "sell" ? <span className="font-mono font-normal opacity-60">×{gs.bag[id]}</span> : null}</span>
                      <span className="block truncate text-[11px] opacity-65">{ITEMS[id].desc}</span>
                    </span>
                    <button
                      className={cn("btn-game btn-parch h-10 min-w-[72px] px-2 text-sm", price < fair && "text-teal", price > fair && "text-ember")}
                      disabled={tab === "buy" && gs.player.gold < price}
                      onClick={() => { const r = act((g) => (tab === "buy" ? buyItem(g, id) : sellItem(g, id))); if (r) toast(r); }}
                    >
                      {price}g
                    </button>
                  </div>
                );
              })}
              {tab === "sell" && sellable.length === 0 ? <div className="p-3 text-center text-sm opacity-60">Nothing to sell.</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );}

/* -------------------------------- Shrine ------------------------------------ */

export function ShrineSheet({ gs, open, onClose, name }: { gs: GameState; open: boolean; onClose: () => void; name: string }) {
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const all = [...gs.party, ...gs.pen];
  const ma = all.find((m) => m.uid === a) ?? null;
  const mb = all.find((m) => m.uid === b) ?? null;
  const preview = useMemo(() => (ma && mb ? previewBreeding(ma, mb) : null), [ma, mb]);
  const mating = useMemo(() => (ma && mb ? canMate(ma, mb, "player", gs.tick) : null), [ma, mb, gs.tick]);
  const ready = !!ma && !!mb && ma.level >= SYNTH_MIN_LEVEL && mb.level >= SYNTH_MIN_LEVEL && all.length > 2 && !!mating?.ok;
  const broods = Object.values(gs.developments).filter((d) => d.state === "developing" || d.state === "ready");
  const known = preview ? !!gs.seen[preview.speciesId] : false;

  const pick = (uid: string): void => {
    if (a === uid) setA("");
    else if (b === uid) setB("");
    else if (!a) setA(uid);
    else setB(uid);
  };

  return (
    <Sheet open={open} onClose={onClose} wide title={name} icon={<Sparkles className="h-5 w-5 text-teal" />}>
      <div className="flex flex-col gap-3 p-3 md:flex-row">
        <div className="md:w-80 md:shrink-0">
          <p className="mb-2 text-[13px] text-parchment/70">Choose two monsters of level {SYNTH_MIN_LEVEL}+. The shrine joins their bloodlines: the offspring inherits genes, a few skills and sometimes mutations, then develops in a nest or in the womb before it arrives. Both parents stay with you.</p>
          <div className="space-y-1.5">
            {all.map((m) => (
              <MonRow
                key={m.uid}
                m={m}
                active={m.uid === a || m.uid === b}
                onClick={() => pick(m.uid)}
                right={m.level < SYNTH_MIN_LEVEL ? <span className="font-mono text-[10px] text-[#ff8a7a]">Lv{SYNTH_MIN_LEVEL}+</span> : m.uid === a ? <span className="font-pixel text-gold">A</span> : m.uid === b ? <span className="font-pixel text-gold">B</span> : null}
              />
            ))}
          </div>
        </div>
        <div className="panel-parchment min-w-0 flex-1 p-4">
          <div className="flex items-center justify-center gap-3">
            {ma ? <Portrait speciesId={ma.speciesId} size={76} /> : <div className="grid h-[76px] w-[76px] place-items-center rounded-md border-2 border-dashed border-frame/50 font-pixel opacity-50">A</div>}
            <span className="font-pixel text-2xl text-teal">+</span>
            {mb ? <Portrait speciesId={mb.speciesId} size={76} /> : <div className="grid h-[76px] w-[76px] place-items-center rounded-md border-2 border-dashed border-frame/50 font-pixel opacity-50">B</div>}
            <span className="font-pixel text-2xl text-teal">=</span>
            {preview ? <Portrait speciesId={preview.speciesId} size={92} silhouette={!known} className="anim-bob" /> : <div className="grid h-[92px] w-[92px] place-items-center rounded-md border-2 border-dashed border-frame/50 font-pixel text-2xl opacity-50">?</div>}
          </div>
          {preview ? (
            <div className="mt-3">
              <div className="text-center font-serif text-xl font-extrabold">
                {known ? SPECIES[preview.speciesId].name : "An unknown creature"} <span className="font-pixel text-ember">+{preview.plus}</span>
              </div>
              {known ? <div className="text-center text-[13px] opacity-70">{SPECIES[preview.speciesId].title} · <span style={{ color: ELEMENTS[SPECIES[preview.speciesId].element].color }}>{ELEMENTS[SPECIES[preview.speciesId].element].name}</span></div> : null}
              <SectionTitle>Inherited genes (before drift)</SectionTitle>
              <div className="grid grid-cols-6 gap-1 text-center">
                {(Object.keys(preview.genes) as GeneKey[]).map((k) => {
                  const p = preview.genes[k];
                  const expr = expressGene(p);
                  return (
                    <div key={k} className="rounded bg-black/5 py-1">
                      <div className="font-mono text-[10px] opacity-60">{GENE_LABEL[k]}</div>
                      <div className="font-pixel text-lg">{k === "size" ? `${sizeToFootprint(expr)}×${sizeToFootprint(expr)}` : geneGrade(expr)}</div>
                      <div className="font-mono text-[9px] opacity-50">{p.a}/{p.b}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[13px]">
                <b>Sex:</b> <span style={{ color: SEX_INFO[preview.sex].color }}>{SEX_INFO[preview.sex].glyph} {SEX_INFO[preview.sex].label}</span> · <b>Inherited skills:</b> {preview.inherited.length ? preview.inherited.join(", ").replace(/_/g, " ") : "none"} · <b>Mutation chance:</b> {Math.round(preview.mutationChance * 100)}%
              </div>
              <p className="mt-2 text-[12px] italic opacity-70">Both parents stay with you. The offspring starts at level 1, but its + makes every stat stronger, and it arrives when its development completes.</p>
              <button
                className="btn-game btn-teal mt-3 h-12 w-full"
                disabled={!ready}
                onClick={() => {
                  const out = act((g) => requestBreeding(g, a, b));
                  if (!out) return;
                  if ("reason" in out) {
                    toast(out.reason === "same_individual" ? "A monster cannot breed with itself." : out.reason === "biological_incompatibility" ? "These two are not biologically compatible right now." : "That pairing is not permitted.");
                    return;
                  }
                  const dev = out.development;
                  const days = Math.max(1, Math.ceil((dev.completeTick - gs.tick) / DAY_TICKS));
                  toast(dev.type === "egg" ? `An egg rests in the nest — ready in about ${days} day${days === 1 ? "" : "s"}.` : `New life stirs — ready in about ${days} day${days === 1 ? "" : "s"}.`);
                  setA("");
                  setB("");
                }}
              >
                <Sparkles className="h-4 w-4" /> Begin Breeding
              </button>
              {ma && mb && mating && !mating.ok ? (
                <div className="mt-1 text-center text-[12px] text-[#9a2a3a]">
                  {mating.reason === "same_individual"
                    ? "A monster cannot breed with itself."
                    : mating.reason === "biological_incompatibility"
                      ? "These two are not biologically compatible right now — maturity, fertility, cooldown or anatomy."
                      : "This pairing is not permitted."}
                </div>
              ) : !ready ? <div className="mt-1 text-center text-[12px] text-[#9a2a3a]">{all.length <= 2 ? "You must keep at least one other monster." : `Both must be level ${SYNTH_MIN_LEVEL} or higher.`}</div> : null}
            </div>
          ) : (
            <p className="mt-6 text-center text-sm opacity-60">Choose two monsters to see what the roots will make of them.</p>
          )}
        </div>
      </div>
      {broods.length ? (
        <div className="px-3 pb-3">
          <SectionTitle>Developing offspring</SectionTitle>
          <div className="space-y-2">
            {broods.map((d) => {
              const pct = Math.min(100, Math.max(0, ((gs.tick - d.startTick) / Math.max(1, d.completeTick - d.startTick)) * 100));
              const eta = Math.max(0, Math.ceil((d.completeTick - gs.tick) / DAY_TICKS));
              return (
                <div key={d.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span>
                      {SPECIES[d.speciesId].name}
                      {d.type === "egg" ? " · egg" : " · gestation"}
                      {d.nestId ? " · nested" : ""}
                    </span>
                    <span className="font-mono opacity-60">{d.state === "ready" ? "awaiting space" : eta === 0 ? "due any moment" : `ready in ~${eta}d`}</span>
                  </div>
                  <Bar value={pct} max={100} color="#3e6b5c" />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/* -------------------------------- Notices ----------------------------------- */

/** The settlement notices board: seeded postings from the local beast-tamer association. */
/** One line on what a development asks of the traveler. */
function devDetail(d: DevInstance): string {
  if (d.defId === "predators") {
    const left = Math.max(0, PREDATOR_KILLS - (d.progress ?? 0));
    const sp = SPECIES[d.speciesId ?? ""]?.name ?? "beasts";
    return left ? `${sp}s prowl the fields — cull ${left} more nearby.` : "Word of your culls is spreading.";
  }
  if (d.defId === "shortage") return "The granaries run low — settled contracts and goods brought here count as aid.";
  if (d.defId === "trade") return "The road is cut. Culling beasts along it, or moving goods, gets carts rolling again.";
  if (d.defId === "discovery") return "They wonder at blank places on the map. Chart the country nearby.";
  return "Full carts and full purses — a good season abroad.";
}

export function NoticesSheet({ gs, open, onClose, onChronicles, settlement }: { gs: GameState; open: boolean; onClose: () => void; onChronicles: () => void; settlement: Feature | null }) {
  const notices = useMemo(() => (settlement ? getFactions(gs.seed).settlementNotices(settlement) : []), [gs.seed, settlement]);
  const nation = settlement ? getFactions(gs.seed).nationAt(settlement.x, settlement.y) : null;
  // the generational past (Update G.1): this settlement's tradition and the
  // anniversary its archive rotates in, derived from the event records
  const culture = settlement ? cultureOf(gs, settlementId(settlement)) : undefined;
  const anniversary = settlement ? anniversaryEvent(gs, settlement.name, Math.floor(gs.tick / DAY_TICKS)) : null;
  const assoc = notices[0]?.assoc ?? null;
  const hereDevs = settlement ? devsAt(gs, settlementId(settlement)) : [];
  const knownDevs = settlement ? [] : devsKnownToPlayer(gs);
  const market = settlement ? marketLine(gs, settlement) : null;
  const history = settlement ? (gs.living?.history ?? []).filter((r) => r.key === settlementId(settlement)).slice(-3).reverse() : (gs.living?.history ?? []).slice(-3).reverse();
  const devWord = (defId: string): string => ({ shortage: "Shortage", predators: "Beasts", trade: "Road cut", discovery: "Charting", bloom: "Good season" })[defId] ?? defId;
  return (
    <Sheet open={open} onClose={onClose} title={settlement ? `${settlement.name} · Notices` : "Notices"} icon={<ScrollText className="h-5 w-5 text-gold" />}>
      <div className="space-y-2.5 p-3">
        {/* the settlement's own past: its tradition, and today's remembered deed */}
        {culture ? (
          <div className="panel-parchment p-3">
            <div className="font-pixel text-[13px] text-gold">{culture.tradition}</div>
            <div className="mt-0.5 font-serif text-[13px] leading-snug opacity-85">{culture.text}</div>
          </div>
        ) : null}
        {anniversary ? (
          <div className="rounded-md border border-gold/40 bg-gold/5 p-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wide text-parchment/50">remembered here · {Math.abs(anniversary.day)} days before you</div>
            <div className="font-serif text-[13px] leading-snug">{anniversary.text}</div>
          </div>
        ) : null}
        {/* the living world: what this town (or the known world) is living through */}
        {market ? <div className="font-serif text-[12px] italic opacity-70">“{market}”</div> : null}
        {hereDevs.length ? (
          <div className="space-y-1.5">
            {hereDevs.map((d) => (
              <div key={d.id} className="rounded-md border-2 border-ember/50 bg-ember/10 p-2.5">
                <div className="font-pixel text-[13px] text-ember">{devWord(d.defId)} · {d.name}</div>
                <div className="font-body text-[12px] opacity-80">{devDetail(d)}</div>
              </div>
            ))}
          </div>
        ) : null}
        {knownDevs.length ? (
          <div className="space-y-1.5">
            {knownDevs.map((d) => (
              <div key={d.id} className="rounded-md border border-frame/40 p-2.5">
                <div className="font-pixel text-[13px]">{devWord(d.defId)} · {d.name}</div>
                <div className="font-body text-[12px] opacity-70">{devDetail(d)}</div>
              </div>
            ))}
          </div>
        ) : null}
        {history.length ? (
          <div className="font-mono text-[11px] opacity-60">
            {history.map((r) => (
              <div key={r.id}>{devWord(r.defId)} at {r.name} — {r.outcome === "player" ? "settled by you" : r.outcome === "world" ? "the world mended it" : "passed with the season"}</div>
            ))}
          </div>
        ) : null}
        {notices.length ? (
          notices.map((n, i) => (
            <div key={i} className="panel-parchment p-3">
              <div className="font-serif text-sm leading-snug">{n.text}</div>
            </div>
          ))
        ) : (
          <p className="p-3 text-center text-sm opacity-60">The board holds only weather-worn staples. No association posts here.</p>
        )}
        {assoc && nation ? (
          <div className="text-center font-mono text-[11px] opacity-60">
            Posted by the {assoc.name} · chartered by the {nation.title}
          </div>
        ) : null}
        {gs.history ? (
          <button className="btn-game btn-night h-11 w-full text-sm" onClick={onChronicles}>
            <BookOpen className="h-4 w-4" /> Open the Chronicles
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ------------------------------- Chronicles --------------------------------- */

/**
 * The Chronicles (Update G.1): everything the player has actually read of the
 * world's past — coliseum records, expedition journals, research notes,
 * memorial stones — with rumor copies kept honestly separate from records.
 */
export function ChroniclesSheet({ gs, open, onClose }: { gs: GameState; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const { found, locked } = chronicleEntries(gs);
  return (
    <Sheet open={open} onClose={onClose} title="The Chronicles" icon={<BookOpen className="h-5 w-5 text-gold" />}>
      <div className="space-y-2.5 p-3">
        {found.length === 0 ? (
          <p className="p-3 text-center font-serif text-sm opacity-70">You have read nothing of this world's past yet. Monuments, journals, scholars and champions keep records — stand in front of them and read.</p>
        ) : (
          found.map((l) => (
            <div key={l.id} className="panel-parchment p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-serif text-sm font-extrabold">{l.title}</div>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]", l.reliability === "record" ? "bg-teal/15 text-teal" : "bg-gold/15 text-gold")}>
                  {l.reliability === "record" ? "record" : l.disputed ? "hearsay · disputed" : "hearsay"}
                </span>
              </div>
              <div className="mt-1 font-serif text-[13px] leading-snug opacity-85">{l.text}</div>
              <div className="mt-1.5 font-mono text-[10px] opacity-50">— {l.source}</div>
            </div>
          ))
        )}
        {locked > 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-frame/40 p-2.5 font-body text-[12px] opacity-60">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            {locked} record{locked === 1 ? "" : "s"} you have not found yet. The world keeps them; walk and read.
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* -------------------------------- Standing ---------------------------------- */

/** The player's standing in the world: reputation, met rivals, and known deeds. */
/** Head-and-shoulders crop of a rival's illustrated sprite. */
function RivalPortrait({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => onCleanSpriteReady(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const n = Number(id.slice(1));
    const im = Number.isInteger(n) && n >= 1 && n <= RIVAL_ART.length ? getCleanSprite(RIVAL_ART[n - 1]) : null;
    if (!im) return;
    // crown to chest: the top of the art, centered on the figure
    const sx = im.width * 0.22;
    const sw = im.width * 0.56;
    const sh = im.height * 0.42;
    ctx.drawImage(im, sx, 0, sw, sh, 0, 0, cv.width, cv.height);
  }, [id, tick]);
  return <canvas ref={ref} width={96} height={104} className="h-[52px] w-[48px] shrink-0 rounded-md border border-frame/40 bg-night-2/70" />;
}

export function StandingSheet({ gs, open, onClose }: { gs: GameState; open: boolean; onClose: () => void }) {
  const fac = getFactions(gs.seed);
  const knownNations = Object.keys(gs.knowledge.nationsSeen ?? {}).map((id) => fac.nationById(id)).filter((n) => n && repOf(gs, "player", "nations", n.id) !== null);
  const knownAssocs = Object.keys(gs.knowledge.assocSeen ?? {}).filter((id) => repOf(gs, "player", "assocs", id) !== null);
  const repRows = (entries: [string, number][], label: string) =>
    entries.length ? (
      <div>
        <SectionTitle>{label}</SectionTitle>
        <div className="space-y-1">
          {entries.map(([id, v]) => (
            <div key={id} className="flex items-center justify-between rounded-md border border-frame/40 bg-night-3/40 px-2.5 py-1.5">
              <span className="truncate text-[13px] font-bold">{id}</span>
              <span className="font-mono text-[11px]" style={{ color: v >= 25 ? "#7be08a" : v <= -25 ? "#ff8a7a" : "#e8c49a" }}>
                {repLabel(v)} · {v > 0 ? "+" : ""}{v}
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null;
  const rivals = Object.entries(gs.metTamers ?? {});
  const events = eventsKnownToPlayer(gs, 8);
  return (
    <Sheet open={open} onClose={onClose} title="Your Standing" icon={<User className="h-5 w-5" />}>
      <div className="space-y-3 p-3">
        {repRows(
          knownNations.map((n) => [n!.title, repOf(gs, "player", "nations", n!.id) ?? 0] as [string, number]),
          "Nations",
        )}
        {repRows(
          knownAssocs.map((id) => {
            const a = fac.assocs.find((x) => x.id === id);
            return [a?.name ?? id, repOf(gs, "player", "assocs", id) ?? 0] as [string, number];
          }),
          "Associations",
        )}
        {repRows(
          Object.entries(gs.rep?.settlements?.player ?? {}).map(([key, e]) => {
            const [, sx, sy] = key.split(":").map(Number);
            const name = getWorld(gs.seed).tile(sx, sy).feature?.name ?? key;
            return [name, e.v] as [string, number];
          }),
          "Settlements",
        )}
        {rivals.length ? (
          <div>
            <SectionTitle>Rivals You Have Met</SectionTitle>
            <div className="space-y-1">
              {rivals.map(([id, met]) => {
                const t = gs.tamers?.[id];
                return (
                  <div key={id} className="flex items-center gap-2.5 rounded-md border border-frame/40 bg-night-3/40 px-2 py-1.5">
                    <RivalPortrait id={id} />
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-bold" style={{ color: t?.scarf }}>{met.name}</span>
                      <span className="font-mono text-[10px] text-parchment/60">of {t?.homeName ?? "?"}</span>
                    </div>
                    {t ? (
                      <div className="mt-0.5 font-mono text-[10px] text-parchment/55">
                        Lv{Math.round(t.team.reduce((a, m) => a + m.level, 0) / Math.max(1, t.team.length))} team · {t.career.wins}W / {t.career.losses}L · {t.career.alphaKills} great beasts felled
                      </div>
                    ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div>
          <SectionTitle>Word on the Road</SectionTitle>
          {events.length ? (
            <div className="space-y-1.5">
              {events.map((e) => (
                <div key={e.id} className="rounded-md border border-frame/40 bg-night-3/40 px-2.5 py-1.5 font-serif text-[12px] font-bold">
                  Day {Math.floor(e.tick / DAY_TICKS) + 1}:{" "}
                  {e.cat === "duel"
                    ? `${e.subjectName} defeated ${e.otherName} in a duel.`
                    : e.won
                      ? `${e.subjectName} brought down the great ${e.alphaSpeciesId ? SPECIES[e.alphaSpeciesId].name.toLowerCase() : "beast"}.`
                      : `${e.subjectName} was beaten by the great ${e.alphaSpeciesId ? SPECIES[e.alphaSpeciesId].name.toLowerCase() : "beast"}.`}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-frame/40 bg-night-3/40 px-2.5 py-2 text-[12px] opacity-60">No notable deeds yet — yours or anyone's.</div>
          )}
        </div>
        {!knownNations.length && !knownAssocs.length && !Object.keys(gs.rep?.settlements?.player ?? {}).length && !rivals.length ? (
          <div className="text-center font-mono text-[11px] opacity-50">Win a great beast's fall or a duel in the sight of a settlement, and its people will remember.</div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* -------------------------------- Contracts ---------------------------------- */

const CAT_LABEL: Record<ContractCategory, string> = {
  hunting: "Hunting",
  gathering: "Gathering",
  delivery: "Delivery",
  exploration: "Exploration",
  monster_handling: "Monster Handling",
  investigation: "Investigation",
  protection: "Protection",
  ecological: "Ecology",
};

const CAT_COLOR: Partial<Record<ContractCategory, string>> = {
  hunting: "#c9563a",
  gathering: "#5fae4e",
  delivery: "#c9a227",
  exploration: "#3f9fd8",
  monster_handling: "#9a6fd0",
};

const NEED_LABEL: Record<string, string> = { food: "Food", materials: "Materials", security: "Safety", trade: "Trade", population: "Hands", prosperity: "Wealth" };

/** A settlement's needs as a compact strip of labeled bars. */
function NeedsStrip({ gs, settlementKey }: { gs: GameState; settlementKey: string }) {
  const f = getWorld(gs.seed).tile(Number(settlementKey.split(":")[1]), Number(settlementKey.split(":")[2])).feature;
  if (!f) return null;
  const n = needsOf(gs, f);
  return (
    <div>
      <SectionTitle>{f.name} needs</SectionTitle>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
        {NEED_KEYS.map((k) => (
          <div key={k}>
            <div className="flex justify-between font-mono text-[10px] text-parchment/60">
              <span>{NEED_LABEL[k]}</span>
              <span>{Math.round(n[k])}</span>
            </div>
            <Bar value={n[k]} max={100} color={n[k] < 35 ? "linear-gradient(180deg,#ff8a7a,#c9563a)" : n[k] < 60 ? "linear-gradient(180deg,#f2c14e,#c98a2b)" : "linear-gradient(180deg,#7be08a,#3e6b5c)"} className="mt-0.5 h-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractCard({ gs, c, mode }: { gs: GameState; c: Contract; mode: "offer" | "active" | "history" }) {
  const today = Math.floor(gs.tick / DAY_TICKS);
  const daysLeft = c.expiresDay - today;
  // delivery work settles by handing goods over — the bag gates the claim
  const done = claimReady(gs, c);
  const catColor = CAT_COLOR[c.category] ?? "#c9b99a";
  return (
    <div className="panel-parchment p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-serif text-[15px] font-extrabold leading-snug">{c.title}</div>
          <div className="mt-0.5 font-mono text-[10.5px] opacity-60">
            {c.issuer} · {c.issuerRole} · {c.settlementName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="rounded px-1.5 py-0.5 font-pixel text-[10px]" style={{ color: catColor, background: "rgba(0,0,0,.08)" }}>
            {CAT_LABEL[c.category]}
          </span>
          <div className="mt-1 font-mono text-[10px] opacity-60" title="difficulty">{"★".repeat(c.difficulty)}</div>
        </div>
      </div>
      <p className="mt-1.5 font-serif text-[12.5px] leading-snug opacity-80">{c.blurb}</p>
      <div className="mt-2 space-y-1">
        {c.objectives.map((o, i) => {
          // delivery work is settled by handing goods over at the board
          const have = o.kind === "deliver" && o.itemId ? gs.bag[o.itemId] ?? 0 : 0;
          const shown = o.kind === "deliver" ? Math.min(o.progress + have, o.count) : o.progress;
          return (
            <div key={i} className="flex items-center justify-between rounded border border-frame/30 bg-black/5 px-2 py-1 font-mono text-[11px]">
              <span className="truncate">{o.label}</span>
              <span className={cn("ml-2 shrink-0", shown >= o.count ? "text-[#3e6b5c]" : "opacity-70")}>
                {shown}/{o.count}
              </span>
            </div>
          );
        })}
      </div>
      {mode !== "history" ? (
        <div className="mt-2 flex items-center justify-between font-mono text-[11px]">
          <span className="text-[#8a6d2f]">
            <Coins className="mr-1 inline h-3 w-3" />
            {c.reward.gold}g{c.reward.items.length ? ` · ${c.reward.items.map((r) => `${r.n}× ${ITEMS[r.id].name}`).join(", ")}` : ""} · +{c.reward.rep} standing
          </span>
          <span className={daysLeft <= 1 ? "text-[#ff8a7a]" : "opacity-60"}>{daysLeft <= 0 ? "last day" : `${daysLeft}d left`}</span>
        </div>
      ) : (
        <div className="mt-2 font-mono text-[11px] opacity-60">
          {c.status === "completed" ? "Settled" : c.status === "expired" ? "Lapsed" : "Walked away"} · day {(c.finishedDay ?? 0) + 1}
        </div>
      )}
      {mode === "offer" ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button className="btn-game btn-ember h-10 text-[13px]" onClick={() => { const r = act((g) => acceptContract(g, c.id)); if (r) toast(r); }}>
            Accept
          </button>
          <button className="btn-game btn-night h-10 text-[13px]" onClick={() => act((g) => declineContract(g, c.id))}>
            Decline
          </button>
        </div>
      ) : null}
      {mode === "active" ? <ActiveActions gs={gs} c={c} done={done} /> : null}
    </div>
  );
}

function ActiveActions({ gs, c, done }: { gs: GameState; c: Contract; done: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const claimLabel = c.category === "delivery" ? "Hand over goods" : "Settle reward";
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      {confirm ? (
        <>
          <button className="btn-game h-10 bg-crimson text-[13px] text-parchment" onClick={() => { const r = act((g) => abandonContract(g, c.id)); if (r) toast(r); }}>
            Confirm — walk away
          </button>
          <button className="btn-game btn-night h-10 text-[13px]" onClick={() => setConfirm(false)}>Stay</button>
        </>
      ) : (
        <>
          <button className="btn-game btn-ember h-10 text-[13px]" disabled={!done} onClick={() => { const r = act((g) => claimContract(g, c.id)); if (r) toast(r); }}>
            {claimLabel}
          </button>
          <button className="btn-game btn-night h-10 text-[13px]" onClick={() => setConfirm(true)}>Abandon</button>
        </>
      )}
    </div>
  );
}

/** The settlement contract board: posted work, carried work, and how it went. */
export function ContractsSheet({ gs, open, onClose, settlement }: { gs: GameState; open: boolean; onClose: () => void; settlement: Feature | null }) {
  const [tab, setTab] = useState<"available" | "active" | "history">("available");
  const active = gs.contracts?.active ?? [];
  const history = (gs.contracts?.history ?? []).slice().reverse();
  const offers = settlement ? offersAt(gs, settlement) : [];
  const key = settlement ? settlementId(settlement) : "";
  return (
    <Sheet open={open} onClose={onClose} title={settlement ? `${settlement.name} · Contracts` : "Contracts"} icon={<ClipboardList className="h-5 w-5 text-gold" />}>
      <div className="space-y-2.5 p-3">
        {settlement ? <NeedsStrip gs={gs} settlementKey={key} /> : null}
        <div className="flex gap-2">
          {(["available", "active", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("h-9 flex-1 rounded-md border-2 font-pixel text-[12px] capitalize", tab === t ? "border-ember bg-ember/15" : "border-frame/40")}
            >
              {t}
              {t === "active" && active.length ? <span className="ml-1 rounded bg-ember/30 px-1 font-mono text-[10px] text-gold">{active.length}</span> : null}
            </button>
          ))}
        </div>
        {tab === "available" ? (
          offers.length ? (
            <div className="space-y-2.5">{offers.map((c) => <ContractCard key={c.id} gs={gs} c={c} mode="offer" />)}</div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">The board is bare today. Folk who distrust you post no work — and some days, there is simply none to post.</p>
          )
        ) : null}
        {tab === "active" ? (
          active.length ? (
            <div className="space-y-2.5">{active.map((c) => <ContractCard key={c.id} gs={gs} c={c} mode="active" />)}</div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">No work in hand. The board above always needs doing.</p>
          )
        ) : null}
        {tab === "history" ? (
          history.length ? (
            <div className="space-y-2">{history.map((c) => <ContractCard key={c.id} gs={gs} c={c} mode="history" />)}</div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">No contracts settled yet.</p>
          )
        ) : null}
      </div>
    </Sheet>
  );
}
