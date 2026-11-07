#!/usr/bin/env bash
# Provenance for public/tiles/slopes/<style>.png — walkable slope art.
#
# Generated with generateImageAsset (HD pixel art, Dragon Quest style, art
# rises toward the top/north edge; turned per side at render time in
# src/game/tiles.ts slopeTex). Installed at 32px with ffmpeg area scaling to
# keep the pixel grid, same as the tree pipeline.
#
#   moss    grass_dirt_slope_tile  cd1a3831-9121-4486-9922-7d74a9cdbba9
#   sand    sand_dune_slope        6141c955-f243-4a0e-8deb-965728c9461b
#   ice     snow_slope_tile        814e50d7-d5f9-43b3-9404-63f39d11d582
#   basalt  volcanic_basalt_scree  e9582423-1a37-4377-8962-7a8fa237e181
#   granite granite_scree_slope    7f3c88bd-87ff-4784-b05f-bf123c55a0a6
#   earth   dirt_slope_tile        1ebc85d2-143b-4fae-b39e-b415943c5261
set -euo pipefail
cd "$(dirname "$0")/../../public/tiles/slopes"

declare -A UUIDS=(
  [moss]=cd1a3831-9121-4486-9922-7d74a9cdbba9
  [sand]=6141c955-f243-4a0e-8deb-965728c9461b
  [ice]=814e50d7-d5f9-43b3-9404-63f39d11d582
  [basalt]=e9582423-1a37-4377-8962-7a8fa237e181
  [granite]=7f3c88bd-87ff-4784-b05f-bf123c55a0a6
  [earth]=1ebc85d2-143b-4fae-b39e-b415943c5261
)

for style in "${!UUIDS[@]}"; do
  curl -sL -o "/tmp/slope_${style}.png" \
    "https://h81ztx7f30yigq1xvxa93.rork.app/~assets/img/${UUIDS[$style]}.png"
  ffmpeg -y -loglevel error -i "/tmp/slope_${style}.png" \
    -vf "scale=32:32:flags=area" "${style}.png"
done
