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
// SESSION (PER CHANNEL)
// =========================
const sessions = new Map();

function createSession() {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    lastSegmentTime: Date.now()
  };
}

function getSession(channelId) {
  if (!sessions.has(channelId)) {
    sessions.set(channelId, createSession());
  }
  return sessions.get(channelId);
}

function rotateOrigin(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

// cleanup
setInterval(() => sessions.clear(), 10 * 60 * 1000);

// =========================
// FETCH WITH HARD FAIL
// =========================
async function fetchOrigin(urlBuilder, req, session) {
  const origin = ORIGINS[session.originIndex];
  const url = urlBuilder(origin);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const res = await fetch(url, {
    agent: url.startsWith("https") ? httpsAgent : httpAgent,
    headers: {
      "User-Agent": req.headers["user-agent"] || "OTT",
      "Accept": "*/*"
    },
    signal: controller.signal
  });

  clearTimeout(timeout);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// =========================
// ROUTE
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const session = getSession(channelId);

  const auth =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.userSession}`;

  try {
    const upstream = await fetchOrigin(origin => {
      const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
      return path.includes("?") ? `${base}${path}&${auth}` : `${base}${path}?${auth}`;
    }, req, session);

    // ===== MPD =====
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const proxyBase = `${req.protocol}://${req.get("host")}/${channelId}/`;
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${proxyBase}</BaseURL>`);
      res.set("Content-Type", "application/dash+xml");
      return res.send(mpd);
    }

    // ===== SEGMENT =====
    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    let receivedData = false;
    const STALL_LIMIT = 4000;

    const stallTimer = setTimeout(() => {
      // 🚨 HARD FAIL ON STALL
      rotateOrigin(session);
      upstream.body.destroy();
      res.status(502).end();
    }, STALL_LIMIT);

    upstream.body.on("data", () => {
      receivedData = true;
      session.lastSegmentTime = Date.now();
      clearTimeout(stallTimer);
    });

    pipeline(upstream.body, res, err => {
      clearTimeout(stallTimer);
      if (!receivedData || err) {
        rotateOrigin(session);
        res.status(502).end();
      }
    });

  } catch (err) {
    rotateOrigin(session);
    res.status(502).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH proxy running on ${PORT}`);
});
