const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// KEEP-ALIVE AGENTS
// =========================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

// =========================
// ORIGINS
// =========================
const ORIGINS = [
  "http://143.44.136.67:6060",
  "http://136.239.158.18:6610"
];

// =========================
// PER-CHANNEL SESSION
// =========================
const channelSessions = new Map();

function createSession(channelId) {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    ztecid: `ch0000009099000000${channelId}`, // 🔒 fixed
    authInfo: null
  };
}

function getSession(channelId) {
  const session = createSession(channelId);
  channelSessions.set(channelId, session);
  return session;
}

// =========================
// AUTHINFO (FORCED ROTATION)
// =========================
async function fetchNewAuthInfo(channelId) {
  return "rSpjhsi8YPKuwtVD96LPO9APsXSpK2mq6dZZRgF8v7xYxw0MdBePEXRMFugy%2F7SuAXlR2%2FEFrpiArV%2FBblLcXA%3D%3D";
}

// =========================
// SINGLE-SHOT FETCH (NO RETRY)
// =========================
async function fetchOnce(url, req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

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
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => res.send("Enjoy your life"));

// =========================
// DASH / HLS PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

  // 🔥 FORCE NEW ROTATION EVERY REQUEST
  const session = getSession(channelId);
  session.authInfo = await fetchNewAuthInfo(channelId);

  const authParams =
    `AuthInfo=${session.authInfo}` +
    `&JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.userSession}` +
    `&ztecid=${session.ztecid}`;

  const origin = ORIGINS[session.originIndex];
  const base = `${origin}/001/2/ch0000009099000000${channelId}/`;

  const url = path.includes("?")
    ? `${base}${path}&${authParams}`
    : `${base}${path}?${authParams}`;

  try {
    const upstream = await fetchOnce(url, req);

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

    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    upstream.body.pipe(res);

  } catch (err) {
    // ❌ HARD FAIL → PLAYER MUST RELOAD
    channelSessions.delete(channelId);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🚀 FAST-ROTATION proxy running on port ${PORT}`);
});
