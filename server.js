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
// TCP / KEEP-ALIVE
// =========================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 1000 });

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
const sessions = new Map();
const failedSegments = new Map();
const originScore = new Map();

ORIGINS.forEach(o => originScore.set(o, 100));

// =========================
// SESSION
// =========================
function createSession() {
  return {
    origin: ORIGINS[Math.floor(Math.random() * ORIGINS.length)],
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now(),
    userSession: Math.random().toString(36).slice(2),
    avgMs: 800,
    jump: 6
  };
}

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, createSession());
  return sessions.get(id);
}

// =========================
// ORIGIN SELECTION (ERROR ONLY)
// =========================
function bestOrigin() {
  return [...originScore.entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
}

function punish(origin) {
  originScore.set(origin, Math.max(0, originScore.get(origin) - 30));
}

function reward(origin, ms) {
  originScore.set(origin, Math.min(100, originScore.get(origin) + (ms < 1000 ? 3 : 1)));
}

// =========================
// ULTRA FAST FETCH (NO WAIT)
// =========================
async function fetchInstant(build, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    session.origin = bestOrigin();
    const origin = session.origin;
    const url = build(origin);

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000); // 🔥 HARD CUT

      const start = Date.now();
      const res = await fetch(url, {
        agent: origin.startsWith("https") ? httpsAgent : httpAgent,
        headers: { "User-Agent": "OTT" },
        signal: controller.signal
      });

      if (!res.ok) throw 0;
      reward(origin, Date.now() - start);
      return res;

    } catch {
      punish(origin);
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

  // 🔥 NEVER REPEAT
  if (segId && failedSegments.get(channelId)?.has(segId)) {
    session.startNumber += session.jump;
    return res.status(204).end();
  }

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1` +
    `&NeedJITP=1&startNumber=${session.startNumber}&filedura=6` +
    `&IASHttpSessionId=${session.IAS}&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchInstant(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${auth}`
        : `${base}${path}?${auth}`;
    }, session);

    // =========================
    // MPD (LIVE EDGE ONLY)
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${req.protocol}://${req.get("host")}/${channelId}/</BaseURL>`
      );
      mpd = mpd.replace(/timeShiftBufferDepth="PT\d+S"/, 'timeShiftBufferDepth="PT20S"');
      return res.type("application/dash+xml").send(mpd);
    }

    // =========================
    // SEGMENT — ABSOLUTE FINAL
    // =========================
    let bytes = 0;
    const start = Date.now();
    const KILL_TIME = session.avgMs * 1.2;

    const killer = setInterval(() => {
      if (Date.now() - start > KILL_TIME) {
        if (segId) {
          if (!failedSegments.has(channelId))
            failedSegments.set(channelId, new Set());
          failedSegments.get(channelId).add(segId);
          session.jump = Math.min(24, session.jump + 6);
          session.startNumber += session.jump;
        }
        clearInterval(killer);
        upstream.body.destroy();
        return res.status(204).end(); // 🔥 NO BUFFER
      }
    }, 150);

    pipeline(upstream.body, res, err => {
      clearInterval(killer);

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
  console.log("👑🔥 ABSOLUTE FINAL DASH PROXY — ZERO BUFFERING, ZERO WAIT");
});
