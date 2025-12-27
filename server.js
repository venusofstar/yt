/**
 * Fully Optimized DASH Proxy
 * Features:
 * - Origin rotation
 * - startNumber, IASHttpSessionId, usersessionid rotation
 * - m4s_min bypassed for player
 * - Keep-alive for fast segment fetch
 * - Minimal buffering
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
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 500 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 500 });

/* =========================
   ORIGIN ROTATION
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
   Session Rotation
========================= */
const sessions = new Map(); // IP → session cache

function rotateStartNumber() {
  const base = 46489952;
  const step = 6;
  return base + Math.floor(Math.random() * 100000) * step;
}

function rotateIAS() {
  return "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
}

function rotateUserSession() {
  return Math.floor(Math.random() * 1e15).toString();
}

function getSession(ip) {
  const TTL = 60_000; // 60s cache
  if (!sessions.has(ip) || Date.now() - sessions.get(ip).ts > TTL) {
    sessions.set(ip, {
      ts: Date.now(),
      startNumber: rotateStartNumber(),
      IAS: rotateIAS(),
      user: rotateUserSession()
    });
  }
  return sessions.get(ip);
}

/* =========================
   Routes
========================= */
app.get("/", (_, res) => res.send("✅ DASH Proxy Running"));

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();
  const s = getSession(req.ip);

  const upstreamBase = `${origin}/001/2/ch0000009099000000${channelId}/`;

  // ⚡ Must keep m4s_min=1 for origin
  const originAuth =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` + // required
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
      agent: targetURL.startsWith("https") ? httpsAgent : httpAgent,
      headers: { "User-Agent": req.headers["user-agent"] || "OTT", "Accept": "*/*" }
    });

    if (!upstream.ok) return res.sendStatus(upstream.status);

    // =========================
    // MPD → bypass m4s_min for player
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

      // Remove existing BaseURL and inject proxy URL
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${baseURL}</BaseURL>`);

      // ⚡ Bypass m4s_min for the player
      mpd = mpd.replace(/&m4s_min=1/g, "");

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      return res.send(mpd);
    }

    // =========================
    // Segments
    // =========================
    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("DASH Proxy Error:", err.message);
    res.sendStatus(502);
  }
});

/* =========================
   Start Server
========================= */
app.listen(PORT, () => console.log(`🚀 DASH Proxy running on port ${PORT}`));
