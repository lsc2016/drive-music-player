#!/bin/sh
# 맥에서 플레이어 띄우기: ./serve.sh  →  브라우저에서 http://localhost:8000
cd "$(dirname "$0")"
echo "Drive Music → http://localhost:8000  (끄려면 Ctrl+C)"
( sleep 1; open "http://localhost:8000" 2>/dev/null ) &
python3 -m http.server 8000
