import express from "express"
import { execFile } from "child_process"

const app = express()

app.get("/", (req, res) => {
  res.send("YT-DLP BACKEND OK")
})

app.get("/m3u8/:id", (req, res) => {
  const id = req.params.id

  const args = [
    "-f", "best",
    "--no-check-certificate",
    "--no-warnings",
    "-g",
    `https://www.youtube.com/watch?v=${id}`
  ]

  execFile("yt-dlp", args, { timeout: 20000 }, (err, stdout, stderr) => {
    if (err || !stdout) {
      console.error("yt-dlp error:", stderr)
      return res.status(500).send("yt-dlp failed")
    }

    const streamUrl = stdout.trim()

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl")
    res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=8000000
${streamUrl}`)
  })
})

app.listen(3000, () => console.log("Backend running"))
