#!/usr/bin/env bash
# Provenance + installer for public/tiles/height/*.png — the hand-painted HD
# cliff faces (<style>_face.png) and stairs (<style>_stairs.png), Dragon Quest
# style, generated with generateImageAsset and downsampled onto the 32×32
# pixel grid the map renders (scale=32:32:flags=area).
#
# The 2026-11 set replaced the first pass, whose faces read as wooden planks
# and whose corners were cut from the straight art at runtime.
#
# RETIRED: <style>_corner.png and <style>_inner.png. Their thin arms and dark
# L-edges painted shadow crosses at concave junctions and pale texture-less
# curls at convex corners. Corners are now mitred at runtime from the straight
# face bands (rounded shave in tiles.ts), so the corner/inner art is no longer
# downloaded or installed.
#
# Each source lives in R2 at the URL below. To refresh one: download,
# downscale, overwrite the file.
set -euo pipefail
R2="https://h81ztx7f30yigq1xvxa93.rork.app/~assets/img"
declare -A FACE=(
  [moss]=3dc7161f-db37-4422-925d-bb78c7b471dd
  [sand]=3f702e09-6787-4bf4-ac58-9aaa516d8dbe
  [ice]=c17caa9b-9ec5-4e6f-a801-7f5850dd5a42
  [basalt]=27b30339-67d0-46ad-b4d0-c786b5509543
  [granite]=3edb544f-9d88-4ea4-bf8b-6455040de65d
  [earth]=80c6c835-2623-41fc-93fe-1d2b9e493f4e
)
declare -A STAIRS=(
  [moss]=2f6ba447-b0d3-4994-9aa1-095e9c7d523c
  [sand]=6cb33035-6f74-468b-a0b7-85441d37f74c
  [ice]=3f8d1a13-8f1a-4e87-9d85-80ae436480fd
  [basalt]=e60b6952-720c-4596-87c3-31861d63ad94
  [granite]=386ca2d2-c42b-4a3e-b66c-32cf2b9f3f8a
  [earth]=28bce55a-0108-4732-a6ba-b407552ef700
)
declare -A CORNER=( # RETIRED — kept for reference only
  [moss]=f13cc961-8e4d-4e26-9340-46fa1f2941e5
  [sand]=494a1c9e-5a16-42a0-9b73-7702c20591d0
  [ice]=de120980-a459-4ae6-a841-c1ab2b025bec
  [basalt]=e62be207-1111-4233-803c-d676b752abbd
  [granite]=1b08a5e5-49ad-4b02-bd2d-0e8462b9f252
  [earth]=092ca36b-f6b2-4da2-9842-6ed92c835715
)
declare -A INNER=(
  [moss]=94ddfa45-68d1-4f6a-962f-edb47ed8bf2f
  [sand]=5414ba8b-8b54-4b4b-9347-072ef83c60a6
  [ice]=4b5bfbe3-104c-4e53-9fbc-7f0fc7e394e9
  [basalt]=f3e05856-a881-40db-99a2-9781a1ec80d7
  [granite]=de5cfc0e-3a63-4f09-b71e-51137fa282d8
  [earth]=9f6c55ac-62af-4a41-9ccb-2e7228c1730f
)
OUT="$(cd "$(dirname "$0")" && pwd)/../../public/tiles/height"
mkdir -p "$OUT"
fetch_one() { # fetch_one <r2-id> <out-name>
  curl -sf --max-time 120 -o "/tmp/height-$2.png" "$R2/$1.png"
  ffmpeg -loglevel error -i "/tmp/height-$2.png" -vf scale=32:32:flags=area -y "$OUT/$2.png"
  echo "ok $2.png"
}
for style in "${!FACE[@]}"; do
  fetch_one "${FACE[$style]}" "${style}_face"
  fetch_one "${STAIRS[$style]}" "${style}_stairs"
done
