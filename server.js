const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// =========================
// HEADERS (IMPORTANT)
// =========================
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://kisskh.id/",
  "Origin": "https://kisskh.id"
};

// =========================
// UTIL: convert relative → absolute
// =========================
function toAbsoluteUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

// =========================
// 🔥 M3U8 PROXY (REWRITES SEGMENTS)
// =========================
app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing ?url=");

    const response = await axios.get(url, {
      responseType: "text",
      headers: HEADERS,
      timeout: 20000
    });

    let playlist = response.data;
    const baseUrl = url;

    // Rewrite TS / M4S segments to go through /ts proxy
    playlist = playlist.replace(
      /^(?!#)(.*\.(ts|m4s)(\?.*)?)$/gm,
      (line) => {
        const absolute = toAbsoluteUrl(baseUrl, line.trim());
        return `/ts?url=${encodeURIComponent(absolute)}`;
      }
    );

    // Optional: rewrite nested m3u8 playlists
    playlist = playlist.replace(
      /^(?!#)(.*\.m3u8(\?.*)?)$/gm,
      (line) => {
        const absolute = toAbsoluteUrl(baseUrl, line.trim());
        return `/proxy?url=${encodeURIComponent(absolute)}`;
      }
    );

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    res.send(playlist);
  } catch (err) {
    console.error("M3U8 Proxy Error:", err.message);
    res.status(500).send("Failed to fetch playlist");
  }
});

// =========================
// 🔥 TS / SEGMENT PROXY
// =========================
app.get("/ts", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing ?url=");

    const response = await axios.get(url, {
      responseType: "stream",
      headers: HEADERS,
      timeout: 20000
    });

    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    response.data.pipe(res);
  } catch (err) {
    console.error("TS Proxy Error:", err.message);
    res.status(500).send("Failed to fetch segment");
  }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("🔥 HLS Proxy is running");
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🔥 HLS Proxy running on http://localhost:${PORT}`);
});
