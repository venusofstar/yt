const express = require("express");
const fetch = require("node-fetch");
const app = express();

const PORT = process.env.PORT || 3000;

// Upstream DASH MPD
const UPSTREAM =
  "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg01006-abs-cbn-kapcha-dash-abscbnono/ea9b1903-75d6-490a-95cf-0fc3f3165ba3/index.mpd";

// Headers (important for CDN protection)
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://www.iwanttfc.com/",
  Origin: "https://www.iwanttfc.com",
  Accept: "*/*",
  Connection: "keep-alive",
};

// =========================
// MANIFEST PROXY
// =========================
app.get("/manifest.mpd", async (req, res) => {
  try {
    const response = await fetch(UPSTREAM, { headers: HEADERS });

    if (!response.ok) {
      return res
        .status(response.status)
        .send("Failed to fetch upstream MPD");
    }

    let mpd = await response.text();

    const baseUrl = `${req.protocol}://${req.get(
      "host"
    )}/segment?url=`;

    // Rewrite ONLY segment URLs (avoid breaking MPD XML tags)
    mpd = mpd.replace(
      /(https?:\/\/[^\s"']+\.(m4s|mp4)(\?[^\s"']*)?)/g,
      (url) => `${baseUrl}${encodeURIComponent(url)}`
    );

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.send(mpd);
  } catch (err) {
    console.error("MPD error:", err.message);
    res.status(500).send("MPD fetch error");
  }
});

// =========================
// SEGMENT PROXY (.m4s/.mp4)
// =========================
app.get("/segment", async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url || "");

    if (!url) return res.status(400).send("Missing URL");

    const headers = {
      ...HEADERS,
    };

    // IMPORTANT: pass range for smooth playback
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await fetch(url, {
      headers,
    });

    res.status(response.status);

    // Stream headers safely (avoid overwriting express control headers)
    response.headers.forEach((value, key) => {
      if (!["content-encoding", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Stream directly (low latency)
    response.body.pipe(res);
  } catch (err) {
    console.error("Segment error:", err.message);
    res.status(500).send("Segment proxy error");
  }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("DASH Restream Proxy Running");
});

// =========================
app.listen(PORT, () => {
  console.log("🚀 MPD Proxy running on port " + PORT);
  console.log("Manifest:");
  console.log(`http://localhost:${PORT}/manifest.mpd`);
});
