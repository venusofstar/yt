const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

/* TRUST PROXY (important if behind nginx/docker/cloudflare) */
app.set("trust proxy", true);

/* AGENTS */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 500 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 500 });

/* CORS */
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

app.use(cors({ origin: "*", credentials: false }));

/* SESSION ROTATION */
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

/* SESSION CACHE (PER IP, WITH TTL) */
const sessions = new Map();
const SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function getSession(ip) {
  const now = Date.now();
  const existing = sessions.get(ip);

  if (!existing || now - existing.ts > SESSION_TTL) {
    const session = {
      startNumber: rotateStartNumber(),
      IAS: rotateIAS(),
      user: rotateUserSession(),
      ts: now
    };
    sessions.set(ip, session);
    return session;
  }

  return existing;
}

/* BUILD TARGET URL */
const CHANNEL_PREFIX = process.env.CHANNEL_PREFIX || "ch0000009099000000";

function buildURL(origin, channelId, path, session) {
  const base = `${origin}/001/2/${CHANNEL_PREFIX}${channelId}/`;
  const auth =
    `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1&NeedJITP=1&isjitp=0` +
    `&startNumber=${session.startNumber}` +
    `&filedura=6&ispcode=55` +
    `&IASHttpSessionId=${session.IAS}` +
    `&usersessionid=${session.user}`;

  return path.includes("?")
    ? `${base}${path}&${auth}`
    : `${base}${path}?${auth}`;
}

/* ROUTES */
app.get("/", (_, res) => res.send("✅ DASH Proxy Running"));

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;

  let originIndex = Math.floor(Math.random() * ORIGINS.length);
  let session = getSession(ip);
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const origin = ORIGINS[originIndex % ORIGINS.length];
    const targetURL = buildURL(origin, channelId, path, session);

    let controller;
    let timeout;

    try {
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 5000);

      req.on("close", () => controller.abort());

      const upstream = await fetch(targetURL, {
        agent: targetURL.startsWith("https") ? httpsAgent : httpAgent,
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*"
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);

      /* MPD HANDLING */
      if (path.endsWith(".mpd")) {
        let mpd = await upstream.text();
        const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

        mpd = mpd.replace(
          /<BaseURL[^>]*>[\s\S]*?<\/BaseURL>/g,
          ""
        );
        mpd = mpd.replace(
          /<MPD([^>]*)>/,
          `<MPD$1><BaseURL>${baseURL}</BaseURL>`
        );
        mpd = mpd.replace(/&m4s_min=\d+/g, "");

        res.set({
          "Content-Type": "application/dash+xml",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        });

        return res.send(mpd);
      }

      /* MEDIA SEGMENTS */
      res.set({
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
        "Content-Type":
          upstream.headers.get("content-type") ||
          "video/iso.segment"
      });

      return upstream.body.pipe(res);

    } catch (err) {
      if (timeout) clearTimeout(timeout);

      console.warn(
        `❌ Failed (${attempt + 1}/${maxRetries}) → rotating`,
        err.message
      );

      originIndex++;
      session = {
        startNumber: rotateStartNumber(),
        IAS: rotateIAS(),
        user: rotateUserSession(),
        ts: Date.now()
      };
      sessions.set(ip, session);
    }
  }

  res.status(502).send("Stream unavailable after retries");
});

/* START SERVER */
app.listen(PORT, () => {
  console.log(`🚀 DASH Proxy running on port ${PORT}`);
});
