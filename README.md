
# DASH Streaming Proxy

Node.js + Express proxy for DASH streaming (MPD + segments) with origin rotation and session pinning.

## Features
- DASH `.mpd` and `.m4s` support
- Origin rotation for load balancing
- Session pinning to prevent segment mismatch
- Production-ready for Railway / VPS
- Optimized for low latency streaming

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/dash-streaming-proxy.git
cd dash-streaming-proxy
npm install
npm start
