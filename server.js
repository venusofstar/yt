const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const agent = new http.Agent({ keepAlive: true, maxSockets: 500 });

/* =========================
   ORIGIN ROTATION
========================= */
const ORIGINS = [
  "http://136.239.158.18:6610",
  "http://136.239.158.20:6610",
  "http://136.239.158.30:6610",
  "http://136.239.173.3:6610"
];

let idx = 0;
const getOrigin = () => ORIGINS[idx++ % ORIGINS.length];

/* =========================
   SESSION PINNING
========================= */
const sessions = new Map();

function newSession() {
  return {
    ts: Date.now(),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2),
    user: Math.floor(Math.random() * 1e15).toString()
  };
}

function getSession(ip) {
  if (!sessions.has(ip) || Date.now() - sessions.get(ip).ts > 60000) {
    sessions.set(ip, newSession());
  }
  return sessions.get(ip);
}

/* =========================
   ROUTES
========================= */
app.get("/", (_, res) => res.send("✅ DASH Proxy Running"));

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();
  const s = getSession(req.ip);

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  /* 🔐 REQUIRED FOR ORIGIN (DO NOT REMOVE) */
  const originAuth =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +                 // ✅ MUST EXIST
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${s.startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${s.IAS}` +
    `&usersessionid=${s.user}`;

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${originAuth}`
      : `${upstreamBase}${path}?${originAuth}`;

  try {
    const upstream = await fetch(targetURL, {
      agent,
      headers: { "User-Agent": "OTT", "Accept": "*/*" }
    });

    if (!upstream.ok) return res.sendStatus(upstream.status);

    /* =========================
       MPD BYPASS LOGIC
    ========================= */
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const baseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      // Remove BaseURL
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${baseURL}</BaseURL>`);

      // 🔥 BYPASS m4s_min FOR PLAYER
      mpd = mpd.replace(/&m4s_min=1/g, "");

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    /* =========================
       SEGMENTS
    ========================= */
    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes"
    });

    upstream.body.pipe(res);

  } catch (e) {
    console.error("Proxy error:", e.message);
    res.sendStatus(502);
  }
});

app.listen(PORT, () =>
  console.log(`🚀 DASH proxy listening on ${PORT}`)
);
