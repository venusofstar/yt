
import express from "express";
import { exec } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;

// ===== CACHE SYSTEM =====
const cache = new Map();
const CACHE_TIME = 5 * 60 * 1000; // 5 minutes

// ===== EXTRACT YOUTUBE STREAM =====
function extractStreams(videoId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    exec(`yt-dlp -g ${url}`, (err, stdout, stderr) => {
      if (err || !stdout) {
        console.error("yt-dlp error:", stderr);
        return reject("Extraction failed");
      }

      const links = stdout.trim().split("\n");

      resolve({
        video: links[0] || null,
        audio: links[1] || null
      });
    });
  });
}

// ===== API: GET STREAM =====
app.get("/yt/:id", async (req, res) => {
  const videoId = req.params.id;

  try {
    // check cache
    if (cache.has(videoId)) {
      const cached = cache.get(videoId);

      if (Date.now() - cached.time < CACHE_TIME) {
        return res.json({
          source: "cache",
          videoId,
          ...cached.data
        });
      }
    }

    // extract fresh
    const data = await extractStreams(videoId);

    // save cache
    cache.set(videoId, {
      data,
      time: Date.now()
    });

    res.json({
      source: "fresh",
      videoId,
      ...data
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to extract stream" });
  }
});

// ===== PROXY (for video/audio or m3u8 if available) =====
app.get("/proxy", async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send("Missing url");
  }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.youtube.com/"
      }
    });

    res.setHeader("Access-Control-Allow-Origin", "*");

    // detect content type
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("mpegurl")) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    } else {
      res.setHeader("Content-Type", contentType);
    }

    response.body.pipe(res);

  } catch (err) {
    res.status(500).send("Proxy error");
  }
});

// ===== SIMPLE PLAYER TEST PAGE =====
app.get("/play/:id", (req, res) => {
  const videoId = req.params.id;

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Player</title>
    <style>
      body { margin:0; background:black; }
      video { width:100vw; height:100vh; }
    </style>
  </head>
  <body>
    <video id="video" controls autoplay></video>

    <script>
      fetch('/yt/${videoId}')
        .then(res => res.json())
        .then(data => {
          const video = document.getElementById('video');
          video.src = '/proxy?url=' + encodeURIComponent(data.video);
        });
    </script>
  </body>
  </html>
  `);
});

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("YouTube Stream API is running");
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
