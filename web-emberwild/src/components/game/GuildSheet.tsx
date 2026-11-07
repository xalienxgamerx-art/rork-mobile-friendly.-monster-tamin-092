import { useState } from "react";
import { Compass, MapPin, Skull, Swords, Package, Users, Coins, Flag, ScrollText, Milestone, BookOpenCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { DAY_TICKS, ITEMS, SPECIES } from "@/game/data";
import {
  SUPPLY_ITEMS,
  abandonExpedition,
  atIssuingGuild,
  claimExpedition,
  declineExpedition,
  expeditionDone,
  guildOffers,
  isMember,
  joinGuild,
  partyAssessment,
  registerExpedition,
  standingOf,
  useExpeditionSupply,
} from "@/game/expeditions";
import { GUILD_ORG, guildAt, guildByKey } from "@/game/guild";
import { statOf } from "@/game/monster";
import { repLabel } from "@/game/reputation";
import { useItemOn } from "@/game/sim";
import { act } from "@/game/store";
import type { ExpeditionInstance, ExpeditionObjective, ExpeditionOffer, GameState, ItemId } from "@/game/types";
import type { Feature } from "@/game/world";
import { cn } from "@/lib/utils";
import { Bar, Portrait, SectionTitle, Sheet, hpColor } from "./ui";

const CATEGORY_LABEL: Record<string, string> = {
  exploration: "Exploration",
  recovery: "Recovery",
  investigation: "Investigation",
  tracking: "Tracking",
  artifact: "Artifact",
  legendary: "Legendary",
  escort: "Escort",
  survey: "Survey",
};

const OUTCOME_STYLE: Record<string, string> = {
  completed: "text-emerald-300",
  failed: "text-red-300",
  abandoned: "text-amber-200/90",
};

function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function dayOf(tick: number): number {
  return Math.floor(tick / DAY_TICKS);
}

/** One objective row with a live counter. */
function ObjectiveRow({ o }: { o: ExpeditionObjective }) {
  const done = o.progress >= o.count;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-sm border", done ? "border-emerald-400/70 bg-emerald-400/20 text-emerald-300" : "border-frame/60")}>
        {done ? <span className="text-[9px]">✓</span> : null}
      </span>
      <span className={cn("flex-1 text-[12.5px] leading-snug", done && "text-emerald-200/80 line-through decoration-emerald-400/40")}>{o.label}</span>
      <span className="shrink-0 font-mono text-[11px] opacity-70">
        {o.progress}/{o.count}
      </span>
    </div>
  );
}

/** Reward summary chips. */
function RewardLine({ o }: { o: ExpeditionOffer }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className="inline-flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-amber-200">
        <Coins className="h-3 w-3" /> {o.reward.gold}
      </span>
      {o.reward.items.map((it) => (
        <span key={it.id} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-parchment/80">
          {it.n}× {ITEMS[it.id].name}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 rounded bg-gold/10 px-1.5 py-0.5 font-mono text-gold">+{o.reward.standing} standing</span>
    </div>
  );
}

function DifficultyPips({ d }: { d: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Difficulty ${d}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Skull key={i} className={cn("h-3 w-3", i < d ? "text-ember" : "text-frame/50")} />
      ))}
    </span>
  );
}

/* --------------------------- Preparation & departure --------------------------- */

