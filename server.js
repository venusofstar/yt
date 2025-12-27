const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");
const { pipeline } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// KEEP-ALIVE AGENTS (CRITICAL)
// =========================
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  keepAliveMsecs: 30000
});

// =========================
// ORIGIN ROTATION (1 MINUTE)
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
let lastRotateTime = Date.now();
const ROTATE_INTERVAL = 60 * 1000; // 1 minute

const getOrigin = () => {
  const now = Date.now();

  if (now - lastRotateTime >= ROTATE_INTERVAL) {
    originIndex = (originIndex + 1) % ORIGINS.length;
    lastRotateTime = now;
  }

  return ORIGINS[originIndex];
};

// =========================
// AUTH ROTATION
// =========================
const rotateStartNumber = () =>
  46489952 + Math.floor(Math.random() * 100000) * 6;

const rotateIAS = () =>
  "RR" + Date.now() + Math.random().toString(36).slice(2, 10);

const rotateUserSession = () =>
  Math.floor(Math.random() * 1e15).toString();

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH MPD → MPD Proxy (BUFFER OPTIMIZED)");
});

// =========================
// DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

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
      return res.status(upstream.status).end();
    }

    // =========================
    // MPD HANDLING
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
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // SEGMENTS
    // =========================
    res.status(200);
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=1",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    pipeline(upstream.body, res, err => {
      if (err) res.destroy();
    });

  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ Optimized DASH proxy running on port ${PORT}`);
});
