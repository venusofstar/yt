import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// Keep RAW body (required for DRM license POST)
app.use(express.raw({ type: "*/*" }));
app.use(cors());

// ==========================
// OPTIONAL CHANNEL SHORTCUTS
// ==========================
const SOURCES = {
  nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd",
  nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd"
};

// ==========================
// MPD SHORT URL
// ==========================
app.get("/:channel/manifest.mpd", async (req, res) => {
  const src = SOURCES[req.params.channel];
  if (!src) return res.sendStatus(404);

  try {
    const r = await fetch(src, {
      headers: req.headers
    });

    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    r.body.pipeTo(new WritableStream({
      write: c => res.write(c),
      close: () => res.end()
    }));
  } catch {
    res.sendStatus(502);
  }
});

// ==========================
// LICENSE + SEGMENTS + EVERYTHING
// ==========================
app.all("/*", async (req, res) => {
  const targetUrl = "http://143.44.136.67:6060" + req.originalUrl;

  try {
    const r = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body
    });

    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    r.body.pipeTo(new WritableStream({
      write: c => res.write(c),
      close: () => res.end()
    }));
  } catch {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Transparent proxy running on port ${PORT}`);
});
