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

const rotateStartNumber = () =>
  BASE_START + ((Date.now() / 2000) | 0) * STEP;

const rotateIAS = () => `RR${Date.now()}`;
const rotateUserSession = () => `${Date.now().toString(36)}${(Math.random() * 1e6 | 0)}`;

/* =========================
   HOME
========================= */

app.get("/", (_, res) => {
  res.send("✅ Ultra-Resilient DASH Proxy Running");
});

/* =========================
   DASH PROXY WITH CONTINUOUS RECOVERY
========================= */

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

  const ztecid = `ch0000009099000000${channelId}`;
  let attempt = 0;
  const maxAttempts = ORIGINS.length;

  // PassThrough allows continuous streaming
  const passThrough = new stream.PassThrough();
  passThrough.pipe(res);

  const fetchSegment = async () => {
    const origin = getOrigin();
    const upstreamBase = `${origin}/001/2/ch0000009099000000${channelId}/`;

    const authParams =
      `JITPDRMType=Widevine` +
      `&virtualDomain=001.live_hls.zte.com` +
      `&m4s_min=1` +                     // untouched
      `&NeedJITP=1` +
      `&isjitp=0` +
      `&startNumber=${rotateStartNumber()}` +
      `&filedura=6` +
      `&ispcode=55` +
      `&ztecid=${ztecid}` +
      `&IASHttpSessionId=${rotateIAS()}` +
      `&usersessionid=${rotateUserSession()}`;

    const targetURL = path.includes("?")
      ? `${upstreamBase}${path}&${authParams}`
      : `${upstreamBase}${path}?${authParams}`;

    try {
      const upstream = await fetch(targetURL, {
        agent,
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*",
          "Connection": "keep-alive",
          ...(req.headers.range && { Range: req.headers.range })
        }
      });

      if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);

      // MPD handling
      if (path.endsWith(".mpd")) {
        let mpd = await upstream.text();
        const proxyBaseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;

        mpd = mpd
          .replace(BASEURL_REGEX, "")
          .replace(MPD_TAG_REGEX, `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`);

        res.set({
          "Content-Type": "application/dash+xml",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        });

        passThrough.end(mpd);
        return;
      }

      // Pipe segment to PassThrough
      upstream.body.pipe(passThrough, { end: false });
      upstream.body.on("end", () => {
        // Segment finished successfully
      });

      upstream.body.on("error", async (err) => {
        console.error("Segment error, retrying...", err.message);
        await retrySegment();
      });

    } catch (err) {
      console.error("Fetch error:", err.message);
      await retrySegment();
    }
  };

  const retrySegment = async () => {
    attempt++;
    if (attempt <= maxAttempts) {
      console.log(`🔄 Retrying segment (attempt ${attempt}) with new origin...`);
      await fetchSegment();
    } else {
      console.error("❌ All origins failed for this segment");
      passThrough.end();
    }
  };

  // Start fetching
  await fetchSegment();
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Ultra-Resilient DASH Proxy running (Fast + Full Stock + Auto-Recovery)`);
});
