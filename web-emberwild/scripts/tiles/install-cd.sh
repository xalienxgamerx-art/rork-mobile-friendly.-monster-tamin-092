#!/usr/bin/env bash
# One-off installer for the C/D texture variations (companions to
# fetch-tiles.sh, which documents the A/B provenance). Downloads the new
# hand-painted sources from R2 and downsamples onto the 32px grid.
set -euo pipefail
R2="https://igzmyz9w9a7rv2t4wkhll.rork.app/~assets/img"
OUT="$(cd "$(dirname "$0")" && pwd)/../../public/tiles/biome"
mkdir -p "$OUT"
declare -A SC=(
  [deep]=b1f86c82-c5f3-4aa8-90ee-e4b5e74c6447 [sea]=59cce30c-731f-4330-ad63-a64434546a62
  [lake]=f5e0c036-71ce-4eb9-ab6f-ae2eba10b6b2 [river]=7cdef517-70a6-4076-8a99-8c7e95dd72a7
  [beach]=f12094c7-1805-493c-a91e-be69dd45b78b [meadow]=2fd5f5fb-a477-44ca-996e-637bf5d40626
  [forest]=8f147a5c-9f24-4ddf-b664-e84af69bc387 [taiga]=7dbc90c7-547e-4116-9ebd-c5b732bfcbd6
  [gloomwood]=91f4b747-d6f0-470e-a3e5-31c5cc1b7a0e [marsh]=c4d0f00c-0d3f-4866-975c-46f223957309
  [steppe]=7c4e4a67-0597-4cf0-94b6-f1aff09b2547 [desert]=cc5807a4-4907-4d16-b7ce-52d43451ad4c
  [tundra]=caf0f1c2-b8ec-4776-a04f-23cb18c3f588 [snow]=c6817f16-33b6-4df6-ac3c-591d19196879
  [hills]=1480332d-aeb6-4bd2-8fd7-e497676e42d5 [mountain]=f1dffc83-53fe-4f5f-bbe5-0859aaf266bf
  [peak]=03309cc9-2c8e-4a5c-a1b8-5aad31a5f617
)
declare -A SD=(
  [deep]=fd6b913c-1640-47f7-b3ea-ea047b7accd5 [sea]=d4a2a7f2-00b8-472a-88ff-7d10c5213cf0
  [lake]=f58c4a04-054e-42c9-ac60-cded7699a9cc [river]=2f7b2128-0182-41d6-bb7e-4cb904931d4c
  [beach]=adc99ace-8392-4ce1-92c4-477f37fa68df [meadow]=ce026a1d-a15e-4539-a092-8004598fc2ae
  [forest]=c5de2f7c-b3b1-4761-a15e-a740673c3e40 [taiga]=9300bcdd-a370-4e72-a44d-6c6cb2c395e4
  [gloomwood]=7782893e-316a-40ad-816b-7b27863b57de [marsh]=b7e578e9-d4f9-408c-8716-a211dd50c3ee
  [steppe]=fdc481b0-82a1-4163-bf59-5708f9087385 [desert]=eda43b5a-b373-4e5b-8ac4-fd94077bd43e
  [tundra]=ab66c0ec-411b-4ea7-8d91-02a28c43ac85 [snow]=e3a186f1-8fde-4ade-a487-3e1bf2d60c44
  [hills]=8fb3f780-90bb-4c1f-a54e-802f34b24485 [mountain]=c3f5f6af-01fa-4a31-9b6b-447b7e8b195f
  [peak]=eb462059-eca0-454c-a11c-fd7e1437938f
)
for b in "${!SC[@]}"; do
  for sfx in c d; do
    id=${SC[$b]}; [[ $sfx == d ]] && id=${SD[$b]}
    curl -sf --max-time 120 -o "/tmp/t-${b}-${sfx}.png" "$R2/$id.png"
    ffmpeg -loglevel error -i "/tmp/t-${b}-${sfx}.png" -vf scale=32:32:flags=area -y "$OUT/${b}_${sfx}.png"
    echo "ok $b -> ${b}_${sfx}.png"
  done
done
