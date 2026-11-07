import { useMemo, useState } from "react";
import { BookOpen, ScrollText } from "lucide-react";
import { BIOMES, DAY_TICKS, ITEMS, RARITY_COLOR, RECIPES, SPECIES, SPECIES_LIST, STAT_LABEL } from "@/game/data";
import { figureOf } from "@/game/history";
import { legendsById, hasReached } from "@/game/legends";
import { getStore } from "@/game/store";
import type { BiomeId, LegendaryStage, StatKey } from "@/game/types";
import { cn } from "@/lib/utils";
import { SkillChip } from "./MonsterDetail";
import { ElementBadge, Portrait, SectionTitle, Sheet, Tag } from "./ui";

export function BestiarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gs = getStore().gs;
  const [sel, setSel] = useState<string>(SPECIES_LIST[0].id);
  const known = (id: string): boolean => !gs || !!gs.seen[id];
  const tamed = (id: string): boolean => !!gs?.tamed[id];
  // the five legends (Update G) stay out of the book until their rumor takes root
  const revealed = (id: string): boolean => !legendsById().has(id) || hasReached(gs?.legends?.[id], "rumored");
  const sp = SPECIES[sel];
  const isKnown = known(sel);
  const legendDef = legendsById().get(sel);
  const lp = gs?.legends?.[sel];
  const count = useMemo(() => (gs ? SPECIES_LIST.filter((s) => gs.seen[s.id] || revealed(s.id)).length : SPECIES_LIST.length), [gs]);
  const recipes = RECIPES.filter(([, , r]) => r === sel);
  // famous pedigree (Update G.1): a historical bloodline of this species, if one exists
  const pedigree = useMemo(() => {
    if (!gs?.lineages || !gs?.history) return null;
    const lid = Object.keys(gs.lineages).find((k) => k.startsWith("L:h") && gs.lineages[k].speciesId === sel);
    if (!lid) return null;
    const fig = figureOf(gs, lid.slice(2)); // "L:h:g7" names its founder "h:g7"
    return fig ? { name: fig.name, foundedDay: Math.abs(Math.round(gs.lineages[lid].foundedTick / DAY_TICKS)), line: gs.lineages[lid] } : null;
  }, [gs, sel]);

  return (
    <Sheet open={open} onClose={onClose} wide title={`Bestiary · ${count}/${SPECIES_LIST.length}`} icon={<BookOpen className="h-5 w-5" />}>
      <div className="flex flex-col gap-3 p-3 md:flex-row">
        <div className="grid grid-cols-5 gap-1.5 md:w-[300px] md:shrink-0 md:grid-cols-4 md:content-start">
          {SPECIES_LIST.filter((s) => revealed(s.id)).map((s) => (
            <button
              key={s.id}
              onClick={() => setSel(s.id)}
              className={cn("relative rounded-md p-0.5 transition-transform active:scale-95", sel === s.id && "ring-2 ring-gold")}
              aria-label={known(s.id) ? s.name : "Unknown"}
            >
              <Portrait speciesId={s.id} size={64} className="h-auto w-full" silhouette={!known(s.id)} />
              {tamed(s.id) ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-teal ring-1 ring-night" /> : null}
            </button>
          ))}
        </div>
        <div className="panel-parchment min-w-0 flex-1 p-4">
          {isKnown ? (
            <>
              <div className="flex gap-3">
                <Portrait speciesId={sel} size={110} />
                <div className="min-w-0">
                  <div className="font-serif text-2xl font-extrabold leading-tight">{sp.name}</div>
                  <div className="text-sm opacity-75">{sp.title}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <ElementBadge element={sp.element} />
                    <Tag color="#6b5a7a">{sp.family}</Tag>
                    <Tag color={RARITY_COLOR[sp.rarity]}>{sp.rarity}</Tag>
                  </div>
                  <p className="mt-2 text-[14px] leading-snug">{sp.desc}</p>
                </div>
              </div>
              <p className="mt-3 border-l-2 border-ember/60 pl-3 font-serif text-[15px] italic leading-snug opacity-85">“{sp.lore}”</p>
              {pedigree ? (
                <div className="mt-2.5 flex items-start gap-2 rounded-md border border-gold/40 bg-gold/5 p-2.5 text-[13px]">
                  <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                  <span className="leading-snug">
                    <b>Famous line:</b> a bloodline of this species traces back to {pedigree.name}'s beasts, founded {pedigree.foundedDay} days before you — {pedigree.line.historical} registered descendants since.
                  </span>
                </div>
              ) : null}
              <SectionTitle>Base Stats</SectionTitle>
              <div className="grid grid-cols-5 gap-1 text-center">
                {(Object.keys(sp.base) as StatKey[]).map((k) => (
                  <div key={k} className="rounded bg-black/5 py-1">
                    <div className="font-mono text-[11px] opacity-70">{STAT_LABEL[k]}</div>
                    <div className="font-pixel text-lg">{sp.base[k]}</div>
                  </div>
                ))}
              </div>
              <SectionTitle>Ecology</SectionTitle>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><b>Habitat:</b> {Object.entries(sp.biomes).filter(([, w]) => (w ?? 0) > 0).map(([b]) => BIOMES[b as BiomeId].name).join(", ") || "Unknown"}</div>
                <div className="capitalize"><b>Diet:</b> {sp.diet}</div>
                <div className="capitalize"><b>Active:</b> {sp.activity}</div>
                <div><b>Likes:</b> {ITEMS[sp.likes].name}</div>
                <div className="capitalize"><b>Fears:</b> {sp.fears}</div>
                <div><b>Size:</b> {["", "Small", "Medium", "Large", "Titanic"][sp.size] ?? "Small"}</div>
              </div>
              {recipes.length ? (
                <>
                  <SectionTitle>Synthesis</SectionTitle>
                  <div className="space-y-1 text-[13px]">
                    {recipes.map(([a, b]) => (
                      <div key={a + b} className="flex items-center gap-2">
                        <Portrait speciesId={a} size={28} silhouette={!known(a)} />+<Portrait speciesId={b} size={28} silhouette={!known(b)} />
                        <span className="opacity-75">{known(a) ? SPECIES[a].name : "???"} + {known(b) ? SPECIES[b].name : "???"}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              <SectionTitle>Learnset</SectionTitle>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {sp.learnset.map(([lv, s]) => (
                  <div key={s} className="relative">
                    <span className="absolute -left-1 -top-1 z-[1] rounded bg-ink px-1 font-mono text-[10px] text-parchment">Lv{lv}</span>
                    <SkillChip id={s} />
                  </div>
                ))}
              </div>
            </>
          ) : legendDef && hasReached(lp, "rumored") ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 py-2 text-center">
              <Portrait speciesId={sel} size={120} silhouette={!isKnown} />
              <div className="font-serif text-xl font-bold">{legendDef.name}, {legendDef.epithet}</div>
              <Tag color="#b8860b">Legendary</Tag>
              <p className="max-w-sm border-l-2 border-ember/60 pl-3 text-left font-serif text-[14px] italic leading-snug opacity-85">“{legendDef.lore.text}”</p>
              <div className="mt-1 w-full max-w-xs space-y-1 text-left">
                {([
                  ["rumored", "A rumor takes root"],
                  ["evidence", "Evidence in the field"],
                  ["located", "Territory located"],
                  ["available", "Met in the wild"],
                  ["defeated", "Defeated or tamed"],
                ] as [LegendaryStage, string][]).map(([stg, label]) => {
                  const lit = hasReached(lp, stg);
                  return (
                    <div key={stg} className={cn("flex items-center gap-2 rounded px-2 py-1 text-[13px]", lit ? "bg-gold/10 font-bold" : "opacity-45")}>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", lit ? "bg-gold" : "bg-black/25", stg === "defeated" && lit && "bg-teal")} />
                      {label}
                    </div>
                  );
                })}
              </div>
              {tamed(sel) ? <div className="text-[13px] font-bold text-teal">Walks at your side.</div> : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center">
              <Portrait speciesId={sel} size={140} silhouette />
              <div className="font-serif text-xl font-bold">Unknown creature</div>
              <p className="max-w-xs text-sm opacity-70">Encounter it in the wild to fill in this page.</p>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
