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

let originIndex = 0;
function getOrigin() {
  const o = ORIGINS[originIndex];
  originIndex = (originIndex + 1) % ORIGINS.length;
  return o;
}

// =========================
// AUTH ROTATION
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
  res.send("✅ DASH MPD → MPD Proxy is running");
});

// =========================
// FULL DASH PROXY (MPD + SEGMENTS) WITH channelId + ztecid
// =========================
app.get("/:channelId/:ztecid/*", async (req, res) => {
  const { channelId, ztecid } = req.params;
  const path = req.params[0]; // manifest.mpd OR .m4s/.mp4
  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${rotateStartNumber()}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}` +
    `&ztecid=${ztecid}`; // include ztecid

  const targetURL =
    path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

  try {
    const upstream = await fetch(targetURL, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive"
      }
    });

    if (!upstream.ok) {
      console.error("❌ Upstream error:", upstream.status);
      return res.status(upstream.status).end();
    }

    // =========================
    // MPD → BaseURL REWRITE
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBaseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/${ztecid}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
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
    // MEDIA SEGMENTS (.m4s/.mp4)
    // =========================
    res.status(upstream.status);
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
