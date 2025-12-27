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
// ORIGIN (NO ROTATION)
// =========================
const ORIGINS = [
  "http://143.44.136.67:6060",
  "http://136.239.158.18:6610"
];

// Always use the first origin
const getOrigin = () => ORIGINS[0];

// =========================
// AUTH ROTATION EVERY 30 SECONDS
// =========================
let currentStartNumber = rotateStartNumber();
let currentIAS = rotateIAS();
let currentUserSession = rotateUserSession();

const rotateAuthValues = () => {
  currentStartNumber = rotateStartNumber();
  currentIAS = rotateIAS();
  currentUserSession = rotateUserSession();
  console.log("🔄 Rotated auth values:", {
    startNumber: currentStartNumber,
    IASHttpSessionId: currentIAS,
    usersessionid: currentUserSession
  });
};

// Rotate every 30 seconds
setInterval(rotateAuthValues, 30_000);

// Rotation functions
function rotateStartNumber() {
  return 46489952 + Math.floor(Math.random() * 100000) * 6;
}

function rotateIAS() {
  return "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
}

function rotateUserSession() {
  return Math.floor(Math.random() * 1e15).toString();
}

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
    `&startNumber=${currentStartNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${currentIAS}` +
    `&usersessionid=${currentUserSession}`;

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
    // SEGMENTS (SMOOTH STREAM)
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
