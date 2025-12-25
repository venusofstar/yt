import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// ORIGINAL MPD (FULL PARAMS, DO NOT CHANGE)
const ORIGIN_MPD =
  "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd" +
  "?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1";

app.get("/", async (req, res) => {
  try {
    const originRes = await fetch(ORIGIN_MPD, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Accept": "*/*",
        "Referer": "http://143.44.136.67:6060/",
        "Origin": "http://143.44.136.67:6060"
      }
    });

    if (!originRes.ok) {
      return res.status(502).send("Origin MPD error");
    }

    const mpd = await originRes.text();

    res.set({
      "Content-Type": "application/dash+xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });

    res.send(mpd);

  } catch (err) {
    res.status(500).send("Proxy error:\n" + err.toString());
  }
});

app.listen(PORT, () => {
  console.log("MPD proxy running on port", PORT);
});
