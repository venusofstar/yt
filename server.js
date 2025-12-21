import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// ==========================
// SOURCE MPDs
// ==========================
const SOURCES = {
  nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
  nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1"
};

// ==========================
// MPD PROXY
// ==========================
app.get("/:channel/manifest.mpd", async (req, res) => {
  const sourceUrl = SOURCES[req.params.channel];
  if (!sourceUrl) return res.sendStatus(404);

  try {
    const upstream = await fetch(sourceUrl, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Referer": "http://143.44.136.67/",
      }
    });

    res.status(upstream.status);
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Content-Type", "application/dash+xml");

    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        }
      })
    );
  } catch (err) {
    console.error(err);
    res.sendStatus(502);
  }
});

// ==========================
// SEGMENT PROXY
// ==========================
app.get(/^\/(.*\.(m4s|mp4))$/, async (req, res) => {
  const targetUrl = "http://143.44.136.67:6060/" + req.params[0];

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Referer": "http://143.44.136.67/",
        "Range": req.headers.range || ""
      }
    });

    res.status(upstream.status);
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        }
      })
    );
  } catch (err) {
    console.error(err);
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`✅ DASH proxy running on port ${PORT}`);
});
