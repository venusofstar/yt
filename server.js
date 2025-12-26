const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

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

let rotateIndex = 0;
function getOrigin() {
  const origin = ORIGINS[rotateIndex];
  rotateIndex = (rotateIndex + 1) % ORIGINS.length;
  return origin;
}

// =========================
// FAST AUTH ROTATION
// =========================
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

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("✅ MPD → MPD Proxy is running");
});

// =========================
// MPD → MPD FULL PROXY
// =========================
app.get("/:channelId/manifest.mpd", async (req, res) => {
  const { channelId } = req.params;
  const origin = getOrigin();

  const targetURL =
    `${origin}/001/2/ch0000009099000000${channelId}/manifest.mpd` +
    `?JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${rotateStartNumber()}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  try {
    console.log("📡 Fetching MPD:", targetURL);

    const upstream = await fetch(targetURL, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      }
    });

    res.status(upstream.status);

    // DASH SAFE HEADERS
    res.set({
      "Content-Type": "application/dash+xml",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ MPD Proxy Error:", err.message);
    res.status(502).send("MPD upstream error");
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ MPD Proxy running on port ${PORT}`);
});
