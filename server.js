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
// KEEP-ALIVE AGENTS
// =========================
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 200,
  keepAliveMsecs: 30000
});

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
const getOrigin = () =>
  ORIGINS[(originIndex = (originIndex + 1) % ORIGINS.length)];

const MAX_RETRIES = ORIGINS.length;

// =========================
// PER-CHANNEL SESSION (CRITICAL FIX)
// =========================
const channelSessions = new Map();

function getChannelSession(channelId) {
  if (!channelSessions.has(channelId)) {
    channelSessions.set(channelId, {
      startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
      IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
      userSession: Math.floor(Math.random() * 1e15).toString()
    });
  }
  return channelSessions.get(channelId);
}

// cleanup every 10 minutes (prevents expiry issues)
setInterval(() => {
  channelSessions.clear();
}, 10 * 60 * 1000);

// =========================
// FETCH WITH ORIGIN RETRY
// =========================
async function fetchWithRetry(urlBuilder, req) {
  let lastError;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const origin = getOrigin();
    const url = urlBuilder(origin);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const upstream = await fetch(url, {
        agent: url.startsWith("https") ? httpsAgent : httpAgent,
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*",
          "Connection": "keep-alive"
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!upstream.ok) {
        lastError = `HTTP ${upstream.status}`;
        continue;
      }

      return upstream;
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || "All origins failed");
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH Proxy (NO LOOP / AUTO ORIGIN)");
});

// =========================
// DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getChannelSession(channelId);

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${session.startNumber}` + // ✅ STABLE
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchWithRetry(origin => {
      const base =
        `${origin}/001/2/ch0000009099000000${channelId}/`;

      return path.includes("?")
        ? `${base}${path}&${authParams}`
        : `${base}${path}?${authParams}`;
    }, req);

    // =========================
    // MPD
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
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    let lastChunk = Date.now();
    const STALL_LIMIT = 5000;

    const stallTimer = setInterval(() => {
      if (Date.now() - lastChunk > STALL_LIMIT) {
        upstream.body.destroy();
        res.destroy();
      }
    }, 1000);

    upstream.body.on("data", () => {
      lastChunk = Date.now();
    });

    pipeline(upstream.body, res, err => {
      clearInterval(stallTimer);
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
  console.log(`✅ DASH proxy running on port ${PORT}`);
});
