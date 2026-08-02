#!/usr/bin/env bash
set -euo pipefail

INPUT="$1"
OUTPUT="$2"

ffmpeg -y \
  -i "$INPUT" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
  -shortest \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -preset medium -crf 20 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  "$OUTPUT"
