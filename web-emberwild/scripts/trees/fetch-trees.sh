#!/usr/bin/env bash
# Tree sprite sources — generated via generateImageAsset on a flat #FF00FF
# backdrop, keyed transparent by: bun scripts/trees/key-trees.ts (see that
# script for the pipeline). Re-download the originals with:
#   OUT=... ; for n in ...; do curl -o "$OUT/$n.png" URL; done
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/../../public/trees"
mkdir -p "$OUT"
declare -A SRC=(
  [broadleaf]="6e9bf98e-72c3-413d-b8da-760c59ddc297" # oak_tree_2
  [pine]="bcbcca9a-027a-49f2-a77e-6b2aae058acc" # pine_tree_sprite
  [gloomtree]="48cf28f2-cd83-4646-9b8e-663884af93fc" # gloomwood_tree_2
  [deadtree]="4783d6a0-dd02-4f9b-9aa0-36cd0527f05c" # dead_tree_2
)
BASE="https://h81ztx7f30yigq1xvxa93.rork.app/~assets/img"
for n in broadleaf pine gloomtree deadtree; do
  curl -sf -o "/tmp/tree_src_$n.png" "$BASE/${SRC[$n]}.png"
  bun "$(dirname "$0")/key-trees.ts" "/tmp/tree_src_$n.png" "$OUT/$n.png" --max-h 768
done
