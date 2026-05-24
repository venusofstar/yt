const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// =========================
// SECRET KEY
// =========================
const SECRET = "MAFLIX_SUPER_SECRET_KEY";

// =========================
// CREATE TOKEN
// =========================
function createToken(userId) {
  return jwt.sign(
    {
      userId,
      accountExpired: false,
      allowedOrigins: ["https://*"],
    },
    SECRET,
    {
      expiresIn: "60d",
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
      error: "Missing token",
    });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      error: "Invalid or expired token",
    });
  }
}

// =========================
// GENERATE TEST TOKEN
// =========================
app.get("/generate-token", (req, res) => {
  const token = createToken("PHCORNER");

  res.json({
    token,
  });
});

// =========================
// SECURE LOGO ENDPOINT
// =========================
app.get("/api/logo/:id", verifyToken, (req, res) => {
  const { id } = req.params;
  const format = req.query.format || "png";

  // Example local file
  const logoPath = path.join(__dirname, "logos", `${id}.${format}`);

  if (!fs.existsSync(logoPath)) {
    return res.status(404).send("Logo not found");
  }

  res.sendFile(logoPath);
});

// =========================
// SECURE PLAYLIST ENDPOINT
// =========================
app.get(
  "/api/playlist/:id/playlist.m3u8",
  verifyToken,
  (req, res) => {
    const { id } = req.params;

    // Real stream URL
    const realStream =
      "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

    // Optional: dynamic playlist
    const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2000000
${realStream}`;

    res.setHeader(
      "Content-Type",
      "application/vnd.apple.mpegurl"
    );

    res.send(playlist);
  }
);

// =========================
// HOME
// =========================
app.get("/", (req, res) => {
  res.send("JWT Secure HLS Server Running");
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
