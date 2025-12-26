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
function getOrigin() {
  const o = ORIGINS[originIndex];
  originIndex = (originIndex + 1) % ORIGINS.length;
  return o;
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
// SEGMENT RAM CACHE
// =========================
const segmentCache = new Map();
const MAX_CACHE_ITEMS = 500;        // safe limit
const CACHE_TTL = 15 * 1000;        // 15 seconds

function setCache(key, data, headers) {
  if (segmentCache.size >= MAX_CACHE_ITEMS) {
    const firstKey = segmentCache.keys().next().value;
    segmentCache.delete(firstKey);
  }
  segmentCache.set(key, {
    data,
    headers,
    time: Date.now()
  });
}

function getCache(key) {
  const item = segmentCache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) {
    segmentCache.delete(key);
    return null;
  }
  return item;
}

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("✅ DASH Proxy with RAM Cache is running");
});

// =========================
// FULL DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const auth =
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
      ? `${upstreamBase}${path}&${auth}`
      : `${upstreamBase}${path}?${auth}`;

  const cacheKey = `${channelId}:${path}`;

  try {
    // =========================
    // SEGMENT CACHE HIT
    // =========================
    if (!path.endsWith(".mpd")) {
      const cached = getCache(cacheKey);
      if (cached) {
        res.set(cached.headers);
        return res.send(cached.data);
      }
    }

    const upstream = await fetch(targetURL, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*"
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).end();
    }

    // =========================
    // MPD (NO CACHE)
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBase =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${proxyBase}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // SEGMENTS (.m4s / .mp4)
    // =========================
    const buffer = Buffer.from(await upstream.arrayBuffer());

    const headers = {
      "Content-Type": upstream.headers.get("content-type") || "video/iso.segment",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    };

    setCache(cacheKey, buffer, headers);

    res.set(headers);
    res.send(buffer);

  } catch (err) {
    console.error("❌ DASH error:", err.message);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🚀 DASH Proxy with RAM cache running on ${PORT}`);
});
