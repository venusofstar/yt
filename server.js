
const express = require("express");
const fetch = require("node-fetch");
const app = express();

const PORT = process.env.PORT || 3000;

// Upstream MPD
const UPSTREAM =
  "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg01006-abs-cbn-kapcha-dash-abscbnono/ea9b1903-75d6-490a-95fc-0fc3f3165ba3/index.mpd";

// Headers (important for Amagi/CDN streams)
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://www.google.com/",
  Origin: "https://www.google.com",
};

// Serve proxied MPD
app.get("/manifest.mpd", async (req, res) => {
  try {
    const response = await fetch(UPSTREAM, { headers: HEADERS });
    let mpd = await response.text();

    // Optional: rewrite base URL so segments go through proxy
    const baseUrl = `${req.protocol}://${req.get("host")}/segment?url=`;

    mpd = mpd.replace(/https?:\/\/[^"']+/g, (url) => {
      if (url.includes(".m4s") || url.includes(".mp4")) {
        return baseUrl + encodeURIComponent(url);
      }
      return url;
    });

    res.setHeader("Content-Type", "application/dash+xml");
    res.send(mpd);
  } catch (err) {
    res.status(500).send("MPD fetch error");
  }
});

// Proxy segments (.m4s / .mp4)
app.get("/segment", async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);

    const range = req.headers.range;

    const response = await fetch(url, {
      headers: {
        ...HEADERS,
        Range: range || "",
      },
    });

    res.status(response.status);

    response.headers.forEach((v, k) => {
      res.setHeader(k, v);
    });

    response.body.pipe(res);
  } catch (err) {
    res.status(500).send("Segment error");
  }
});

app.listen(PORT, () => {
  console.log("MPD Proxy running on port " + PORT);
  console.log("Manifest:");
  console.log(`http://localhost:${PORT}/manifest.mpd`);
});
