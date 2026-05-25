const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());

// 🔥 Your required headers
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://kisskh.id/",
  "Origin": "https://kisskh.id"
};

/**
 * 🔥 MAIN PROXY ROUTE
 * Usage:
 * /proxy?url=https://example.com/master.m3u8
 */
app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).send("Missing ?url=");
    }

    const response = await axios.get(url, {
      responseType: "stream",
      headers: HEADERS,
      timeout: 15000
    });

    // Forward content-type (important for HLS)
    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "application/vnd.apple.mpegurl"
    );

    // Allow browser access
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Pipe stream
    response.data.pipe(res);

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Stream fetch failed");
  }
});

/**
 * 🔥 OPTIONAL: TS SEGMENT PROXY
 * Needed if .m3u8 points to ts files that are also blocked
 */
app.get("/ts", async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).send("Missing ?url=");
    }

    const response = await axios.get(url, {
      responseType: "stream",
      headers: HEADERS,
      timeout: 15000
    });

    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Access-Control-Allow-Origin", "*");

    response.data.pipe(res);

  } catch (err) {
    console.error("TS error:", err.message);
    res.status(500).send("TS fetch failed");
  }
});

app.listen(PORT, () => {
  console.log(`🔥 HLS Proxy running on http://localhost:${PORT}`);
});