function PreparePanel({ gs, offer, onClose }: { gs: GameState; offer: ExpeditionOffer; onClose: () => void }) {
  const [party, setParty] = useState<string[]>(gs.party.filter((m) => m.hp > 0).slice(0, offer.minParty).map((m) => m.uid));
  const [supplies, setSupplies] = useState<{ id: ItemId; n: number }[]>(() =>
    offer.recommended.filter((id) => (gs.bag[id] ?? 0) > 0).map((id) => ({ id, n: 1 })),
  );
  const dist = cheb(gs.player.x, gs.player.y, offer.dest.x, offer.dest.y);
  const avgLevel = party.length ? Math.round(party.reduce((a, uid) => a + (gs.party.find((m) => m.uid === uid)?.level ?? 0), 0) / party.length) : 0;
  const suggestedLevel = 2 + offer.difficulty * 3;
  const partyShort = party.length < offer.minParty;
  const missing = supplies.filter((s) => (gs.bag[s.id] ?? 0) < s.n);

  const bump = (id: ItemId, delta: number) => {
    setSupplies((prev) => {
      const have = gs.bag[id] ?? 0;
      const cur = prev.find((s) => s.id === id);
      const next = (cur?.n ?? 0) + delta;
      if (next <= 0) return prev.filter((s) => s.id !== id);
      if (next > have) return prev;
      const exists = prev.some((s) => s.id === id);
      return exists ? prev.map((s) => (s.id === id ? { ...s, n: next } : s)) : [...prev, { id, n: next }];
    });
  };

  const depart = () => {
    const r = act((g) => registerExpedition(g, offer.id, party, supplies));
    if (!r) return;
    if (r.ok) {
      toast(r.msg);
      onClose();
    } else {
      toast(r.msg);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-frame/50 bg-black/20 p-2.5">
      <SectionTitle className="text-[13px]">
        <Users className="h-3.5 w-3.5 text-gold" /> Field party
      </SectionTitle>
      <div className="flex flex-wrap gap-2">
        {gs.party.map((m) => {
          const picked = party.includes(m.uid);
          return (
            <button
              key={m.uid}
              disabled={m.hp <= 0}
              onClick={() => setParty((p) => (picked ? p.filter((u) => u !== m.uid) : p.length >= 3 ? p : [...p, m.uid]))}
              className={cn(
                "flex w-[104px] flex-col items-center gap-1 rounded-md border-2 p-1.5 text-center transition-colors disabled:opacity-35",
                picked ? "border-ember bg-ember/15" : "border-frame/40 hover:border-frame",
              )}
            >
              <Portrait speciesId={m.speciesId} size={40} />
              <span className="w-full truncate text-[11px]">{m.nickname ?? SPECIES[m.speciesId].name}</span>
              <span className="font-mono text-[10px] opacity-70">
                Lv {m.level} · {m.hp}/{statOf(m, "hp")}
              </span>
            </button>
          );
        })}
        {!gs.party.length ? <p className="text-[12px] opacity-60">No monsters travel with you.</p> : null}
      </div>

      <SectionTitle className="text-[13px]">
        <Package className="h-3.5 w-3.5 text-gold" /> Supplies (leave the bag at departure)
      </SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {SUPPLY_ITEMS.filter((id) => (gs.bag[id] ?? 0) > 0).map((id) => {
          const n = supplies.find((s) => s.id === id)?.n ?? 0;
          return (
            <span key={id} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11.5px]", n ? "border-ember/60 bg-ember/10" : "border-frame/40")}>
              <button className="font-mono opacity-80" onClick={() => bump(id, -1)}>
                −
              </button>
              <span>
                {ITEMS[id].name} <span className="font-mono opacity-70">{n > 0 ? `${n}×` : ""} ({gs.bag[id]})</span>
              </span>
              <button className="font-mono opacity-80" onClick={() => bump(id, 1)}>
                +
              </button>
            </span>
          );
        })}
        {!SUPPLY_ITEMS.some((id) => (gs.bag[id] ?? 0) > 0) ? <p className="text-[12px] opacity-60">Nothing in the bag the Guild counts as supply.</p> : null}
      </div>

      <div className="space-y-1 rounded-md border border-frame/40 bg-white/[0.03] p-2 text-[12px] leading-snug">
        <p className="font-pixel text-[11px] text-gold">The clerk's assessment</p>
        <p className={cn("flex items-center gap-1.5", partyShort ? "text-red-300" : "text-emerald-200/90")}>
          <Users className="h-3 w-3" /> {party.length} of at least {offer.minParty} fielded · avg level {avgLevel} (suggested ~{suggestedLevel})
        </p>
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3" /> {offer.destName}, {offer.region} — about {dist} leagues out
        </p>
        {partyAssessment(gs, offer, party).map((line, i) => (
          <p key={i} className={cn("flex items-start gap-1.5 pl-4", line.tone === "good" ? "text-emerald-200/90" : line.tone === "warn" ? "text-amber-200/90" : "opacity-70")}>
            <Milestone className="mt-0.5 h-3 w-3 shrink-0" /> {line.text}
          </p>
        ))}
        {offer.recommended.length ? (
          <p className="flex items-center gap-1.5">
            <Package className="h-3 w-3" /> Recommended: {offer.recommended.map((id) => ITEMS[id].name).join(", ")}
          </p>
        ) : null}
        {missing.length ? <p className="flex items-center gap-1.5 text-amber-200/90"><TriangleAlert className="h-3 w-3" /> {missing.length} supply line exceeds what the bag holds — they will be refused.</p> : null}
      </div>

      <button
        className="btn-game btn-ember h-10 w-full text-sm"
        disabled={partyShort || missing.length > 0}
        onClick={depart}
      >
        <Flag className="h-4 w-4" /> Depart — register the expedition
      </button>
    </div>
  );
}

