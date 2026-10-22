#!/bin/sh
# Downloads sample face images (from the Human library's repo, MIT) into tests/fixtures/ (gitignored).
# Real club photos go in tests/fixtures/people/<name>/ by hand and are never committed.
set -e
cd "$(dirname "$0")/.."
SRC=https://raw.githubusercontent.com/vladmandic/human/main/samples/in
F=tests/fixtures
mkdir -p "$F/people/emotions-a" "$F/people/emotions-b" "$F/people/vlado"

get() { [ -s "$2" ] || curl -fsSL "$SRC/$1" -o "$2"; }

get ai-face.jpg "$F/single.jpg"
get group-1.jpg "$F/group.jpg"
for i in 1 2 3 4 5; do
  get "stock-emotions-a-$i.jpg" "$F/people/emotions-a/$i.jpg"
  get "stock-emotions-b-$i.jpg" "$F/people/emotions-b/$i.jpg"
done
get person-vlado.jpg "$F/people/vlado/1.jpg"
get person-vlado1.jpg "$F/people/vlado/2.jpg"
get person-vlado5.jpg "$F/people/vlado/3.jpg"

# Fake-camera video for Chromium (--use-file-for-fake-video-capture): one face centered in a 1280x720 frame
[ -s "$F/face-cam.y4m" ] || ffmpeg -loglevel error -y -loop 1 -i "$F/people/emotions-a/1.jpg" \
  -vf "scale=-2:600,pad=1280:720:(ow-iw)/2:(oh-ih)/2:gray" -r 5 -t 1 -pix_fmt yuv420p "$F/face-cam.y4m"
[ -s "$F/blank.png" ] || ffmpeg -loglevel error -y -f lavfi -i color=c=gray:s=640x480 -frames:v 1 "$F/blank.png"
echo "fixtures ready in $F"
