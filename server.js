import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const ORIGIN = "http://136.239.158.18:6610";
const MPD_PATH = "/001/2/ch00000090990000001179/manifest.mpd";
const MPD_QUERY = "JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1";

const ORIGIN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Android)",
  "Accept": "*/*",
  "Referer": ORIGIN + "/",
  "Origin": ORIGIN
};

// ===== MPD =====
app.get("/", async (req, res) => {
  try {
    const mpdUrl = `${ORIGIN}${MPD_PATH}?${MPD_QUERY}`;
    const r = await fetch(mpdUrl, { headers: ORIGIN_HEADERS });
    const mpd = await r.text();

    res.set({
      "Content-Type": "application/dash+xml",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });

    res.send(mpd);
  } catch {
    res.status(502).send("MPD fetch failed");
  }
});

// ===== SEGMENTS (CRITICAL FIX) =====
app.get("/001/2/*", async (req, res) => {
  try {
    // 🔑 FORCE REQUIRED QUERY PARAMS
    const targetUrl = ORIGIN + req.path + "?" + MPD_QUERY;

    const r = await fetch(targetUrl, { headers: ORIGIN_HEADERS });

    if (!r.ok) {
      return res.sendStatus(502);
    }

    res.set({
      "Content-Type": r.headers.get("content-type") || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });

    r.body.pipe(res);
  } catch {
    res.sendStatus(502);
  }
});

app.listen(PORT, () => {
  console.log("DASH proxy running on", PORT);
});
