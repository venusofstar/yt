const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// ORIGINS (rotate once on server start)
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

const SELECTED_ORIGIN = ORIGINS[Math.floor(Math.random() * ORIGINS.length)];

// =========================
// AUTH VALUES (rotate once on server start)
// =========================
const START_NUMBER = (() => {
  const base = 46489952;
  const step = 6;
  return base + Math.floor(Math.random() * 100000) * step;
})();

const IAS_SESSION = "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
const USER_SESSION = Math.floor(Math.random() * 1e15).toString();

console.log("🔁 Origin:", SELECTED_ORIGIN);
console.log("▶ StartNumber:", START_NUMBER);
console.log("🔐 IAS:", IAS_SESSION);
console.log("👤 UserSession:", USER_SESSION);

// =========================
// MPD Cache for live streams
// =========================
const mpdCache = new Map(); // key: channelId, value: { mpdText, lastFetch }

async function getLiveMPD(channelId) {
  const cache = mpdCache.get(channelId);
  const now = Date.now();

  // Re-fetch MPD if older than 2 seconds
  if (!cache || now - cache.lastFetch > 2000) {
    const upstreamBase = `${SELECTED_ORIGIN}/001/2/ch0000009099000000${channelId}/`;
    const authParams = `JITPDRMType=Widevine&startNumber=${START_NUMBER}&IASHttpSessionId=${IAS_SESSION}&usersessionid=${USER_SESSION}`;
    const url = `${upstreamBase}manifest.mpd?${authParams}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "OTT" },
      timeout: 0
    });

    if (!res.ok) {
      throw new Error(`Upstream MPD fetch failed: ${res.status}`);
    }

    let mpd = await res.text();

    // Remove old BaseURL and inject proxy BaseURL
    mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
    mpd = mpd.replace(
      /<MPD([^>]*)>/,
      `<MPD$1 minimumUpdatePeriod="PT2S"><BaseURL>http://localhost:${PORT}/${channelId}/</BaseURL>`
    );

    mpdCache.set(channelId, { mpdText: mpd, lastFetch: now });
    return mpd;
  }

  return cache.mpdText;
}

// =========================
// Home route
// =========================
app.get("/", (req, res) => {
  res.send("✅ DASH Live Proxy is running");
});

// =========================
// DASH Proxy Route
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0]; // manifest.mpd or segment

  try {
    if (path.endsWith(".mpd")) {
      // Serve live MPD (auto-updates every 2 seconds)
      const mpd = await getLiveMPD(channelId);
      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });
      return res.send(mpd);
    }

    // Serve media segments
    const upstreamBase = `${SELECTED_ORIGIN}/001/2/ch0000009099000000${channelId}/`;
    const authParams = `JITPDRMType=Widevine&startNumber=${START_NUMBER}&IASHttpSessionId=${IAS_SESSION}&usersessionid=${USER_SESSION}`;
    const targetURL = path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

    const upstream = await fetch(targetURL, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      },
      timeout: 0
    });

    if (!upstream.ok) {
      console.error("❌ Upstream segment error:", upstream.status, targetURL);
      return res.status(upstream.status).end();
    }

    res.status(upstream.status);
    res.set({
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    // Disable Node buffering
    req.socket.setNoDelay(true);

    // Stream segment to client
    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err.message);
    res.status(502).end();
  }
});

// =========================
// Start server
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH Live Proxy running on port ${PORT}`);
});
