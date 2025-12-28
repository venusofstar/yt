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
// ORIGINS
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

// =========================
// SESSION STATE
// =========================
const channelSessions = new Map();
const failedSegments = new Map();

function createSession() {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString()
  };
}

function getSession(channelId) {
  if (!channelSessions.has(channelId)) {
    channelSessions.set(channelId, createSession());
  }
  return channelSessions.get(channelId);
}

function rotateOrigin(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

function markSegmentFailed(channelId, segmentId) {
  if (!failedSegments.has(channelId)) {
    failedSegments.set(channelId, new Set());
  }
  failedSegments.get(channelId).add(segmentId);
}

function isSegmentFailed(channelId, segmentId) {
  return failedSegments.has(channelId) &&
         failedSegments.get(channelId).has(segmentId);
}

// =========================
// 🔄 GLOBAL ROTATION (EVERY 15s)
// =========================
setInterval(() => {
  for (const session of channelSessions.values()) {
    rotateOrigin(session);
  }
  console.log("🔄 Global origin rotation (15s)");
}, 15000);

// Cleanup
setInterval(() => {
  channelSessions.clear();
  failedSegments.clear();
}, 10 * 60 * 1000);

// =========================
// FETCH WITH ROTATION
// =========================
async function fetchSticky(urlBuilder, req, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    const origin = ORIGINS[session.originIndex];
    const url = urlBuilder(origin);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        agent: url.startsWith("https") ? httpsAgent : httpAgent,
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*",
          "Connection": "keep-alive"
        },
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;

    } catch {
      rotateOrigin(session);
    }
  }
  throw new Error("All origins failed");
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH Proxy – Global 15s Rotation Enabled");
});

// =========================
// DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const segmentMatch = path.match(/(\d+)\.(m4s|mp4)/);
  const segmentId = segmentMatch ? segmentMatch[1] : null;

  if (segmentId && isSegmentFailed(channelId, segmentId)) {
    session.startNumber += 6;
    rotateOrigin(session);
    return res.status(204).end();
  }

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
    `&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchSticky(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${authParams}`
        : `${base}${path}?${authParams}`;
    }, req, session);

    // MPD
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const proxyBase = `${req.protocol}://${req.get("host")}/${channelId}/`;

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

    // SEGMENTS
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    let lastChunk = Date.now();
    let bytes = 0;
    const STALL_LIMIT = 4000;

    const stallTimer = setInterval(() => {
      if (Date.now() - lastChunk > STALL_LIMIT) {
        if (segmentId) {
          markSegmentFailed(channelId, segmentId);
          session.startNumber += 6;
        }
        rotateOrigin(session);
        upstream.body.destroy();
        res.destroy();
      }
    }, 1000);

    upstream.body.on("data", chunk => {
      bytes += chunk.length;
      lastChunk = Date.now();
    });

    pipeline(upstream.body, res, err => {
      clearInterval(stallTimer);
      if (err || bytes === 0) {
        if (segmentId) {
          markSegmentFailed(channelId, segmentId);
          session.startNumber += 6;
        }
        rotateOrigin(session);
        res.destroy();
      }
    });

  } catch {
    res.status(502).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH proxy running on port ${PORT}`);
});
