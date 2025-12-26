/**
 * FAST & SMOOTH DASH MPD + SEGMENT PROXY
 * Optimized for low buffering & stability
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   BASIC MIDDLEWARE
========================= */
app.use(cors());

/* =========================
   HTTP KEEP-ALIVE AGENTS
========================= */
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
  timeout: 60000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 200,
  timeout: 60000
});

/* =========================
   ORIGIN ROTATION
========================= */
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
  const origin = ORIGINS[originIndex];
  originIndex = (originIndex + 1) % ORIGINS.length;
  return origin;
}

/* =========================
   SESSION PINNING (IMPORTANT)
========================= */
const sessionCache = new Map();

function createSession() {
  return {
    created: Date.now(),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    user: Math.floor(Math.random() * 1e15).toString()
  };
}

function getSession(ip) {
  const TTL = 60_000; // 60 seconds
  if (!sessionCache.has(ip) || Date.now() - sessionCache.get(ip).created > TTL) {
    sessionCache.set(ip, createSession());
  }
  return sessionCache.get(ip);
}

/* =========================
   HOME
========================= */
app.get("/", (req, res) => {
  res.send("✅ DASH MPD → MPD Proxy running (FAST MODE)");
});

/* =========================
   DASH PROXY (MPD + SEGMENTS)
========================= */
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();
  const session = getSession(req.ip);

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.user}`;

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

  try {
    const upstream = await fetch(targetURL, {
      agent: targetURL.startsWith("https") ? httpsAgent : httpAgent,
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      },
      timeout: 15000
    });

    if (!upstream.ok) {
      console.error("❌ Upstream error:", upstream.status);
      return res.status(upstream.status).end();
    }

    /* =========================
       MPD HANDLING
    ========================= */
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBaseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      // Remove ALL BaseURL entries
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");

      // Inject proxy BaseURL
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Connection": "keep-alive"
      });

      return res.send(mpd);
    }

    /* =========================
       MEDIA SEGMENTS
    ========================= */
    res.status(upstream.status);
    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Connection": "keep-alive"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err.message);
    res.status(502).end();
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`✅ FAST DASH Proxy running on port ${PORT}`);
});
