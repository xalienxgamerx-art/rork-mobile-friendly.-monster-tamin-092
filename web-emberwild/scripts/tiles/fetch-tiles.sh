#!/usr/bin/env bash
# Provenance for public/tiles/biome/*.png — the hand-painted HD ground textures
# (Dragon Quest style), generated with generateImageAsset and downsampled onto
# the 32×32 pixel grid the map renders (box average: scale=32:32:flags=area;
# the map canvas upscales with smoothing off, so the grid stays crisp).
#
# Each biome's full-resolution source lives in R2 at the URL below. To refresh
# one: download, downscale, overwrite the file in public/tiles/biome/.
set -euo pipefail
R2="https://igzmyz9w9a7rv2t4wkhll.rork.app/~assets/img"
declare -A SRC=(
  [deep]="e24edbd0-8a2b-4f16-add9-6427efdb4ac7"
  [sea]="1d6dc1f1-3862-4ec3-ba07-2587a0fea2b6"
  [lake]="611ef494-d0b8-4f5b-8f9b-7e2d9e79d346"
  [river]="19ee2182-6928-4498-ae51-273d445ffb45"
  [beach]="6e2c4695-0597-48a3-93c0-b7780bbd084b"
  [meadow]="e8d9ffaa-d76b-4941-ab70-47dd6d611764"
  # v2 re-rolls: the first pass painted standing trees/cacti on the ground,
  # doubling with the physical tree objects (tile_forest_floor_v2 etc.)
  [forest]="1f00ef27-7b32-4439-b9da-613f192c7de1"
  [taiga]="72e4c430-3d03-4d87-a118-8f361f31fa28"
  [desert]="398e4a68-89b0-43c2-8ea1-ae0e55c6f300"
  [hills]="7f66d826-9dfd-472a-b43e-055541bef3fd"
  [peak]="f81ae9ea-d730-4885-9fd0-6ae5dc7e6e5a"
  [gloomwood]="360f2263-7032-4c45-a2ca-0567af736bd0"
  [marsh]="481df1af-9e8c-4724-b0d0-ee9baf25a4b2"
  [steppe]="44c752ec-46b7-4f33-a6bb-d31d29e1b9a3"
  [tundra]="95561867-36e7-4768-b8d9-5a06b8fdcff9"
  [snow]="7168e9fe-02a4-466a-b8ec-4053ca5c9b10"
  [mountain]="461cc2d6-0ab2-4631-b029-8e9509924e1e"
)
# second variation per biome — installed as <biome>_b.png; the map mixes the
# four textures across tiles (variant 0–3 → A/B/C/D, odd variants mirrored)
declare -A SRC_B=(
  [deep]="009b6fad-b5e6-45ef-a894-e4791b25a808"
  [sea]="6166988d-2f79-4718-ba66-0a3e74e90977"
  [lake]="0df6ded3-5899-45cc-a5c8-96cb9180d9dd"
  [river]="dfa9fc19-0ce1-4d66-996e-d041390177a2"
  [beach]="8b75bbc1-085a-4dbc-8d8e-a2a58fff8ad9"
  [meadow]="475f2310-b37b-43ab-bb36-c171aed6e661"
  [forest]="36029076-2c9a-4c36-a81f-5d485a1f1126"
  [taiga]="bbf3d494-8047-438f-96b9-957a3bf6f740"
  [gloomwood]="8dbe9620-bc76-4e48-a048-a0e885bf825e"
  [marsh]="b75fcce1-88d2-42d8-8520-e5a3fcd6e0d6"
  [steppe]="ee48fc3c-8cf5-454e-af29-1a10290f7c96"
  [desert]="d8ca4a9c-cca9-4ae1-89ea-41b0cca1cd86"
  [tundra]="ea2f0e97-4dbf-4404-a4f7-2f6a3dd66c69"
  [snow]="823d951a-c986-4971-b5f8-401e32e73dcf"
  [hills]="9d3db9cd-1984-4502-9462-3d81ef6be452"
  [mountain]="69b2cd81-d5cb-4610-94a5-0037d5ba0a56"
  [peak]="8471ab5e-c3f2-45ad-aeda-8575f76a2a94"
)
# third and fourth variations per biome — installed as <biome>_c.png and
# <biome>_d.png, so every map variant shows unique art (each still mirrored
# on odd variants)
declare -A SRC_C=(
  [deep]="b1f86c82-c5f3-4aa8-90ee-e4b5e74c6447"
  [sea]="59cce30c-731f-4330-ad63-a64434546a62"
  [lake]="f5e0c036-71ce-4eb9-ab6f-ae2eba10b6b2"
  [river]="7cdef517-70a6-4076-8a99-8c7e95dd72a7"
  [beach]="f12094c7-1805-493c-a91e-be69dd45b78b"
  [meadow]="2fd5f5fb-a477-44ca-996e-637bf5d40626"
  [forest]="8f147a5c-9f24-4ddf-b664-e84af69bc387"
  [taiga]="7dbc90c7-547e-4116-9ebd-c5b732bfcbd6"
  [gloomwood]="91f4b747-d6f0-470e-a3e5-31c5cc1b7a0e"
  [marsh]="c4d0f00c-0d3f-4866-975c-46f223957309"
  [steppe]="7c4e4a67-0597-4cf0-94b6-f1aff09b2547"
  [desert]="cc5807a4-4907-4d16-b7ce-52d43451ad4c"
  [tundra]="caf0f1c2-b8ec-4776-a04f-23cb18c3f588"
  [snow]="c6817f16-33b6-4df6-ac3c-591d19196879"
  [hills]="1480332d-aeb6-4bd2-8fd7-e497676e42d5"
  [mountain]="f1dffc83-53fe-4f5f-bbe5-0859aaf266bf"
  [peak]="03309cc9-2c8e-4a5c-a1b8-5aad31a5f617"
)
declare -A SRC_D=(
  [deep]="fd6b913c-1640-47f7-b3ea-ea047b7accd5"
  [sea]="d4a2a7f2-00b8-472a-88ff-7d10c5213cf0"
  [lake]="f58c4a04-054e-42c9-ac60-cded7699a9cc"
  [river]="2f7b2128-0182-41d6-bb7e-4cb904931d4c"
  [beach]="adc99ace-8392-4ce1-92c4-477f37fa68df"
  [meadow]="ce026a1d-a15e-4539-a092-8004598fc2ae"
  [forest]="c5de2f7c-b3b1-4761-a15e-a740673c3e40"
  [taiga]="9300bcdd-a370-4e72-a44d-6c6cb2c395e4"
  [gloomwood]="7782893e-316a-40ad-816b-7b27863b57de"
  [marsh]="b7e578e9-d4f9-408c-8716-a211dd50c3ee"
  [steppe]="fdc481b0-82a1-4163-bf59-5708f9087385"
  [desert]="eda43b5a-b373-4e5b-8ac4-fd94077bd43e"
  [tundra]="ab66c0ec-411b-4ea7-8d91-02a28c43ac85"
  [snow]="e3a186f1-8fde-4ade-a487-3e1bf2d60c44"
  [hills]="8fb3f780-90bb-4c1f-a54e-802f34b24485"
  [mountain]="c3f5f6af-01fa-4a31-9b6b-447b7e8b195f"
  [peak]="eb462059-eca0-454c-a11c-fd7e1437938f"
)
OUT="$(dirname "$0")/../../public/tiles/biome"
fetch_one() { # fetch_one <biome> <r2-id> <out-name>
  curl -sf --max-time 120 -o "/tmp/tile-$1.png" "$R2/$2.png"
  ffmpeg -loglevel error -i "/tmp/tile-$1.png" -vf scale=32:32:flags=area -y "$OUT/$3.png"
  echo "ok $1 -> $3.png"
}
for biome in "${!SRC[@]}"; do
  id="${SRC[$biome]}"
  [[ "$id" == TBD-* ]] && { echo "skip $biome ($id)"; continue; }
  fetch_one "$biome" "$id" "$biome"
  fetch_one "$biome" "${SRC_B[$biome]}" "${biome}_b"
  fetch_one "$biome" "${SRC_C[$biome]}" "${biome}_c"
  fetch_one "$biome" "${SRC_D[$biome]}" "${biome}_d"
done
