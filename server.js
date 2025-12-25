import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// DASH ORIGIN BASE
const ORIGIN_BASE = "http://143.44.136.67:6060";

// Required headers for origin
const ORIGIN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Android)",
  "Accept": "*/*",
  "Referer": ORIGIN_BASE + "/",
  "Origin": ORIGIN_BASE
};

// Root → MPD
app.get("/", async (req, res) => {
  const mpdUrl =
    ORIGIN_BASE +
    "/001/2/ch00000090990000001093/manifest.mpd" +
    "?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1";

  try {
    const r = await fetch(mpdUrl, { headers: ORIGIN_HEADERS });
    const mpd = await r.text();

    res.set({
      "Content-Type": "application/dash+xml",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });

    res.send(mpd);
  } catch (e) {
    res.status(500).send("MPD error");
  }
});

// SEGMENT PROXY (VERY IMPORTANT)
app.get("/*", async (req, res) => {
  try {
    const targetUrl = ORIGIN_BASE + req.originalUrl;

    const r = await fetch(targetUrl, {
      headers: ORIGIN_HEADERS
    });

    if (!r.ok) {
      return res.sendStatus(502);
    }

    // Copy content-type from origin
    const contentType = r.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", contentType);
    res.set("Access-Control-Allow-Origin", "*");

    // Stream response
    r.body.pipe(res);

  } catch (e) {
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log("FULL DASH proxy running on", PORT);
});
