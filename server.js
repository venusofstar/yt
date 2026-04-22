import express from "express";
import { exec } from "child_process";

const app = express();
const PORT = process.env.PORT || 10000;

// simple in-memory cache
const cache = new Map();

// cache duration (in ms) → 5 minutes
const CACHE_TIME = 5 * 60 * 1000;

/**
 * Extract m3u8 using yt-dlp
 */
function getM3U8(videoId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    exec(`yt-dlp -g -f "best[ext=m3u8]" ${url}`, (err, stdout) => {
      if (err || !stdout) {
        reject("Extraction failed");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * API: Get M3U8
 * Example: /yt/VIDEO_ID
 */
app.get("/yt/:id", async (req, res) => {
  const videoId = req.params.id;

  try {
    // check cache
    if (cache.has(videoId)) {
      const data = cache.get(videoId);

      if (Date.now() - data.time < CACHE_TIME) {
        return res.json({
          source: "cache",
          videoId,
          m3u8: data.url
        });
      }
    }

    // fetch new
    const m3u8 = await getM3U8(videoId);

    // store in cache
    cache.set(videoId, {
      url: m3u8,
      time: Date.now()
    });

    res.json({
      source: "fresh",
      videoId,
      m3u8
    });

  } catch (e) {
    res.status(500).json({ error: "Failed to extract stream" });
  }
});

/**
 * Proxy endpoint for IPTV players
 * Example: /proxy?url=ENCODED_M3U8
 */
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

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");

    response.body.pipe(res);

  } catch (err) {
    res.status(500).send("Proxy error");
  }
});

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("YouTube → M3U8 API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
