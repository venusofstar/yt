const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// ========================
// HOME PAGE
// ========================
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>DASH MPD Proxy</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:50px">
        <h1>✅ DASH MPD PROXY</h1>
        <p>No Redirect • No Leak • Fully Optimized</p>
      </body>
    </html>
  `);
});

// ========================
// MPD PROXY
// ========================
app.get("/:channelId/manifest.mpd", async (req, res) => {
  try {
    const { channelId } = req.params;

    const originMPD =
      `http://143.44.136.67:6060/001/2/ch0000009099000000${channelId}/manifest.mpd` +
      `?JITPDRMType=Widevine` +
      `&virtualDomain=001.live_hls.zte.com` +
      `&m4s_min=1` +
      `&ztecid=ch0000009099000000${channelId}`;

    const mpdRes = await fetch(originMPD, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    let mpd = await mpdRes.text();

    // ========================
    // BASEURL REWRITE (NO LEAK)
    // ========================
    const proxyBase = `/seg/${channelId}/`;

    // Remove ALL existing BaseURL
    mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gis, "");

    // Inject safe BaseURL
    mpd = mpd.replace(
      /<MPD([^>]*)>/i,
      `<MPD$1><BaseURL>${proxyBase}</BaseURL>`
    );

    // Sanitize absolute URLs in SegmentTemplate
    mpd = mpd
      .replace(/(initialization=")(https?:\/\/[^\/]+\/)?/g, `$1`)
      .replace(/(media=")(https?:\/\/[^\/]+\/)?/g, `$1`);

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Expose-Headers", "*");

    res.send(mpd);
  } catch (err) {
    console.error("MPD ERROR:", err);
    res.status(500).send("MPD Proxy Error");
  }
});

// ========================
// SEGMENT PROXY
// ========================
app.get("/seg/:channelId/*", async (req, res) => {
  try {
    const { channelId } = req.params;
    const segmentPath = req.params[0];

    const segmentURL =
      `http://143.44.136.67:6060/001/2/ch0000009099000000${channelId}/${segmentPath}`;

    const segRes = await fetch(segmentURL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    res.setHeader(
      "Content-Type",
      segRes.headers.get("content-type") || "application/octet-stream"
    );

    // Small cache for live stability
    res.setHeader("Cache-Control", "public, max-age=2");
    res.setHeader("Access-Control-Allow-Origin", "*");

    segRes.body.pipe(res);
  } catch (err) {
    console.error("SEGMENT ERROR:", err);
    res.status(500).end();
  }
});

// ========================
app.listen(PORT, () => {
  console.log(`🚀 DASH MPD Proxy running on port ${PORT}`);
});
