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
// PER-CHANNEL SESSION
// =========================
const channelSessions = new Map();

function createSession() {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    lastSegment: null,
    repeatCount: 0
  };
}

function getSession(channelId) {
  if (!channelSessions.has(channelId)) {
    channelSessions.set(channelId, createSession());
  }
  return channelSessions.get(channelId);
}

// =========================
// HARD ROTATION (FULL RESET)
// =========================
function hardRotate(session, reason = "unknown") {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;

  // jump far ahead → fresh live window
  session.startNumber += 6 * (5 + Math.floor(Math.random() * 5));

  // regenerate session IDs
  session.IAS = "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
  session.userSession = Math.floor(Math.random() * 1e15).toString();

  // reset loop detection
  session.lastSegment = null;
  session.repeatCount = 0;

  console.log("🔥 HARD ROTATE:", reason, {
    origin: session.originIndex,
    startNumber: session.startNumber
  });
}

// cleanup every 10 min
setInterval(() => channelSessions.clear(), 10 * 60 * 1000);

// =========================
// FETCH WITH STICKY ORIGIN
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

      if ([403, 404, 410].includes(res.status)) {
        throw new Error("Hard fail " + res.status);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return res;
    } catch (err) {
      console.error("⚠️ ORIGIN FAIL:", origin);
      hardRotate(session, "origin-fail");
    }
  }
  throw new Error("All origins failed");
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH Proxy (Hard Rotate + No Cache)");
});

// =========================
// DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  // =========================
  // REPEATED SEGMENT DETECTOR
  // =========================
  if (path.endsWith(".m4s")) {
    const match = path.match(/(\d+)\.m4s/);
    if (match) {
      const seg = Number(match[1]);
      if (session.lastSegment === seg) {
        session.repeatCount++;
        if (session.repeatCount >= 2) {
          hardRotate(session, "segment-loop");
        }
      } else {
        session.lastSegment = seg;
        session.repeatCount = 0;
      }
    }
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
      const base =
        `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${authParams}`
        : `${base}${path}?${authParams}`;
    }, req, session);

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
        "Expires": "0",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // SEGMENTS
    // =========================
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    let lastChunk = Date.now();
    const STALL_LIMIT = 5000;

    const stallTimer = setInterval(() => {
      if (Date.now() - lastChunk > STALL_LIMIT) {
        hardRotate(session, "segment-stall");
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
    console.error("❌ PROXY ERROR:", err.message);
    hardRotate(session, "fatal-error");
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH proxy running on port ${PORT}`);
});
