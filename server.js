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
// SESSION STATE
// =========================
const sessions = new Map();

function getSession(channelId) {
  if (!sessions.has(channelId)) {
    sessions.set(channelId, {
      originIndex: Math.floor(Math.random() * ORIGINS.length),
      lastSegment: -1,
      streamStarted: false
    });
  }
  return sessions.get(channelId);
}

function rotateOrigin(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

// =========================
// FETCH UPSTREAM
// =========================
async function fetchUpstream(urlBuilder, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    const origin = ORIGINS[session.originIndex];
    try {
      const res = await fetch(urlBuilder(origin), {
        agent: origin.startsWith("https") ? httpsAgent : httpAgent,
        headers: { "User-Agent": "OTT" },
        timeout: 3000
      });
      if (!res.ok) throw new Error();
      rotateOrigin(session); // auto rotate **every successful fetch**
      return res;
    } catch {
      rotateOrigin(session); // also rotate on error
    }
  }
  throw new Error("All origins failed");
}

// =========================
// ROUTE
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const segMatch = path.match(/(\d+)\.(m4s|mp4)/);
  const segNum = segMatch ? parseInt(segMatch[1]) : null;

  // =========================
  // BLOCK REPEATS
  // =========================
  if (segNum !== null && segNum <= session.lastSegment) {
    return res.status(204).end();
  }

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1&NeedJITP=1`;

  try {
    const upstream = await fetchUpstream(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?") ? `${base}${path}&${auth}` : `${base}${path}?${auth}`;
    }, session);

    // =========================
    // MPD
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${req.protocol}://${req.get("host")}/${channelId}/</BaseURL>`
      );
      mpd = mpd.replace(/timeShiftBufferDepth="PT\d+S"/, 'timeShiftBufferDepth="PT15S"');
      mpd = mpd.replace(/minBufferTime="PT\d+(\.\d+)?S"/, 'minBufferTime="PT0.8S"');
      return res.type("application/dash+xml").send(mpd);
    }

    // =========================
    // INIT SEGMENT
    // =========================
    if (path.includes("init")) {
      return pipeline(upstream.body, res, () => {});
    }

    // =========================
    // MEDIA SEGMENT
    // =========================
    let bytes = 0;
    pipeline(upstream.body, res, err => {
      if (!err && bytes > 0 && segNum !== null) {
        session.lastSegment = segNum;
        session.streamStarted = true;
      }
      if (err) {
        rotateOrigin(session);
        return res.status(204).end();
      }
    });
    upstream.body.on("data", c => (bytes += c.length));

  } catch {
    rotateOrigin(session);
    return res.status(204).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log("✅ Live DASH proxy fully optimized — auto-rotate every segment, no repeat, forward-only");
});
