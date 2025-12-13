import express from "express"
import { exec } from "child_process"

const app = express()

app.get("/m3u8/:id", (req, res) => {
  const id = req.params.id

  const cmd = `yt-dlp -f best --hls-use-mpegts -g https://www.youtube.com/watch?v=${id}`

  exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err || !stdout) {
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

app.listen(3000, () => {
  console.log("yt-dlp backend running on port 3000")
})
