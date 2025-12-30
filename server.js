const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { PassThrough } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// MPD proxy
// =========================
app.get("/:channel/manifest.mpd", async (req, res) => {
  try {
    const channel = req.params.channel;
    const ztecid = `ch0000009099000000${channel}`;

    const originUrl = `http://143.44.136.67:6060/001/2/${ztecid}/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1`;

    let mpdText = await (await fetch(originUrl)).text();

    // Rewrite segment URLs to go through this proxy
    mpdText = mpdText
      .replace(/fragment-\$Time\$-(.*?)\.m4s\?[^"]+/g, `/${
        channel
      }/segment-$1.m4s`)
      .replace(/init-\$RepresentationID\$\.mp4\?[^"]+/g, `/${
        channel
      }/init-$1.mp4`);

    res.setHeader("Content-Type", "application/dash+xml");
    res.send(mpdText);
  } catch (err) {
    console.error("MPD proxy error:", err);
    res.sendStatus(500);
  }
});

// =========================
// Segment proxy
// =========================
app.get("/:channel/:segment", async (req, res) => {
  try {
    const { channel, segment } = req.params;
    const ztecid = `ch0000009099000000${channel}`;

    const originUrl = `http://143.44.136.67:6060/001/2/${ztecid}/${segment}?virtualDomain=001.live_hls.zte.com&JITPDRMType=Widevine&m4s_min=1`;

    const response = await fetch(originUrl);
    if (!response.ok) return res.sendStatus(502);

    const stream = new PassThrough();
    response.body.pipe(stream).pipe(res);
  } catch (err) {
    console.error("Segment proxy error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`MPD proxy + segments running on port ${PORT}`);
});
