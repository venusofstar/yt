"use strict";

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const stream = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   GLOBALS / CONSTANTS
========================= */

const ORIGINS = [
  "http://136.239.158.18:6610",
  "http://136.239.158.20:6610",
  "http://136.239.158.30:6610",
  "http://136.239.173.3:6610",
  "http://136.158.97.2:6610",
  "http://136.239.173.10:6610",
  "http://136.239.158.10:6610",
  "http://136.239.159.20:6610"
];

const BASE_START = 46489952;
const STEP = 6;

const BASEURL_REGEX = /<BaseURL>.*?<\/BaseURL>/gs;
const MPD_TAG_REGEX = /<MPD([^>]*)>/;

/* =========================
   HTTP KEEP-ALIVE AGENT
========================= */

const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 1024,
  maxFreeSockets: 256,
  timeout: 30000
});

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: "*" }));

/* =========================
   FAST ROTATORS
========================= */

let originIndex = 0;
const ORIGIN_LEN = ORIGINS.length;

const getOrigin = () => ORIGINS[(originIndex = (originIndex + 1) % ORIGIN_LEN)];

const rotateStartNumber = () => BASE_START + ((Date.now() / 2000) | 0) * STEP;
const rotateIAS = () => `RR${Date.now()}`;
const rotateUserSession = () => `${Date.now().toString(36)}${(Math.random() * 1e6 | 0)}`;

/* =========================
   HOME
========================= */

app.get("/", (_, res) => {
  res.send("✅ DASH MPD Proxy running (Fast + Pre-fetch + Auto Retry)");
});

/* =========================
   UTILITY: Fetch segment with retry
========================= */

async function fetchSegment(url, headers, maxAttempts = ORIGINS.length) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const upstream = await fetch(url, { headers, agent });
      if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
      return upstream;
    } catch (err) {
      console.error(`❌ Segment fetch attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw new Error("All origins failed for segment fetch");
}

/* =========================
   DASH PROXY WITH PREFETCH
========================= */

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const ztecid = `ch0000009099000000${channelId}`;

  const headers = {
    "User-Agent": req.headers["user-agent"] || "OTT",
    "Accept": "*/*",
    "Connection": "keep-alive",
    ...(req.headers.range && { Range: req.headers.range })
  };

  const baseUpstreamURL = (origin) =>
    `${origin}/001/2/${ztecid}/${path}` +
    (path.includes("?") ? "&" : "?") +
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${rotateStartNumber()}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&ztecid=${ztecid}` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  try {
    if (path.endsWith(".mpd")) {
      // Fetch and rewrite MPD
      const upstream = await fetchSegment(baseUpstreamURL(getOrigin()), headers);
      let mpd = await upstream.text();
      const proxyBaseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;
      mpd = mpd.replace(BASEURL_REGEX, "").replace(
        MPD_TAG_REGEX,
        `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      res.send(mpd);
      return;
    }

    // For segments: pre-fetch next segment
    const segmentStream = async (url) => {
      const upstream = await fetchSegment(url, headers);
      return upstream.body;
    };

    const currentURL = baseUpstreamURL(getOrigin());
    const nextURL = baseUpstreamURL(getOrigin()); // naive: could calculate next segment

    // Start pre-fetching next segment (non-blocking)
    const nextSegmentPromise = segmentStream(nextURL).catch(() => null);

    // Pipe current segment
    const currentStream = await segmentStream(currentURL);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    currentStream.pipe(res);

    // Optionally, you could pipe nextSegmentPromise to a temporary buffer
    // for faster delivery when the client requests it

  } catch (err) {
    console.error(`❌ Error fetching segment: ${err.message}`);
    res.sendStatus(502);
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (Fast Rotation + Pre-fetch + Auto Retry enabled)`);
});
