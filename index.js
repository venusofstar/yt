import express from "express"
import { execFile } from "child_process"
import fs from "fs"

const app = express()
const PORT = process.env.PORT || 3000

// ---- YT-DLP PATH FALLBACK ----
const YTDLP_PATHS = [
  "yt-dlp",
  "/usr/bin/yt-dlp",
  "/usr/local/bin/yt-dlp"
]

function findYtDlp() {
  for (const p of YTDLP_PATHS) {
    try {
      execFile(p, ["--version"])
      return p
    } catch {}
  }
  return null
}

const YTDLP = findYtDlp()

if (!YTDLP) {
  console.error("❌ yt-dlp NOT FOUND")
  process.exit(1)
}

// ---- HEALTH CHECK ----
app.get("/", (_, res) => {
  res.send("YT-DLP BACKEND OK")
})

// ---- M3U8 ENDPOINT ----
app.get("/m3u8/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "")
  const url = `https://www.youtube.com/watch?v=${id}`

  const args = [
    "--no-warnings",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "-f", "best[protocol=m3u8]/best",
    "-g",
    url
  ]

  execFile(YTDLP, args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("YT-DLP ERROR:", err.message)
      console.error("STDERR:", stderr)
      return res.status(500).send(stderr || err.message)
    }

    if (!stdout) {
      return res.status(500).send("No stream URL returned")
    }

    const streamUrl = stdout.trim()

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
    res.setHeader("Access-Control-Allow-Origin", "*")

    res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=8000000
${streamUrl}`)
  })
})

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`)
})
