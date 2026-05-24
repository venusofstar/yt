const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// MIDDLEWARE
// =========================
app.use(cors());

// =========================
// SECRET KEY
// =========================
const SECRET = "MAFLIX_SUPER_SECRET_KEY";

// =========================
// TOKEN GENERATOR
// =========================
function createToken(userId) {
  return jwt.sign(
    {
      userId,
      accountExpired: false,
      allowedOrigins: ["*"]
    },
    SECRET,
    {
      expiresIn: "60d"
    }
  );
}

// =========================
// VERIFY TOKEN
// =========================
function verifyToken(req, res, next) {

  const token = req.query.token;

  if (!token) {
    return res.status(401).json({
      error: "Missing token"
    });
  }

  try {

    const decoded = jwt.verify(token, SECRET);

    req.user = decoded;

    next();

  } catch (err) {

    return res.status(403).json({
      error: "Invalid or expired token"
    });

  }
}

// =========================
// GENERATE TOKEN
// =========================
app.get("/generate-token", (req, res) => {

  const token = createToken("PHCORNER");

  res.json({
    token
  });

});

// =========================
// SECURE LOGO ENDPOINT
// =========================
app.get("/api/logo/:id", verifyToken, (req, res) => {

  const { id } = req.params;

  const format = req.query.format || "png";

  const logoPath = path.join(
    __dirname,
    "logos",
    `${id}.${format}`
  );

  if (!fs.existsSync(logoPath)) {

    return res.status(404).send("Logo not found");

  }

  res.sendFile(logoPath);

});

// =========================
// STREAM DATABASE
// =========================
const streams = {

  cnn: {
    name: "CNN RPTV HD",
    type: "mpd",
    logo: "https://i.imgur.com/0SnKSZt.png",
    url: "https://qp-pldt-live-bpk-01-prod.akamaized.net/bpk-tv/cnn_rptv_prod_hd/default/index.mpd"
  }

};

// =========================
// SECURE PLAYLIST ENDPOINT
// =========================
app.get(
  "/api/playlist/:id/playlist.m3u8",
  verifyToken,
  async (req, res) => {

    const stream = streams[req.params.id];

    if (!stream) {

      return res.status(404).send("Stream not found");

    }

    // DASH / MPD JSON RESPONSE
    if (stream.type === "mpd") {

      return res.json({
        id: req.params.id,
        name: stream.name,
        type: stream.type,
        stream: stream.url
      });

    }

    // HLS PLAYLIST
    const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2000000
${stream.url}`;

    res.setHeader(
      "Content-Type",
      "application/vnd.apple.mpegurl"
    );

    res.send(playlist);

  }
);

// =========================
// M3U GENERATOR
// =========================
app.get("/playlist.m3u", (req, res) => {

  const token = createToken("PHCORNER");

  let m3u = "#EXTM3U\n\n";

  Object.keys(streams).forEach((id) => {

    const stream = streams[id];

    m3u += `#EXTINF:-1 tvg-id="${id}" tvg-name="${stream.name}" tvg-logo="${stream.logo}" group-title="📺 LIVE",${stream.name}\n`;

    m3u += `http://localhost:${PORT}/api/playlist/${id}/playlist.m3u8?token=${token}\n\n`;

  });

  res.setHeader(
    "Content-Type",
    "application/x-mpegURL"
  );

  res.send(m3u);

});

// =========================
// HOME
// =========================
app.get("/", (req, res) => {

  res.send("JWT Secure HLS / DASH Server Running");

});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);

});
