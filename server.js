/**
 * DASH Streaming Proxy (Optimized)
 */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

/* Keep-alive agents */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

/* Origins */
const ORIGINS = [
  "http://136.239.158.18:6610",
  "http://136.239.158.20:6610",
  "http://136.239.158.30:6610"
];

let index = 0;
const getOrigin = () => ORIGINS[index++ % ORIGINS.length];

/* Session pinning */
const sessions = new Map();
function getSession(ip) {
  const ttl = 60000;
  if (!sessions.has(ip) || Date.now() - sessions.get(ip).ts > ttl) {
    sessions.set(ip, {
      ts: Date.now(),
      start: 46489952 + Math.floor(Math.random() * 100000) * 6,
      ias: "RR" + Date.now() + Math.random().toString(36).slice(2, 8),
      user: Math.floor(Math.random() * 1e15).toString()
    });
  }
  return sessions.get(ip);
}

app.get("/", (_, res) => {
  res.send("✅ DASH Proxy running");
});

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();
  const s = getSession(req.ip);

  const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
  const auth =
    `startNumber=${s.start}` +
    `&IASHttpSessionId=${s.ias}` +
    `&usersessionid=${s.user}`;

  const url = path.includes("?")
    ? `${base}${path}&${auth}`
    : `${base}${path}?${auth}`;

  try {
    const upstream = await fetch(url, {
      agent: url.startsWith("https") ? httpsAgent : httpAgent,
      headers: { "User-Agent": "OTT" }
    });

    if (!upstream.ok) return res.sendStatus(upstream.status);

    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${baseURL}</BaseURL>`
      );

      res.set("Content-Type", "application/dash+xml");
      return res.send(mpd);
    }

    upstream.body.pipe(res);
  } catch (err) {
    res.sendStatus(502);
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
