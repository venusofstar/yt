"use strict";

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");

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
  maxSockets: 256,
  maxFreeSockets: 64,
  timeout: 60000
});

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: "*" }));

/* =========================
   ROTATORS (FAST)
========================= */

let originIndex = 0;
const getOrigin = () => {
  const o = ORIGINS[originIndex];
  originIndex = (originIndex + 1) % ORIGINS.length;
  return o;
};

const rotateStartNumber = () =>
  BASE_START + ((Math.random() * 100000) | 0) * STEP;

const rotateIAS = () =>
  `RR${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

const rotateUserSession = () =>
  (Math.random() * 1e15).toFixed(0);

/* =========================
   HOME
========================= */

app.get("/", (_, res) => {
  res.send("✅ DASH MPD → MPD Proxy is running");
});

/* =========================
   DASH PROXY
========================= */

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +
    `&NeedJITP=1` +
    `&isjitp=0` +
    `&startNumber=${rotateStartNumber()}` +
    `&filedura=6` +
    `&ispcode=55` +
    `&IASHttpSessionId=${rotateIAS()}` +
    `&usersessionid=${rotateUserSession()}`;

  const targetURL =
    path.includes("?")
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

    if (!upstream.ok) {
      res.sendStatus(upstream.status);
      return;
    }

    /* =========================
       MPD HANDLING
    ========================= */

    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBaseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd
        .replace(BASEURL_REGEX, "")
        .replace(MPD_TAG_REGEX, `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`);

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*"
      });

      res.send(mpd);
      return;
    }

    /* =========================
       SEGMENT STREAMING
    ========================= */

    res.status(upstream.status);
    res.set({
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });

    upstream.body.pipe(res);

  } catch (err) {
    console.error("❌ DASH Proxy Error:", err);
    res.sendStatus(502);
  }
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
