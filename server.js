const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// ORIGIN ROTATION
// =========================
const ORIGINS = [
  "http://136.239.158.18:6610",
  "http://136.239.158.20:6610",
  "http://136.239.158.30:6610",
  "http://136.239.173.3:6610",
  "http://136.158.97.2:6610",
  "http://136.239.173.10:6610",
  "http://136.239.158.10:6610",
  "http://136.239.159.20:6610"
];

let originIndex = 0;
const currentOrigins = {};

function getOrigin(channelId, rotate = false) {
  if (!currentOrigins[channelId] || rotate) {
    currentOrigins[channelId] = ORIGINS[originIndex];
    originIndex = (originIndex + 1) % ORIGINS.length;
  }
  return currentOrigins[channelId];
}

// =========================
// AUTH ROTATION
// =========================
function rotateStartNumber() {
  const base = 46489952;
  const step = 6;
  return base + Math.floor(Math.random() * 100000) * step;
}

function rotateIAS() {
  return "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
}

function rotateUserSession() {
  return Math.floor(Math.random() * 1e15).toString();
}

// =========================
// SEGMENT CACHE
// =========================
const segmentCache = new Map();
const MAX_CACHE = 100; // maximum segments cached

async function fetchSegmentCached(url) {
  if (segmentCache.has(url)) return segmentCache.get(url);

  const res = await fetch(url, { headers: { "Connection": "keep-alive" } });
  const buffer = await res.arrayBuffer();
  segmentCache.set(url, buffer);

  if (segmentCache.size > MAX_CACHE) {
    const firstKey = segmentCache.keys().next().value;
    segmentCache.delete(firstKey);
  }

  return buffer;
}

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("✅ DASH MPD Proxy with Full Rotation & Buffering Support is running");
});

// =========================
// FULL DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

  const rotateOrigin = path.endsWith(".mpd");
  const origin = getOrigin(channelId, rotateOrigin);

  const upstreamBase = `${origin}/001/2/ch0000009099000000${channelId}/`;

  // Rotate auth params for every request
  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${rotateStartNumber()}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

  try {
    // =========================
    // MANIFEST
    // =========================
    if (path.endsWith(".mpd")) {
      const upstream = await fetch(targetURL, {
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*",
          "Connection": "keep-alive"
        }
      });

      if (!upstream.ok) return res.status(upstream.status).end();

      let mpd = await upstream.text();
      const proxyBaseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // SEGMENTS
    // =========================
    const buffer = await fetchSegmentCached(targetURL);

    res.status(200);
    res.set({
      "Content-Type": "video/iso.segment",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    return res.send(Buffer.from(buffer));

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err.message);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT} with full rotation & buffering support`);
});
