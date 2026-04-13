const express = require("express");
const fetch = require("node-fetch");
const app = express();

const PORT = process.env.PORT || 3000;

// =======================
// UPSTREAM DASH STREAM
// =======================
const UPSTREAM =
  "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg01006-abs-cbn-kapcha-dash-abscbnono/index.mpd";

// =======================
// HEADERS (IMPORTANT)
// =======================
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://www.iwanttfc.com/",
  Origin: "https://www.iwanttfc.com",
  Accept: "*/*",
  Connection: "keep-alive",
};

// =======================
// MANIFEST PROXY
// =======================
app.get("/manifest.mpd", async (req, res) => {
  try {
    const response = await fetch(UPSTREAM, { headers: HEADERS });

    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch MPD");
    }

    let mpd = await response.text();

    // =========================
    // BASEURL FOR RESTREAMING
    // =========================
    const baseUrl = `${req.protocol}://${req.get("host")}/segment?url=`;

    // 1. Replace existing BaseURL
    mpd = mpd.replace(
      /<BaseURL>.*?<\/BaseURL>/g,
      `<BaseURL>${baseUrl}</BaseURL>`
    );

    // 2. Inject BaseURL if missing
    if (!mpd.includes("<BaseURL>")) {
      mpd = mpd.replace(
        /<MPD[^>]*>/,
        (match) => `${match}\n<BaseURL>${baseUrl}</BaseURL>`
      );
    }

    // 3. Rewrite absolute segment URLs safely
    mpd = mpd.replace(
      /(https?:\/\/[^\s"']+\.(m4s|mp4)(\?[^\s"']*)?)/g,
      (url) => `${baseUrl}${encodeURIComponent(url)}`
    );

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.send(mpd);
  } catch (err) {
    console.error("MPD Error:", err.message);
    res.status(500).send("MPD fetch error");
  }
});

// =======================
// SEGMENT PROXY
// =======================
app.get("/segment", async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url || "");

    if (!url) return res.status(400).send("Missing segment URL");

    const headers = { ...HEADERS };

    // Range support (critical for DASH)
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await fetch(url, { headers });

    res.status(response.status);

    // Stream headers safely
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (
        !["content-encoding", "transfer-encoding", "content-length"].includes(k)
      ) {
        res.setHeader(key, value);
      }
    });

    // Direct pipe (low latency restream)
    response.body.pipe(res);
  } catch (err) {
    console.error("Segment Error:", err.message);
    res.status(500).send("Segment proxy error");
  }
});

// =======================
// HEALTH CHECK
// =======================
app.get("/", (req, res) => {
  res.send("🚀 DASH Restream Proxy is Running");
});

// =======================
app.listen(PORT, () => {
  console.log("🔥 MPD Restream ready on port " + PORT);
  console.log(`👉 Manifest: http://localhost:${PORT}/manifest.mpd`);
});
