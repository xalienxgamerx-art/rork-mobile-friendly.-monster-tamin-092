#!/usr/bin/env bash
# Normalizes the C/D ground-texture variations to the mean luminance of their
# biome's A/B pair, so the four variants read as one family on the map while
# keeping each texture's internal contrast. Idempotent-ish: run on freshly
# installed tiles (re-running keeps converging toward the same target).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/../../public/tiles/biome"
cd "$DIR"
yavg() { ffmpeg -i "$1" -vf signalstats,metadata=print:key=lavfi.signalstats.YAVG -f null - 2>&1 | grep -o 'YAVG=[0-9.]*' | head -1 | cut -d= -f2; }
for b in deep sea lake river beach meadow forest taiga desert hills peak gloomwood marsh steppe tundra snow mountain; do
  a=$(yavg "$b.png"); c=$(yavg "${b}_b.png")
  target=$(awk -v x="$a" -v y="$c" 'BEGIN{print (x+y)/2}')
  for sfx in c d; do
    f=$(yavg "${b}_${sfx}.png")
    fac=$(awk -v t="$target" -v f="$f" 'BEGIN{printf "%.4f", t/f}')
    near=$(awk -v f="$fac" 'BEGIN{print (f>0.97 && f<1.03)}')
    [ "$near" = "1" ] && { echo "ok   $b $sfx (factor $fac ~1)"; continue; }
    ffmpeg -loglevel error -i "${b}_${sfx}.png" -vf "lutyuv=y='clip(val*${fac},0,255)'" -y "/tmp/norm-${b}-${sfx}.png"
    mv "/tmp/norm-${b}-${sfx}.png" "${b}_${sfx}.png"
    echo "norm $b $sfx ${f} -> ${target} (x${fac})"
  done
done
