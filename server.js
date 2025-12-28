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
  "http://136.239.158.20:6610",
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
      originIndex: Math.floor(Math.random() * ORIGINS.length),
      startNumber: null, // IMPORTANT
      firstSegmentOK: false
    });
  }
  return sessions.get(id);
}

function rotate(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

// =========================
// FETCH
// =========================
async function fetchWithRotate(build, req, session) {
  for (let i = 0; i < ORIGINS.length; i++) {
    const origin = ORIGINS[session.originIndex];
    try {
      const res = await fetch(build(origin), {
        agent: origin.startsWith("https") ? httpsAgent : httpAgent,
        headers: { "User-Agent": req.headers["user-agent"] || "OTT" },
        timeout: 8000
      });
      if (!res.ok) throw new Error();
      return res;
    } catch {
      rotate(session);
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

  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1&NeedJITP=1`;

  try {
    const upstream = await fetchWithRotate(origin => {
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

      // 🔥 Extract real startNumber ONCE
      if (session.startNumber === null) {
        const m = mpd.match(/startNumber="(\d+)"/);
        if (m) session.startNumber = parseInt(m[1]);
      }

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${req.protocol}://${req.get("host")}/${channelId}/</BaseURL>`
      );

      // Player-friendly
      mpd = mpd.replace(/minBufferTime="PT\d+(\.\d+)?S"/, 'minBufferTime="PT1S"');

      return res.type("application/dash+xml").send(mpd);
    }

    // =========================
    // INIT SEGMENT (NEVER SKIP)
    // =========================
    if (path.includes("init")) {
      return pipeline(upstream.body, res, () => {});
    }

    // =========================
    // MEDIA SEGMENT
    // =========================
    let received = false;
    let bytes = 0;
    const start = Date.now();

    const killer = setTimeout(() => {
      if (!received && session.firstSegmentOK) {
        rotate(session);
        return res.status(204).end(); // SKIP ONLY AFTER START
      }
    }, 2500);

    upstream.body.on("data", c => {
      received = true;
      bytes += c.length;
    });

    pipeline(upstream.body, res, err => {
      clearTimeout(killer);

      if (!err && bytes > 0) {
        session.firstSegmentOK = true; // 🔥 STREAM IS LIVE
      }

      if (err || bytes === 0) {
        if (session.firstSegmentOK) {
          rotate(session);
          return res.status(204).end();
        }
      }
    });

  } catch {
    return res.status(204).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("✅ DASH proxy FIXED — stream starts instantly");
});
