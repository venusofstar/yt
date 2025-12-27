/**
 * DASH Streaming Proxy
 * Node.js + Express
 * Optimized for Railway deployment
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

/* =========================
   Keep-Alive Agents
========================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

/* =========================
   Origin Rotation
========================= */
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

let originIndex = 0;
const getOrigin = () => ORIGINS[originIndex++ % ORIGINS.length];

/* =========================
   Session Pinning
========================= */
const sessions = new Map();

function newSession() {
  return {
    ts: Date.now(),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    user: Math.floor(Math.random() * 1e15).toString()
  };
}

function getSession(ip) {
  const TTL = 60_000; // 60 seconds
  if (!sessions.has(ip) || Date.now() - sessions.get(ip).ts > TTL) {
    sessions.set(ip, newSession());
  }
  return sessions.get(ip);
}

/* =========================
   Home
========================= */
app.get("/", (req, res) => {
  res.send("✅ DASH MPD Proxy running");
});

/* =========================
   DASH Proxy (MPD + Segments)
========================= */
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();
  const s = getSession(req.ip);

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${s.startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${s.IAS}` +
    `&usersessionid=${s.user}`;

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

  try {
    const upstream = await fetch(targetURL, {
      agent: targetURL.startsWith("https") ? httpsAgent : httpAgent,
      headers: { "User-Agent": req.headers["user-agent"] || "OTT", "Accept": "*/*" },
      timeout: 15000
    });

    if (!upstream.ok) return res.status(upstream.status).end();

    /* ===== MPD ===== */
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${baseURL}</BaseURL>`);

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    /* ===== Segments (.m4s/.mp4) ===== */
    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("DASH Proxy Error:", err.message);
    res.status(502).end();
  }
});

/* =========================
   Start Server
========================= */
app.listen(PORT, () => {
  console.log(`🚀 DASH proxy running on port ${PORT}`);
});
