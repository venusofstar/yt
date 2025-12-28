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
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 300 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 300 });

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
// GLOBAL STATE
// =========================
const channelSessions = new Map();
const failedSegments = new Map();
const originHealth = new Map();

ORIGINS.forEach(o => originHealth.set(o, { score: 100, fail: 0, latency: 1200 }));

// =========================
// SESSION
// =========================
function createSession() {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    avgMs: 1200,
    jump: 6
  };
}

function getSession(id) {
  if (!channelSessions.has(id)) channelSessions.set(id, createSession());
  return channelSessions.get(id);
}

// =========================
// ORIGIN SELECTION
// =========================
function bestOrigin(session) {
  const ranked = ORIGINS
    .map(o => ({ o, s: originHealth.get(o).score }))
    .sort((a, b) => b.s - a.s);

  session.originIndex = ORIGINS.indexOf(ranked[0].o);
}

function penalize(origin) {
  const h = originHealth.get(origin);
  h.score = Math.max(0, h.score - 20);
  h.fail++;
}

function reward(origin, ms) {
  const h = originHealth.get(origin);
  h.latency = h.latency * 0.7 + ms * 0.3;
  h.score = Math.min(100, h.score + 2);
}

// =========================
// GLOBAL ROTATION (15s)
// =========================
setInterval(() => {
  for (const s of channelSessions.values()) bestOrigin(s);
}, 15000);

// Cleanup
setInterval(() => {
  channelSessions.clear();
  failedSegments.clear();
}, 10 * 60 * 1000);

// =========================
// FETCH
// =========================
async function fetchSticky(build, req, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    const origin = ORIGINS[session.originIndex];
    const url = build(origin);
    const start = Date.now();

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        agent: url.startsWith("https") ? httpsAgent : httpAgent,
        headers: { "User-Agent": "OTT", "Connection": "keep-alive" },
        signal: controller.signal
      });

      clearTimeout(t);
      if (!res.ok) throw new Error(res.status);

      reward(origin, Date.now() - start);
      return res;

    } catch {
      penalize(origin);
      session.originIndex = (session.originIndex + 1) % ORIGINS.length;
    }
  }
  throw new Error("All origins dead");
}

// =========================
// ROUTE
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const segMatch = path.match(/(\d+)\.(m4s|mp4)/);
  const segId = segMatch ? segMatch[1] : null;

  if (segId && failedSegments.get(channelId)?.has(segId)) {
    session.startNumber += session.jump;
    return res.status(204).end();
  }

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1` +
    `&NeedJITP=1&startNumber=${session.startNumber}&filedura=6` +
    `&IASHttpSessionId=${session.IAS}&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchSticky(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?") ? `${base}${path}&${auth}` : `${base}${path}?${auth}`;
    }, req, session);

    // =========================
    // MPD (LIVE EDGE TRIM)
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${req.protocol}://${req.get("host")}/${channelId}/</BaseURL>`
      );
      mpd = mpd.replace(/timeShiftBufferDepth="PT\d+S"/, 'timeShiftBufferDepth="PT30S"');

      res.set("Content-Type", "application/dash+xml");
      return res.send(mpd);
    }

    // =========================
    // SEGMENT (PREDICTIVE + ADAPTIVE JUMP)
    // =========================
    let bytes = 0;
    const start = Date.now();
    const predictLimit = session.avgMs * 1.6;

    const killer = setInterval(() => {
      if (Date.now() - start > predictLimit) {
        if (segId) {
          if (!failedSegments.has(channelId)) failedSegments.set(channelId, new Set());
          failedSegments.get(channelId).add(segId);
          session.jump = Math.min(18, session.jump + 6);
          session.startNumber += session.jump;
        }
        upstream.body.destroy();
        res.destroy();
      }
    }, 500);

    pipeline(upstream.body, res, err => {
      clearInterval(killer);
      const dur = Date.now() - start;
      session.avgMs = session.avgMs * 0.7 + dur * 0.3;

      if (err || bytes === 0) {
        session.jump = Math.min(18, session.jump + 6);
      } else {
        session.jump = 6;
      }
    });

    upstream.body.on("data", c => (bytes += c.length));

  } catch {
    res.status(502).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("🔥 FINAL BOSS DASH PROXY RUNNING");
});
