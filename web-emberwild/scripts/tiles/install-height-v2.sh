#!/usr/bin/env bash
# One-off installer for the regenerated cliff set (2026-11): rock-strata faces,
# stone stairs, and the dedicated convex corner + concave inner-corner pieces.
# Downsamples the R2 sources onto the 32x32 pixel grid (scale=32:32:flags=area)
# and overwrites public/tiles/height/*.png.
set -euo pipefail
R2="https://h81ztx7f30yigq1xvxa93.rork.app/~assets/img"
OUT="$(cd "$(dirname "$0")" && pwd)/../../public/tiles/height"
mkdir -p "$OUT"
install_one() { # install_one <r2-id> <out-name>
  curl -sf --max-time 120 -o "/tmp/h2-$2.png" "$R2/$1.png"
  ffmpeg -loglevel error -i "/tmp/h2-$2.png" -vf scale=32:32:flags=area -y "$OUT/$2.png"
  echo "ok $2.png"
}
install_one 3dc7161f-db37-4422-925d-bb78c7b471dd moss_face
install_one 3f702e09-6787-4bf4-ac58-9aaa516d8dbe sand_face
install_one c17caa9b-9ec5-4e6f-a801-7f5850dd5a42 ice_face
install_one 27b30339-67d0-46ad-b4d0-c786b5509543 basalt_face
install_one 3edb544f-9d88-4ea4-bf8b-6455040de65d granite_face
install_one 80c6c835-2623-41fc-93fe-1d2b9e493f4e earth_face
install_one 2f6ba447-b0d3-4994-9aa1-095e9c7d523c moss_stairs
install_one 6cb33035-6f74-468b-a0b7-85441d37f74c sand_stairs
install_one 3f8d1a13-8f1a-4e87-9d85-80ae436480fd ice_stairs
install_one e60b6952-720c-4596-87c3-31861d63ad94 basalt_stairs
install_one 386ca2d2-c42b-4a3e-b66c-32cf2b9f3f8a granite_stairs
install_one 28bce55a-0108-4732-a6ba-b407552ef700 earth_stairs
install_one f13cc961-8e4d-4e26-9340-46fa1f2941e5 moss_corner
install_one 494a1c9e-5a16-42a0-9b73-7702c20591d0 sand_corner
install_one de120980-a459-4ae6-a841-c1ab2b025bec ice_corner
install_one e62be207-1111-4233-803c-d676b752abbd basalt_corner
install_one 1b08a5e5-49ad-4b02-bd2d-0e8462b9f252 granite_corner
install_one 092ca36b-f6b2-4da2-9842-6ed92c835715 earth_corner
install_one 94ddfa45-68d1-4f6a-962f-edb47ed8bf2f moss_inner
install_one 5414ba8b-8b54-4b4b-9347-072ef83c60a6 sand_inner
install_one 4b5bfbe3-104c-4e53-9fbc-7f0fc7e394e9 ice_inner
install_one f3e05856-a881-40db-99a2-9781a1ec80d7 basalt_inner
install_one de5cfc0e-3a63-4f09-b71e-51137fa282d8 granite_inner
install_one 9f6c55ac-62af-4a41-9ccb-2e7228c1730f earth_inner
