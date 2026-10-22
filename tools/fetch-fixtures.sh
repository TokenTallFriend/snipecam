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

# Strangers: different people, used as non-members when tuning the match threshold
mkdir -p "$F/strangers"
for i in $(seq 1 16); do get "stock-models-$i.jpg" "$F/strangers/stock-models-$i.jpg"; done
for i in $(seq 1 8); do get "stock-teen-$i.jpg" "$F/strangers/stock-teen-$i.jpg"; done
for n in celeste christina lauren lexi linda nicole tasia tetiana; do get "person-$n.jpg" "$F/strangers/person-$n.jpg"; done

# Fake-camera video for Chromium (--use-file-for-fake-video-capture): one face centered in a 1280x720 frame
[ -s "$F/face-cam.y4m" ] || ffmpeg -loglevel error -y -loop 1 -i "$F/people/emotions-a/1.jpg" \
  -vf "scale=-2:600,pad=1280:720:(ow-iw)/2:(oh-ih)/2:gray" -r 5 -t 1 -pix_fmt yuv420p "$F/face-cam.y4m"
# Fake-camera loop for catching tests: persons A and B side by side for 6 s, then an empty frame for 8 s
[ -s "$F/pair-cam.y4m" ] || ffmpeg -loglevel error -y \
  -loop 1 -t 6 -i "$F/people/emotions-a/1.jpg" -loop 1 -t 6 -i "$F/people/emotions-b/5.jpg" \
  -f lavfi -t 8 -i color=c=gray:s=960x540:r=2 \
  -filter_complex "[0]scale=-2:480,setsar=1[a];[1]scale=-2:480,setsar=1[b];[a][b]hstack=2,pad=960:540:(ow-iw)/2:(oh-ih)/2:gray,fps=2,format=yuv420p[p];[2]format=yuv420p[g];[p][g]concat=n=2:v=1" \
  -pix_fmt yuv420p "$F/pair-cam.y4m"
[ -s "$F/blank.png" ] || ffmpeg -loglevel error -y -f lavfi -i color=c=gray:s=640x480 -frames:v 1 "$F/blank.png"
# File list for tests/tune.html (static servers can't list folders). Add your own photos to
# people/<name>/ and re-run this script to include them.
( cd "$F" && find people strangers -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | sort ) |
  python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin], indent=1))' > "$F/manifest.json"
echo "fixtures ready in $F ($(grep -c '"' "$F/manifest.json") images)"
