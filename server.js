const express = require("express");
const cors = require("cors");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// BASIC MIDDLEWARE
// =========================
app.use(cors());

// =========================
// KEEP-ALIVE AGENT
// =========================
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 100
});

// =========================
// ORIGIN ROTATION
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

let originIndex = 0;
function getOrigin() {
  const origin = ORIGINS[originIndex];
  originIndex = (originIndex + 1) % ORIGINS.length;
  return origin;
}

// =========================
// AUTH ROTATION (STABLE)
// =========================
const startNumbers = new Map();

function getStartNumber(channelId) {
  if (!startNumbers.has(channelId)) {
    const base = 46489952;
    const step = 6;
    startNumbers.set(
      channelId,
      base + Math.floor(Math.random() * 100000) * step
    );
  }
  return startNumbers.get(channelId);
}

function rotateIAS() {
  return "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
}

function rotateUserSession() {
  return Math.floor(Math.random() * 1e15).toString();
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH MPD → Segment Proxy is running");
});

// =========================
// FULL DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

  // Channel validation
  if (!/^\d+$/.test(channelId)) {
    return res.status(400).end("Invalid channelId");
  }

  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${getStartNumber(channelId)}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

  // Fetch timeout protection
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(targetURL, {
      agent,
      signal: controller.signal,
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      }
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      console.error("❌ Upstream error:", upstream.status);
      return res.status(upstream.status).end();
    }

    // =========================
    // MPD HANDLING
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBaseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      // Remove all existing BaseURL tags
      mpd = mpd.replace(/<BaseURL>[\s\S]*?<\/BaseURL>/g, "");

      // Inject proxy BaseURL safely
      mpd = mpd.replace(
        /<MPD\b[^>]*>/,
        match => `${match}<BaseURL>${proxyBaseURL}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // MEDIA SEGMENTS
    // =========================
    upstream.headers.forEach((value, key) => {
      if (!["transfer-encoding", "content-encoding"].includes(key)) {
        res.setHeader(key, value);
      }
    });

    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err.message);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
