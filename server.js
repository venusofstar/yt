import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// ==========================
// CHANNEL SHORTCUT
// ==========================
const SOURCES = {
  nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
  nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1"
};

// ==========================
// MPD SHORT PATH
// ==========================
app.get("/:channel/manifest.mpd", async (req, res) => {
  const src = SOURCES[req.params.channel];
  if (!src) return res.sendStatus(404);

  try {
    const r = await fetch(src, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Referer": "http://143.44.136.67/"
      }
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
// EVERYTHING ELSE (SEGMENTS / LICENSE / INIT)
// MUST BE LAST
// ==========================
app.all("*", async (req, res) => {
  const target = "http://143.44.136.67:6060" + req.originalUrl;

  try {
    const r = await fetch(target, {
      method: req.method,
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Referer": "http://143.44.136.67/",
        "Range": req.headers.range || "",
        "Content-Type": req.headers["content-type"]
      },
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
  console.log(`✅ Proxy running on port ${PORT}`);
});
