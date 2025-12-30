const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { PassThrough } = require("stream");

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
  "http://143.44.136.67:6060",
  "http://136.239.158.18:6610"
];

// =========================
// AUTHINFO GENERATOR (EXACT FORMAT)
// Base64 with == padding, only padding URL-encoded -> %3D%3D
// =========================
function generateAuthInfo() {
  // 48 bytes -> base64 length 64 chars -> ends with ==
  const base64 = crypto.randomBytes(48).toString("base64");
  return base64.replace(/==$/, "%3D%3D");
}

// =========================
// PER-CHANNEL SESSION
// =========================
const channelSessions = new Map();

function createSession(channelId) {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),

    startNumber: 46489952,

    IAS: "RR" + Date.now() + crypto.randomBytes(4).toString("hex"),
    userSession: crypto.randomBytes(8).toString("hex"),

    ztecid: `ch0000009099000000${channelId}${Math.floor(
      Math.random() * 9000 + 1000
    )}`,

    started: false
  };
}

function getSession(channelId) {
  if (!channelSessions.has(channelId)) {
    channelSessions.set(channelId, createSession(channelId));
  }
  return channelSessions.get(channelId);
}

function rotateOrigin(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

// cleanup every 10 minutes
setInterval(() => channelSessions.clear(), 10 * 60 * 1000);

// =========================
// FETCH WITH STICKY ORIGIN
// =========================
async function fetchSticky(urlBuilder, req, session) {
  for (let attempt = 0; attempt < ORIGINS.length; attempt++) {
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

    } catch (err) {
      console.error("⚠️ Origin failed:", origin, err.message);
      rotateOrigin(session);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  throw new Error("All origins failed");
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("Enjoy your life");
});

// =========================
// DASH / HLS PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const isMPD = path.endsWith(".mpd");
  const isSegment = !isMPD;

  if (isSegment) {
    if (!session.started) {
      session.started = true;
      console.log(`▶️ Playback started for channel ${channelId}`);
    }
    session.startNumber += 6;
  }

  // 🔁 AuthInfo auto-generated like session/user IDs
  const authInfo = generateAuthInfo();

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.comvideoid` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.userSession}` +
    `&ztecid=${session.ztecid}` +
    `&AuthInfo=${authInfo}`;

  try {
    const upstream = await fetchSticky(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?")
        ? `${base}${path}&${authParams}`
        : `${base}${path}?${authParams}`;
    }, req, session);

    // =========================
    // MPD
    // =========================
    if (isMPD) {
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

    // =========================
    // SEGMENTS
    // =========================
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    const proxyStream = new PassThrough();
    proxyStream.pipe(res);

    let lastChunk = Date.now();
    const STALL_LIMIT = 3000;

    const stallTimer = setInterval(() => {
      if (Date.now() - lastChunk > STALL_LIMIT) {
        console.warn("⚠️ Segment stall detected, rotating origin...");
        rotateOrigin(session);
        upstream.body.destroy();
      }
    }, 500);

    upstream.body.on("data", chunk => {
      lastChunk = Date.now();
      proxyStream.write(chunk);
    });

    upstream.body.on("end", () => {
      clearInterval(stallTimer);
      proxyStream.end();
    });

    upstream.body.on("error", err => {
      console.warn("⚠️ Stream error:", err.message);
      rotateOrigin(session);
      proxyStream.end();
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
  console.log(`✅ DASH/HLS proxy running on port ${PORT}`);
});
