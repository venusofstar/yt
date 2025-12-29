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
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// =========================
// ORIGINS
// =========================
const ORIGINS = [
  "http://143.44.136.67:6060",
  "http://136.239.158.18:6610"
];

// =========================
// AUTHINFO POOL (ROTATE ANY ONE)
// =========================
const AUTHINFO_POOL = [
  "AuthInfo_VALUE_1",
  "AuthInfo_VALUE_2",
  "AuthInfo_VALUE_3"
];

function getRandomAuthInfo() {
  return AUTHINFO_POOL[Math.floor(Math.random() * AUTHINFO_POOL.length)];
}

// =========================
// SESSION (ROTATE EVERYTHING)
// =========================
function createSession(channelId) {
  return {
    origin: ORIGINS[Math.floor(Math.random() * ORIGINS.length)],
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    ztecid: `ch0000009099000000${channelId}`
  };
}

// =========================
// SINGLE FETCH (NO RETRY)
// =========================
async function fetchOnce(url, req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const res = await fetch(url, {
    agent: url.startsWith("https") ? httpsAgent : httpAgent,
    headers: {
      "User-Agent": req.headers["user-agent"] || "OTT",
      "Accept": "*/*"
    },
    signal: controller.signal
  });

  clearTimeout(timeout);
  if (!res.ok) throw new Error("UPSTREAM_FAIL");
  return res;
}

// =========================
// ROUTES
// =========================
app.get("/", (_, res) => res.send("Enjoy your life"));

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

  // 🔥 NEW ROTATION EVERY REQUEST
  const session = createSession(channelId);
  const authInfo = getRandomAuthInfo();

  const authParams =
    `AuthInfo=${authInfo}` +
    `&JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&NeedJITP=1` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.userSession}` +
    `&ztecid=${session.ztecid}`;

  const base = `${session.origin}/001/2/ch0000009099000000${channelId}/`;
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
        "Cache-Control": "no-store"
      });

      return res.send(mpd);
    }

    res.set({
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store"
    });

    upstream.body.pipe(res);

  } catch {
    // ❌ HARD FAIL → PLAYER AUTO RELOAD
    res.status(502).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Random AuthInfo rotation running on ${PORT}`);
});
