const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { PassThrough } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// MPD → MPD proxy route
app.get("/:channel/manifest.mpd", async (req, res) => {
  try {
    const channel = req.params.channel;
    const ztecid = `ch0000009099000000${channel}`;

    const originUrl = `http://143.44.136.67:6060/001/2/${ztecid}/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1`;

    const response = await fetch(originUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
      },
    });

    if (!response.ok) return res.sendStatus(502);

    res.setHeader("Content-Type", "application/dash+xml");

    const stream = new PassThrough();
    response.body.pipe(stream).pipe(res);
  } catch (err) {
    console.error("MPD proxy error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`MPD proxy running on port ${PORT}`);
});
