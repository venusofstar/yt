
import express from "express"
import { execFile } from "child_process"

const app = express()
const PORT = process.env.PORT || 3000

// ---- yt-dlp binary path ----
const YTDLP = "/usr/bin/yt-dlp" // change only if needed

// ---- health check ----
app.get("/", (_, res) => {
  res.send("YT-DLP BACKEND OK (PH)")
})

// ---- YouTube → M3U8 ----
app.get("/m3u8/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "")
  const url = `https://www.youtube.com/watch?v=${id}`

  const args = [
    "--no-warnings",
    "--no-check-certificate",
    "--socket-timeout", "15",

    // 🔑 PH GEO FIX
    "--extractor-args", "youtube:player_client=android",

    // Prefer HLS
    "-f", "best[protocol=m3u8]/best",
    "-g",
    url
  ]

  execFile(YTDLP, args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("YT-DLP ERROR:", stderr || err.message)
      return res.status(500).send(stderr || err.message)
    }

    if (!stdout) {
      return res.status(500).send("No stream URL returned")
    }

    const streamUrl = stdout.trim()

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Cache-Control", "no-cache")

    res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=8000000
${streamUrl}`)
  })
})

// ---- start server ----
app.listen(PORT, () => {
  console.log(`✅ PH yt-dlp backend running on port ${PORT}`)
})
