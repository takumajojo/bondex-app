#!/bin/sh
# cg/renders/sNN.raw.png → photos/sNN.jpg（黒をスライド背景 #0A0A0A に持ち上げ、sRGB JPEG に）
set -e
cd "$(dirname "$0")/.."
for f in cg/renders/*.raw.png; do
  n=$(basename "$f" .raw.png)
  convert "$f" +level 3.92%,100% -depth 8 -quality 93 -sampling-factor 4:4:4 "photos/$n.jpg"
  echo "photos/$n.jpg $(identify -format '%wx%h' "photos/$n.jpg")"
done
