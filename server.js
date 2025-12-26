const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// ========================
// HOME
// ========================
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>DASH MPD Proxy</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:50px">
        <h1>✅ DASH MPD PROXY</h1>
        <p>Fully Converted • No Redirect</p>
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

    const origin =
      `http://143.44.136.67:6060/001/2/ch0000009099000000${channelId}/manifest.mpd` +
      `?JITPDRMType=Widevine` +
      `&virtualDomain=001.live_hls.zte.com` +
      `&m4s_min=1` +
      `&ztecid=ch0000009099000000${channelId}`;

    const mpdRes = await fetch(origin, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    let mpd = await mpdRes.text();

    // ========================
    // REWRITE SEGMENT URLS
    // ========================
    mpd = mpd
      .replace(/(initialization=")([^"]+)"/g, `$1/seg/${channelId}/$2"`)
      .replace(/(media=")([^"]+)"/g, `$1/seg/${channelId}/$2"`);

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.send(mpd);

  } catch (err) {
    console.error(err);
    res.status(500).send("MPD fetch error");
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

    res.setHeader("Content-Type", segRes.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=2");

    segRes.body.pipe(res);

  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ========================
app.listen(PORT, () => {
  console.log(`🚀 DASH MPD Proxy running on ${PORT}`);
});