/* --------------------------------- Offer card ---------------------------------- */

function OfferCard({ gs, offer, expanded, onToggle }: { gs: GameState; offer: ExpeditionOffer; expanded: boolean; onToggle: () => void }) {
  const standing = standingOf(gs, offer.guildKey);
  const dist = cheb(gs.player.x, gs.player.y, offer.dest.x, offer.dest.y);
  const today = dayOf(gs.tick);
  return (
    <div className="rounded-lg border-2 border-frame/50 bg-night-2/60 p-2.5">
      <button className="w-full text-left" onClick={onToggle}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-pixel text-[14px] text-gold">{offer.title}</p>
            <p className="mt-0.5 text-[11.5px] opacity-60">
              {CATEGORY_LABEL[offer.category] ?? offer.category} · {offer.guildName}
            </p>
          </div>
          <DifficultyPips d={offer.difficulty} />
        </div>
      </button>
      <p className="mt-1.5 text-[12.5px] italic leading-snug opacity-80">{offer.blurb}</p>
      <div className="mt-2 space-y-1">
        {offer.objectives.map((o) => (
          <ObjectiveRow key={o.label} o={o} />
        ))}
      </div>
      <div className="mt-2">
        <RewardLine o={offer} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] opacity-70">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {offer.destName}, {offer.region} · ~{dist} leagues
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" /> party ≥ {offer.minParty}
        </span>
        {offer.minStanding > 0 ? (
          <span className={cn("inline-flex items-center gap-1", standing < offer.minStanding && "text-red-300")}>
            <Milestone className="h-3 w-3" /> standing ≥ {offer.minStanding} (yours: {standing})
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <ScrollText className="h-3 w-3" /> posted day {offer.postedDay + 1}, lapses day {offer.expiresDay + 1}
        </span>
      </div>
      {offer.reward.clue ? (
        <p className="mt-2 flex items-start gap-1.5 rounded border border-gold/30 bg-gold/5 p-1.5 text-[12px] italic text-gold/90">
          <BookOpenCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {offer.reward.clue}
        </p>
      ) : null}
      {expanded ? (
        <div className="mt-2.5">
          <PreparePanel gs={gs} offer={offer} onClose={onToggle} />
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button className="btn-game btn-ember h-9 flex-1 text-[12px]" onClick={onToggle}>
            Prepare &amp; depart
          </button>
          <button
            className="btn-game h-9 text-[12px]"
            onClick={() => {
              act((g) => declineExpedition(g, offer.id));
              toast("The posting is struck from your copy of the board.");
            }}
          >
            Decline
          </button>
        </div>
      )}
      {today > offer.expiresDay ? <p className="mt-1.5 text-[11.5px] text-red-300">This posting has lapsed — the board refreshes at dawn.</p> : null}
    </div>
  );
}

/* -------------------------------- Active card ---------------------------------- */

function ActiveCard({ gs, inst }: { gs: GameState; inst: ExpeditionInstance }) {
  const [pickingSupply, setPickingSupply] = useState<ItemId | null>(null);
  const done = expeditionDone(inst);
  const atGuild = atIssuingGuild(gs, inst);
  const daysLeft = inst.deadlineDay - dayOf(gs.tick);
  const chapter = guildByKey(gs.seed, inst.offer.guildKey);
  return (
    <div className="rounded-lg border-2 border-frame/50 bg-night-2/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-pixel text-[14px] text-gold">{inst.offer.title}</p>
          <p className="mt-0.5 text-[11.5px] opacity-60">
            {CATEGORY_LABEL[inst.offer.category] ?? inst.offer.category} · {inst.offer.guildName}
          </p>
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-pixel text-[11px]", daysLeft <= 1 ? "bg-red-500/20 text-red-300" : "bg-white/5 text-parchment/80")}>
          {daysLeft <= 0 ? "due today" : `${daysLeft}d left`}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {inst.offer.objectives.map((o) => {
          const objDone = o.progress >= o.count;
          return (
            <div key={o.label}>
              <ObjectiveRow o={o} />
              {!objDone && o.kind === "reach" && o.target ? (
                <p className="pl-6 text-[11px] opacity-50">
                  ~{cheb(gs.player.x, gs.player.y, o.target.x, o.target.y)} leagues away
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {inst.party.map((uid) => {
          const m = gs.party.find((x) => x.uid === uid);
          if (!m) return null;
          return (
            <span key={uid} className="inline-flex items-center gap-1 rounded border border-frame/40 px-1 py-0.5">
              <Portrait speciesId={m.speciesId} size={18} framed={false} />
              <span className="max-w-[72px] truncate text-[11px]">{m.nickname ?? SPECIES[m.speciesId].name}</span>
              <span className="w-10">
                <Bar value={m.hp} max={statOf(m, "hp")} color={hpColor(m.hp / statOf(m, "hp"))} className="h-1.5" />
              </span>
            </span>
          );
        })}
      </div>

      {inst.supplies.length ? (
        <div className="mt-2">
          <p className="font-pixel text-[11px] text-gold">Expedition locker</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {inst.supplies.map((s) => (
              <button
                key={s.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded border border-frame/40 px-1.5 py-0.5 text-[11.5px] hover:border-ember/60",
                  pickingSupply === s.id && "border-ember bg-ember/15",
                )}
                onClick={() => setPickingSupply((cur) => (cur === s.id ? null : s.id))}
              >
                <Package className="h-3 w-3" /> {ITEMS[s.id].name} ×{s.n}
              </button>
            ))}
          </div>
          {pickingSupply ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded border border-frame/40 bg-black/20 p-1.5">
              <span className="text-[11.5px] opacity-70">Use {ITEMS[pickingSupply].name} on:</span>
              {gs.party
                .filter((m) => m.hp > 0)
                .map((m) => (
                  <button
                    key={m.uid}
                    className="btn-game h-7 px-2 text-[11px]"
                    onClick={() => {
                      // guild locker spending, not React hooks — the names merely start with "use"
                      // eslint-disable-next-line react-hooks/rules-of-hooks
                      const msg = act((g) => useExpeditionSupply(g, inst.offer.id, pickingSupply, (gg, item) => useItemOn(gg, m, item)));
                      if (msg) toast(msg);
                      setPickingSupply(null);
                    }}
                  >
                    {m.nickname ?? SPECIES[m.speciesId].name}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex gap-2">
        <button
          className="btn-game btn-ember h-9 flex-1 text-[12px]"
          disabled={!done || !atGuild}
          onClick={() => {
            const msg = act((g) => claimExpedition(g, inst.offer.id));
            if (msg) toast(msg);
          }}
        >
          {done ? (atGuild ? <>Settle the record at {chapter?.name ?? "the chapter"}</> : <>Return to {chapter?.name ?? "the chapter"} to settle</>) : <>Work in progress</>}
        </button>
        <button
          className="btn-game h-9 text-[12px]"
          onClick={() => {
            const msg = act((g) => abandonExpedition(g, inst.offer.id));
            if (msg) toast(msg);
          }}
        >
          Abandon
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- The sheet ----------------------------------- */

export function GuildSheet({ gs, open, onClose, settlement }: { gs: GameState; open: boolean; onClose: () => void; settlement: Feature | null }) {
  const [tab, setTab] = useState<"guild" | "board" | "active" | "history">("board");
  const [openOffer, setOpenOffer] = useState<string | null>(null);
  const chapter = settlement ? guildAt(gs.seed, settlement) : null;
  const member = isMember(gs);
  const standing = chapter ? standingOf(gs, chapter.id) : 0;
  const offers = chapter && open ? guildOffers(gs, settlement) : [];
  const active = gs.expeditions?.active ?? [];
  const history = (gs.expeditions?.history ?? []).slice().reverse();

  return (
    <Sheet open={open} onClose={onClose} title={chapter ? `${chapter.name} · ${GUILD_ORG}` : "The Expeditioner's Guild"} icon={<Compass className="h-5 w-5 text-gold" />} wide>
      <div className="space-y-2.5 p-3">
        <div className="flex gap-2">
          {(["guild", "board", "active", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("h-9 flex-1 rounded-md border-2 font-pixel text-[12px] capitalize", tab === t ? "border-ember bg-ember/15" : "border-frame/40")}
            >
              {t === "guild" ? "chapter" : t}
              {t === "active" && active.length ? <span className="ml-1 rounded bg-ember/30 px-1 font-mono text-[10px] text-gold">{active.length}</span> : null}
            </button>
          ))}
        </div>

        {tab === "guild" ? (
          chapter ? (
            <div className="space-y-3">
              <div className="rounded-lg border-2 border-frame/50 bg-night-2/60 p-3">
                <p className="font-pixel text-[15px] text-gold">{chapter.name}</p>
                <p className="text-[12px] opacity-60">{GUILD_ORG} · clerk: {chapter.clerk}</p>
                <p className="mt-2 text-[12.5px] leading-snug opacity-85">
                  The Guild charts the wild places and pays for honest records of them — routes, ruins, weather, and the things that live where maps run out.
                  It administers expeditions for any paying commissioner, but answers to none of them.
                </p>
              </div>
              <div className="rounded-lg border-2 border-frame/50 bg-night-2/60 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-pixel text-[13px] text-gold">Your standing here</p>
                  <span className="font-mono text-[13px] text-gold">
                    {standing} · {repLabel(standing)}
                  </span>
                </div>
                {member ? (
                  <p className="mt-1.5 text-[12px] opacity-70">
                    Enrolled in the Guild's rolls since day {dayOf(gs.expeditions?.memberSince ?? 0) + 1}.
                  </p>
                ) : (
                  <button
                    className="btn-game btn-ember mt-2 h-10 w-full text-sm"
                    onClick={() => {
                      const msg = act((g) => joinGuild(g));
                      if (msg) toast(msg);
                      else toast("No chapter keeps a hall here.");
                    }}
                  >
                    Join the Guild's rolls
                  </button>
                )}
                <p className="mt-2 text-[11.5px] leading-snug opacity-60">
                  Membership asks nothing of your homestead or any association — the Guild keeps its own ledger, and its own opinion of you, chapter by chapter.
                </p>
              </div>
              {active.length ? (
                <div className="rounded-lg border border-ember/40 bg-ember/5 p-3 text-[12.5px]">
                  <p className="font-pixel text-[12px] text-ember">Fieldwork in hand</p>
                  <p className="mt-1 opacity-80">"{active[0].offer.title}" — {active[0].offer.objectives.filter((o) => o.progress >= o.count).length} of {active[0].offer.objectives.length} objectives met.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="p-4 text-center text-sm opacity-60">
              The Guild keeps halls in towns and cities only. Find one and the clerk will take your name — or a commission.
            </p>
          )
        ) : null}

        {tab === "board" ? (
          offers.length ? (
            <div className="space-y-2.5">
              {offers.map((o) => (
                <OfferCard key={o.id} gs={gs} offer={o} expanded={openOffer === o.id} onToggle={() => setOpenOffer((cur) => (cur === o.id ? null : o.id))} />
              ))}
            </div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">
              {chapter
                ? member
                  ? "The board is bare today. Some days, there is simply no work worth the ink."
                  : "The clerk glances at the board, then at you. Join the rolls first."
                : "No chapter keeps a hall here — the Guild's boards hang in towns and cities."}
            </p>
          )
        ) : null}

        {tab === "active" ? (
          active.length ? (
            <div className="space-y-2.5">{active.map((a) => <ActiveCard key={a.offer.id} gs={gs} inst={a} />)}</div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">No fieldwork in hand. The board above always wants doing.</p>
          )
        ) : null}

        {tab === "history" ? (
          history.length ? (
            <div className="space-y-2">
              {history.map((h, i) => (
                <div key={`${h.offer.id}:${i}`} className="rounded-lg border-2 border-frame/50 bg-night-2/60 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-pixel text-[13px] text-gold">{h.offer.title}</p>
                    <span className={cn("shrink-0 font-pixel text-[11px] capitalize", OUTCOME_STYLE[h.outcome])}>{h.outcome}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] opacity-60">
                    Day {h.day + 1} · {h.objectivesDone}/{h.objectivesTotal} objectives · {h.offer.guildName}
                  </p>
                  <p className="mt-1 text-[12px] opacity-80">{h.rewardsText}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-3 text-center text-sm opacity-60">No expeditions settled yet.</p>
          )
        ) : null}

        {tab === "board" && chapter && !member ? null : null}
        {tab === "board" && chapter && member && !offers.length && active.length ? (
          <p className="text-center text-[11.5px] opacity-50">
            <Swords className="mr-1 inline h-3 w-3" /> One expedition at a time — finish or abandon the work in hand first.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
