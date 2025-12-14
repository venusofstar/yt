import express from "express"
import { execFile } from "child_process"

const app = express()

app.get("/", (_, res) => {
  res.send("YT-DLP BACKEND OK")
})

app.get("/m3u8/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "")

  const args = [
    "--no-warnings",
    "--no-check-certificate",
    "-f", "best[protocol=m3u8]/best",
    "-g",
    `https://www.youtube.com/watch?v=${id}`
  ]

  execFile("yt-dlp", args, { timeout: 25000 }, (err, stdout, stderr) => {
    if (err || !stdout) {
      console.error("yt-dlp failed:", stderr)
      return res.status(500).send("yt-dlp failed")
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

app.listen(3000, () => console.log("Backend running on port 3000"))
