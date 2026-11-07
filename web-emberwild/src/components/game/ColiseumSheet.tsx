import { Swords, Trophy, Users, Coins, Crown, ScrollText, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { DAY_TICKS, SPECIES } from "@/game/data";
import { settlementHere } from "@/game/economy";
import { playerMatch, fightPlayerMatch, rankings, registerPlayer, tierOf, venueName, FORMATS } from "@/game/tournaments";
import { settlementId } from "@/game/settlement";
import { act } from "@/game/store";
import type { GameState, Tournament } from "@/game/types";
import { cn } from "@/lib/utils";
import { SectionTitle, Sheet } from "./ui";

/**
 * The Coliseum (Update F): the tournament circuit's front door. One sheet for
 * the venue the player stands in — proclamations, registration, the live
 * match, the bracket, the F–S rankings table and the circuit's champions.
 */

const dayOf = (tick: number): number => Math.floor(tick / DAY_TICKS);

/** Historical days are negative (Update G.1): "140 days before you", not "day −140". */
const dayLabel = (d: number): string => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} before you` : `day ${d}`);

const TIER_COLOR: Record<string, string> = {
  S: "text-gold",
  A: "text-[#c88ff2]",
  B: "text-[#8fb5f2]",
  C: "text-teal",
  D: "text-emerald-300",
  E: "text-parchment/80",
  F: "text-parchment/40",
};

function TierBadge({ r }: { r: number }) {
  const t = tierOf(r);
  return <span className={cn("inline-block w-6 shrink-0 text-center font-pixel text-[15px]", TIER_COLOR[t])}>{t}</span>;
}

function EntrantLine({ tour, id }: { tour: Tournament; id: string | null }) {
  if (!id) return <span className="text-parchment/35">— a bye —</span>;
  const e = tour.entrants.find((x) => x.id === id);
  return <span className={id === "player" ? "text-gold" : ""}>{e?.name ?? id}</span>;
}

function BracketView({ tour, day }: { tour: Tournament; day: number }) {
  return (
    <div className="space-y-2">
      {tour.rounds.map((round, ri) => {
        const decided = round.every((m) => m.winner);
        const current = !decided && round.some((m) => !m.winner) && tour.rounds.slice(0, ri).every((r) => r.every((m) => m.winner));
        return (
          <div key={ri} className={cn("rounded-md border p-2", current ? "border-gold/50 bg-gold/5" : "border-frame/40")}>
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-parchment/50">
              <span>{ri === tour.rounds.length - 1 ? "Final" : `Round ${ri + 1}`}</span>
              {current ? <span className="text-gold">today's card</span> : decided ? <span>decided</span> : null}
            </div>
            {round.map((m) => (
              <div key={m.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                <span className={cn("flex-1 truncate", m.winner === m.a && m.winner ? "font-bold" : "text-parchment/75")}>
                  <EntrantLine tour={tour} id={m.a} />
                </span>
                <Swords className="h-3 w-3 shrink-0 text-parchment/40" />
                <span className={cn("flex-1 truncate text-right", m.winner === m.b && m.winner ? "font-bold" : "text-parchment/75")}>
                  <EntrantLine tour={tour} id={m.b} />
                </span>
              </div>
            ))}
          </div>
        );
      })}
      {tour.champion ? (
        <div className="flex items-center gap-2 rounded-md border border-gold/50 bg-gold/5 p-2 text-[13px]">
          <Crown className="h-4 w-4 shrink-0 text-gold" />
          <span>
            Champion: <EntrantLine tour={tour} id={tour.champion} />
          </span>
        </div>
      ) : null}
      <div className="text-right font-mono text-[10px] text-parchment/40">day {day}</div>
    </div>
  );
}

export function ColiseumSheet({ gs, open, onClose, onParty }: { gs: GameState; open: boolean; onClose: () => void; onParty: () => void }) {
  if (!open) return null;
  const day = dayOf(gs.tick);
  const here = settlementHere(gs);
  const hereKey = here ? settlementId(here) : null;
  const known = (gs.tournaments?.active ?? []).filter((t) => gs.knowledge.discovered[`f:${t.fx}:${t.fy}`]);
  const pm = playerMatch(gs);
  const entered = known.find((t) => t.entrants.some((e) => e.id === "player"));
  const atVenue = (t: Tournament): boolean => hereKey === t.hostKey;
  // every final ever fought at the sand you're standing on (matched by host
  // name — the archive predates venue keys)
  const ledger = here ? [...(gs.tournaments?.history ?? [])].filter((h) => h.hostName === here.name).reverse().slice(0, 8) : [];

  const doRegister = (t: Tournament) => {
    const err = act((g) => registerPlayer(g, t.id));
    if (err) toast(err);
    else toast(`Entered — your team is weighed in.`);
  };
  const doFight = () => {
    const err = act((g) => fightPlayerMatch(g));
    if (err) toast(err);
    else {
      toast("The horn sounds — fight!");
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="The Coliseum" icon={<Trophy className="h-5 w-5" />}>
      <div className="space-y-4 p-3">
        {/* venue header */}
        <div className="panel-parchment p-3">
          {here ? (
            <>
              <div className="font-serif text-sm font-bold">{venueName(gs, here)}</div>
              <div className="font-mono text-[11px] text-parchment/60">Day {day} · your gold {gs.player.gold}</div>
            </>
          ) : (
            <div className="font-body text-[13px] text-parchment/70">You stand in the wilds. Tournaments are proclaimed in towns and cities — find a steward at the arena door.</div>
          )}
        </div>

        {/* your match */}
        {pm && (
          <div className="rounded-md border-2 border-ember bg-ember/10 p-3">
            <div className="mb-1 flex items-center gap-2 font-pixel text-[14px] text-ember">
              <Swords className="h-4 w-4" /> Your match awaits
            </div>
            <div className="mb-2 font-body text-[12.5px] text-parchment/80">
              {pm.tour.name} · {pm.tour.hostName} · against <span className="font-bold">{pm.opponent.name}</span>'s{" "}
              {SPECIES[pm.opponent.team[0]?.speciesId ?? ""]?.name.toLowerCase() ?? "beast"} (Lv {pm.opponent.team[0]?.level ?? "?"})
            </div>
            <div className="flex gap-2">
              <button className="btn-game btn-ember h-11 flex-1 text-sm" onClick={doFight}>
                <Swords className="h-4 w-4" /> Step onto the sand
              </button>
              <button className="btn-game btn-night h-11 w-24 text-sm" onClick={onParty}>
                Team
              </button>
            </div>
            <div className="mt-1 font-body text-[11px] text-parchment/50">Yield the field (walk away) and the match goes to your opponent.</div>
          </div>
        )}

        {/* proclamations */}
        <div>
          <SectionTitle>
            <ScrollText className="h-4 w-4" /> Proclamations
          </SectionTitle>
          {known.length === 0 ? (
            <div className="rounded-md border border-dashed border-frame/40 p-3 text-center font-body text-xs text-parchment/50">No tournaments are proclaimed yet. Host towns announce them on their boards.</div>
          ) : (
            <div className="space-y-2">
              {known.map((t) => {
                const mine = t.entrants.some((e) => e.id === "player");
                const daysLeft = Math.max(0, t.openDay - day);
                return (
                  <div key={t.id} className="rounded-md border-2 border-frame/40 bg-night-3/40 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-pixel text-[13px] text-parchment">
                          {t.name} {mine ? <span className="text-gold">· entered</span> : null}
                        </div>
                        <div className="font-mono text-[11px] text-parchment/60">
                          {t.hostName} · {FORMATS[t.format].name} · {t.entrants.length} entrants
                        </div>
                      </div>
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]", t.sanctioned ? "bg-teal/15 text-teal" : "bg-ember/15 text-ember")}>{t.sanctioned ? "sanctioned" : "unsanctioned"}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-parchment/70">
                      <span className="inline-flex items-center gap-1">
                        <Coins className="h-3 w-3 text-gold" /> {t.purse}g purse
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {t.entryFee}g entry
                      </span>
                      {t.phase === "registration" ? (
                        <span className="inline-flex items-center gap-1">
                          <Hourglass className="h-3 w-3" /> closes in {daysLeft}d
                        </span>
                      ) : (
                        <span className="text-gold">underway</span>
                      )}
                    </div>
                    {t.maxLevel !== null ? <div className="font-mono text-[10px] text-parchment/50">Novice bracket — beasts above Lv {t.maxLevel} barred.</div> : null}
                    {t.phase === "registration" && !mine ? (
                      <button
                        className="btn-game btn-night mt-2 h-9 w-full text-[12px]"
                        disabled={!atVenue(t)}
                        onClick={() => doRegister(t)}
                      >
                        {atVenue(t) ? `Enter — ${t.entryFee} gold` : `Travel to ${t.hostName} to enter`}
                      </button>
                    ) : null}
                    {t.phase === "underway" ? <div className="mt-2"><BracketView tour={t} day={day} /></div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* rankings */}
        <div>
          <SectionTitle>
            <Trophy className="h-4 w-4" /> Circuit Rankings
          </SectionTitle>
          <div className="overflow-hidden rounded-md border-2 border-frame/40">
            {rankings(gs, 8).map((r, i) => (
              <div key={r.id} className={cn("flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]", i % 2 ? "bg-night-3/40" : "")}>
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-parchment/50">{i + 1}</span>
                <TierBadge r={r.row.rating} />
                <span className={cn("min-w-0 flex-1 truncate", r.id === "player" && "font-bold text-gold")}>{r.name}</span>
                <span className="font-mono text-[11px] text-parchment/60">
                  {r.row.wins}–{r.row.losses}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px]">{r.row.rating}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[10px] text-parchment/40">F · E · D · C · B · A · S — the circuit's ladder, one table for every tamer.</div>
        </div>

        {/* champions */}
        {(gs.tournaments?.history.length ?? 0) > 0 ? (
          <div>
            <SectionTitle>
              <Crown className="h-4 w-4" /> Past Champions
            </SectionTitle>
            <div className="space-y-1">
              {[...(gs.tournaments?.history ?? [])].reverse().slice(0, 6).map((h) => (
                <div key={h.id} className="flex items-baseline gap-2 rounded-md border border-frame/30 px-2.5 py-1.5 text-[12px]">
                  <Crown className="h-3 w-3 shrink-0 self-center text-gold" />
                  <span className={cn("min-w-0 flex-1 truncate", h.championId === "player" && "font-bold text-gold")}>
                    {h.championName} took {h.name} at {h.hostName}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-parchment/50">{dayLabel(h.day)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* this venue's ledger (Update G.1): the sand's history where you stand,
            back through the generational past */}
        {here && ledger.length > 0 ? (
          <div>
            <SectionTitle>
              <ScrollText className="h-4 w-4" /> {here.name}'s ledger
            </SectionTitle>
            <div className="space-y-1">
              {ledger.map((h) => (
                <div key={h.id} className="rounded-md border border-frame/30 px-2.5 py-1.5 text-[12px]">
                  <div className="flex items-baseline gap-2">
                    <Crown className="h-3 w-3 shrink-0 self-center text-gold" />
                    <span className={cn("min-w-0 flex-1 truncate", h.championId === "player" && "font-bold text-gold")}>
                      {h.championName} took {h.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-parchment/50">{dayLabel(h.day)}</span>
                  </div>
                  <div className="ml-5 font-mono text-[10px] text-parchment/45">
                    runner-up {h.runnerUpName} · {h.entrants} entrants · {h.purse}g purse
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
