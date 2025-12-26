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
const BUFFER_SIZE = 3; // number of segments to prefetch

const BASEURL_REGEX = /<BaseURL>.*?<\/BaseURL>/gs;
const MPD_TAG_REGEX = /<MPD([^>]*)>/;

/* =========================
   HTTP AGENT
========================= */

const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 1024,
  maxFreeSockets: 512,
  timeout: 30000
});

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: "*" }));

/* =========================
   ROTATORS
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
  res.send("✅ DASH Proxy running (Rolling Buffer + Pre-fetch + Auto Retry)");
});

/* =========================
   UTILITY: Fetch with retry
========================= */

async function fetchSegment(url, headers, maxAttempts = ORIGINS.length) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const origin = getOrigin();
    const finalURL = url.replace("{origin}", origin);
    try {
      const upstream = await fetch(finalURL, { agent, headers });
      if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
      return upstream;
    } catch (err) {
      console.error(`❌ Attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  throw new Error("All origins failed");
}

/* =========================
   DASH PROXY HANDLER
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

  const buildURL = (origin, startNumber = rotateStartNumber()) =>
    `${origin}/001/2/${ztecid}/${path}` +
    (path.includes("?") ? "&" : "?") +
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${startNumber}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&ztecid=${ztecid}` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  try {
    // MPD handling
    if (path.endsWith(".mpd")) {
      const upstream = await fetchSegment(buildURL(getOrigin()), headers);
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

    // Rolling buffer for segments
    let startNumber = rotateStartNumber();

    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    const sendSegment = async (number) => {
      const url = buildURL(getOrigin(), number);
      const upstream = await fetchSegment(url, headers);

      // Pipe the segment immediately
      await new Promise((resolve, reject) => {
        const passthrough = new stream.PassThrough();
        upstream.body.pipe(passthrough).pipe(res, { end: false });
        upstream.body.on("end", resolve);
        upstream.body.on("error", reject);
      });
    };

    while (true) {
      // Pre-fetch next BUFFER_SIZE segments
      const prefetch = [];
      for (let i = 0; i < BUFFER_SIZE; i++) {
        prefetch.push(sendSegment(startNumber + i * STEP));
      }

      // Wait for the first segment to finish before moving forward
      await prefetch[0];

      startNumber += STEP;
      // Continue loop; remaining prefetched segments will pipe as they finish
    }

  } catch (err) {
    console.error(`❌ Proxy error: ${err.message}`);
    if (!res.headersSent) res.sendStatus(502);
    else res.end();
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} (Rolling Buffer + Pre-fetch + Auto Retry enabled)`);
});
