const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");
const { pipeline } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// =========================
// KEEP ALIVE AGENTS
// =========================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 500 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 500 });

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
// STATE
// =========================
const channelSessions = new Map();
const failedSegments = new Map();
const originHealth = new Map();

ORIGINS.forEach(o =>
  originHealth.set(o, { score: 100 })
);

// =========================
// SESSION
// =========================
function createSession() {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now(),
    userSession: Math.random().toString(36).slice(2),
    avgMs: 1000,
    jump: 6
  };
}

function getSession(id) {
  if (!channelSessions.has(id))
    channelSessions.set(id, createSession());
  return channelSessions.get(id);
}

// =========================
// ORIGIN CONTROL (ERROR ONLY)
// =========================
function bestOrigin(session) {
  const best = [...originHealth.entries()]
    .sort((a, b) => b[1].score - a[1].score)[0][0];
  session.originIndex = ORIGINS.indexOf(best);
}

function penalize(origin) {
  originHealth.get(origin).score -= 25;
}

// =========================
// FETCH (NO WAITING)
// =========================
async function fetchFast(build, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    bestOrigin(session);
    const origin = ORIGINS[session.originIndex];
    const url = build(origin);

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000); // 🔥 HARD CUT

      const res = await fetch(url, {
        agent: origin.startsWith("https") ? httpsAgent : httpAgent,
        headers: { "User-Agent": "OTT" },
        signal: controller.signal
      });

      if (!res.ok) throw 0;
      return res;

    } catch {
      penalize(origin);
    }
  }
  throw 0;
}

// =========================
// ROUTE
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const segMatch = path.match(/(\d+)\.(m4s|mp4)/);
  const segId = segMatch?.[1];

  // 🔥 NEVER REPEAT A FAILED SEGMENT
  if (segId && failedSegments.get(channelId)?.has(segId)) {
    session.startNumber += session.jump;
    return res.status(204).end();
  }

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1` +
    `&NeedJITP=1&startNumber=${session.startNumber}&filedura=6` +
    `&IASHttpSessionId=${session.IAS}&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchFast(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${auth}`
        : `${base}${path}?${auth}`;
    }, session);

    // =========================
    // MPD (LIVE ONLY)
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${req.protocol}://${req.get("host")}/${channelId}/</BaseURL>`
      );
      mpd = mpd.replace(/timeShiftBufferDepth="PT\d+S"/, 'timeShiftBufferDepth="PT25S"');
      return res.type("application/dash+xml").send(mpd);
    }

    // =========================
    // SEGMENT – ZERO BUFFERING
    // =========================
    let bytes = 0;
    const start = Date.now();
    const MAX_TIME = session.avgMs * 1.3;

    const kill = setInterval(() => {
      if (Date.now() - start > MAX_TIME) {
        if (segId) {
          if (!failedSegments.has(channelId))
            failedSegments.set(channelId, new Set());
          failedSegments.get(channelId).add(segId);
          session.jump = Math.min(18, session.jump + 6);
          session.startNumber += session.jump;
        }
        clearInterval(kill);
        upstream.body.destroy();
        return res.status(204).end(); // 🔥 IMMEDIATE SKIP
      }
    }, 200);

    pipeline(upstream.body, res, err => {
      clearInterval(kill);
      if (err || bytes === 0) {
        if (segId) {
          failedSegments.get(channelId)?.add(segId);
          session.startNumber += session.jump;
        }
        return res.status(204).end();
      }
      session.avgMs = session.avgMs * 0.7 + (Date.now() - start) * 0.3;
      session.jump = 6;
    });

    upstream.body.on("data", c => (bytes += c.length));

  } catch {
    session.startNumber += session.jump;
    return res.status(204).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("💀🔥 ULTRA BOSS — ZERO BUFFERING MODE ACTIVE");
});
