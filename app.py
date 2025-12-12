from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import StreamingResponse
import subprocess
import requests

app = FastAPI()
YT_DLP_BIN = "/usr/local/bin/yt-dlp"

@app.get("/@yt/index.m3u8")
def youtube_hls(url: str = Query(..., description="YouTube URL")):
    """
    Dynamically stream YouTube video as HLS (.m3u8)
    """
    cmd = [
        YT_DLP_BIN,
        "-f", "best[ext=m3u8]/best",
        "-g",  # get direct URL
        url
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        direct_url = proc.stdout.strip()
        if not direct_url:
            raise HTTPException(status_code=404, detail="Stream not found")
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"yt-dlp failed: {e.stderr}")

    r = requests.get(direct_url, stream=True)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch m3u8 from YouTube")

    return StreamingResponse(
        r.iter_content(chunk_size=1024),
        media_type="application/vnd.apple.mpegurl"
    )
