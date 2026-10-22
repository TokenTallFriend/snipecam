#!/bin/sh
# Serve the app at http://localhost:8000 (localhost counts as secure, so the camera works).
cd "$(dirname "$0")/.." && exec python3 -m http.server "${1:-8000}" --bind 127.0.0.1
