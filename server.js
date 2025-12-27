const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// ORIGINS (ROTATE ON RELOAD)
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
// AUTH VALUES (ROTATE ON RELOAD)
// =========================
const START_NUMBER = (() => {
  const base = 46489952;
  const step = 6;
  return base + Math.floor(Math.random() * 100000) * step;
})();

const IAS_SESSION = "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
const USER_SESSION = Math.floor(Math.random() * 1e15).toString();

// Log startup values
console.log("🔁 Origin:", SELECTED_ORIGIN);
console.log("▶ StartNumber:", START_NUMBER);
console.log("🔐 IAS:", IAS_SESSION);
console.log("👤 UserSession:", USER_SESSION);

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("✅ DASH Proxy is running");
});

// =========================
// DASH PROXY (MPD + SEGMENTS)
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0]; // manifest.mpd or .m4s/.mp4

  const upstreamBase = `${SELECTED_ORIGIN}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${START_NUMBER}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${IAS_SESSION}` +
    `&usersessionid=${USER_SESSION}`;

  const targetURL = path.includes("?")
    ? `${upstreamBase}${path}&${authParams}`
    : `${upstreamBase}${path}?${authParams}`;

  try {
    const upstream = await fetch(targetURL, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      },
      timeout: 0 // prevent fetch timeout
    });

    if (!upstream.ok) {
      console.error("❌ Upstream error:", upstream.status, targetURL);
      return res.status(upstream.status).end();
    }

    // =========================
    // MPD → rewrite BaseURL
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const proxyBaseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

      // Remove all existing <BaseURL>
      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");

      // Inject proxy BaseURL
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`
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
    res.status(upstream.status);
    res.set({
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    // Disable Node buffering
    req.socket.setNoDelay(true);

    // Stream upstream → client
    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err.message, targetURL);
    res.status(502).end();
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH Proxy running on port ${PORT}`);
});
