import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

/* ==========================
   SOURCE MPDs
========================== */
const SOURCES = {
  nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
  nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
};

const BASE_ORIGIN = "http://143.44.136.67:6060";

/* ==========================
   COMMON PROXY
========================== */
async function proxyRequest(url, req, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(url, {
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        "referer": "http://143.44.136.67/",
        "range": req.headers.range,
      },
      signal: controller.signal,
    });

    res.status(upstream.status);

    upstream.headers.forEach((v, k) => {
      res.setHeader(k, v);
    });

    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
      })
    );
  } catch {
    if (!res.headersSent) res.status(502).send("Upstream error");
  } finally {
    clearTimeout(timeout);
  }
}

/* ==========================
   MPD
========================== */
app.get("/:channel/manifest.mpd", async (req, res) => {
  const src = SOURCES[req.params.channel];
  if (!src) return res.status(404).send("Channel not found");
  await proxyRequest(src, req, res);
});

/* ==========================
   SEGMENTS
========================== */
app.get("*", async (req, res) => {
  await proxyRequest(BASE_ORIGIN + req.originalUrl, req, res);
});

app.disable("x-powered-by");

app.listen(PORT, () => {
  console.log(`MPD restream running on port ${PORT}`);
});
