import type { Npc } from "./world";
import type { ObjKind } from "./objects";

const A = "https://ymk3ebvu3chfbjw17nxd9.rork.app/~assets";

export const ART = {
  title: `${A}/img/94366765-b218-416a-85d3-57a4400c78c2.png`,
  icon: "/icon.png",
} as const;

// All 31 sprites are processed locally in public/monsters/v2 — transparent background,
// no baked outline, creature-internal black preserved. Rebuild with: bun scripts/sprites.ts
export const MONSTER_ART: Record<string, string> = Object.fromEntries(
  ["cindermaw", "mossback", "pipwisp", "slimekin", "boglurk", "nimbletuft", "thornhog", "dunescuttle", "frostnib", "gloamoth",
   "cragjaw", "hollowcrow", "regalslime", "sunwyrm", "bloomwisp", "zephyr_hawk", "tidefin_toad", "skullclub_orc", "crested_wyrm",
   "mandrake_maw", "jade_spikeon", "stormmane_drake", "crystal_golem", "skyhorn_dragon", "ironfang_tyrant",
   "gravewool", "slagtoad", "rimefang", "wispwraith", "geodeback", "mawbrand",
  ].map((id) => [id, `/monsters/v2/${id}.png`]),
);

// The nine legendary individuals (Updates G, G.3 + G.4), full-body HD pixel-art
// sprites in the studio's Toriyama-inspired style; the black background is
// keyed at runtime by processSprite, like the historical figures' art. Keyed
// by species id so every MONSTER_ART consumer renders them with no other change.
Object.assign(MONSTER_ART, {
  vaelrox: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/bdd93409-32c1-4d9a-b04a-65e1751724a0.png",
  umbrelith: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/d683dd19-0123-47e5-ae46-dd09e4fea7df.png",
  miravane: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/1c741ce4-adfe-4cc0-a022-aa18dc09da2c.png",
  sarquiss: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/aa7cdb8a-e45c-492a-ab37-8d24e792f8c3.png",
  aurelfar: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/83057c7d-37ac-4847-85c6-46fb574c9f97.png",
  tempestrix: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/f32efc7e-8ed6-4ea1-9b43-b2095b877d57.png",
  nereoth: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/badcf3f6-f577-4713-ad3f-56a75a8a3064.png",
  vaskar: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/5dc20120-fef3-42bd-b039-441c20bb9929.png",
  karkanos: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/1c9aa953-e93c-4780-b6fd-640479fdc00d.png",
});

export const NEST_ART = {
  nest: "/monsters/v2/nest.png",
  nest_eggs: "/monsters/v2/nest_eggs.png",
} as const;

// Hamlet folk portraits, processed from the role art by: bun scripts/npcs.ts.
// Resident and recruiter use generated art directly (variant-aware portraits can replace these later).
export const NPC_ART: Record<Npc["role"], string> = {
  innkeep: "/npcs/innkeep.png",
  trader: "/npcs/trader.png",
  penkeeper: "/npcs/penkeeper.png",
  resident: "https://i3c71f2gn5ug0sxvn3ksc.rork.app/~assets/img/463d8dba-9074-45de-a9db-406ca893cee5.png",
  recruiter: "https://i3c71f2gn5ug0sxvn3ksc.rork.app/~assets/img/1983d1c2-1239-4aea-a5d8-b162032b2898.png",
  traveler: "https://i3c71f2gn5ug0sxvn3ksc.rork.app/~assets/img/463d8dba-9074-45de-a9db-406ca893cee5.png",
  // the coliseum steward (Update F), generated arena-official art
  steward: "https://njj39x8kf8cew4pcqs4qw.rork.app/~assets/img/87926786-0e5f-4271-9a78-463ce26806f0.png",
  // historical figures (Update G.1), full-body HD pixel-art sprites in the
  // Toriyama-inspired RPG style; the black background is keyed at runtime by
  // processSprite. The two stone roles share one waystone image.
  champion: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/da643f4f-86b1-419b-974f-86dd02d027d3.png",
  scholar: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/960218a6-f11d-4b20-8000-b6a075c72b1c.png",
  explorer: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/eb68dc1e-3ea2-49fd-9fb0-5141b1c10ccb.png",
  official: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/d3c05be4-18bb-480c-8229-af502ae69cbf.png",
  memorial: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/e15929f7-8e3d-4524-8206-ab6ef6776501.png",
  marker: "https://ldlvp1lzdgvm0k20kx4xv.rork.app/~assets/img/e15929f7-8e3d-4524-8206-ab6ef6776501.png",
};

// The twelve rival tamers, one illustrated sprite each (hero/townsfolk art style),
// processed into public/tamers by scripts/tamer-art/rivals.ts. Keyed by tamer
// number: t1 → rival_1, t12 → rival_12.
export const RIVAL_ART: string[] = Array.from({ length: 12 }, (_, i) => `/tamers/rival_${i + 1}.png`);

// Tall tree sprites for the local map: one HD transparent PNG per tree kind,
// drawn up to three tiles tall and depth-sorted against actors by base tile.
// The low-res pixel art in tiles.ts objectTex stays as the fallback while
// these load and for memory-dimmed tiles.
export const TREE_ART: Partial<Record<ObjKind, string>> = {
  tree: "/trees/broadleaf.png",
  pine: "/trees/pine.png",
  gloomtree: "/trees/gloomtree.png",
  deadtree: "/trees/deadtree.png",
};

export const MUSIC = {
  wilds: `${A}/aud/78b47f55-05a0-41cc-9936-686bc768b87f.mp3`,
  battle: `${A}/aud/d2d06a16-f11e-4d3c-90fd-9d80cbd1dcba.mp3`,
} as const;
