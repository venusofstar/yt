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
// KEEP ALIVE
// =========================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// =========================
// ORIGINS
// =========================
const ORIGINS = [
  "http://136.239.158.18:6610",
  "http://136.239.158.158:6610",
  "http://136.239.158.30:6610",
  "http://136.239.173.3:6610",
  "http://136.158.97.2:6610",
  "http://136.239.173.10:6610",
  "http://136.239.158.10:6610",
  "http://136.239.159.20:6610"
];

// =========================
// SESSION
// =========================
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      originIndex: 0,
      firstSegmentOK: false,
      lockOrigin: true,
      lastRotate: Date.now()
    });
  }
  return sessions.get(id);
}

// =========================
// ROTATE EVERY 1 SECOND
// =========================
function maybeRotate(session) {
  if (session.lockOrigin) return;

  if (Date.now() - session.lastRotate >= 1000) {
    session.originIndex = (session.originIndex + 1) % ORIGINS.length;
    session.lastRotate = Date.now();
  }
}

// =========================
// FETCH
// =========================
async function fetchRotating(build, req, session) {
  maybeRotate(session);

  const origin = ORIGINS[session.originIndex];
  return fetch(build(origin), {
    agent: origin.startsWith("https") ? httpsAgent : httpAgent,
    headers: { "User-Agent": req.headers["user-agent"] || "OTT" },
    timeout: 5000
  });
}

// =========================
// ROUTE
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1&NeedJITP=1`;

  try {
    const upstream = await fetchRotating(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${auth}`
        : `${base}${path}?${auth}`;
    }, req, session);

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

      return res.type("application/dash+xml").send(mpd);
    }

    // =========================
    // INIT SEGMENT (LOCK)
    // =========================
    if (path.includes("init")) {
      session.lockOrigin = true;
      return pipeline(upstream.body, res, () => {});
    }

    // =========================
    // MEDIA SEGMENTS
    // =========================
    let bytes = 0;

    pipeline(upstream.body, res, err => {
      if (!err && bytes > 0 && !session.firstSegmentOK) {
        session.firstSegmentOK = true;
        session.lockOrigin = false; // 🔓 allow rotation
      }
      if (err) return res.status(204).end();
    });

    upstream.body.on("data", c => (bytes += c.length));

  } catch {
    return res.status(204).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("✅ DASH proxy — rotating origins every 1 second (safe)");
});
