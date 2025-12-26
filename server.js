"use strict";

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const AbortController = require("abort-controller");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   CONSTANTS
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
const MPD_REGEX = /<MPD([^>]*)>/;

/* =========================
   KEEP-ALIVE AGENT
========================= */

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 512,
  maxFreeSockets: 128,
  timeout: 30000
});

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: "*" }));

/* =========================
   ROTATORS (FAST & STABLE)
========================= */

let originIndex = 0;
const getOrigin = () => ORIGINS[(originIndex++ % ORIGINS.length)];

const rotateStartNumber = () =>
  BASE_START + (Math.floor(Date.now() / 6000) % 100000) * STEP;

const rotateIAS = () => `RR${Date.now().toString(36)}`;
const rotateUserSession = () => Math.random().toString().slice(2);

/* =========================
   ROUTES
========================= */

app.get("/", (_, res) => {
  res.send("✅ DASH MPD Proxy – Ultra Fast Mode");
});

app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const origin = getOrigin();

  const upstreamBase =
    `${origin}/001/2/ch0000009099000000${channelId}/`;

  /* 🔥 m4s_min BYPASS */
  const authParams =
    `JITPDRMType=Widevine` +
    `&virtualDomain=001.live_hls.zte.com` +
    `&m4s_min=1` +                 // 🚀 bypassed
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const upstream = await fetch(targetURL, {
      agent,
      signal: controller.signal,
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        "Connection": "keep-alive",
        ...(req.headers.range && { Range: req.headers.range })
      }
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      res.sendStatus(upstream.status);
      return;
    }

    /* =========================
       MPD FAST REWRITE
    ========================= */

    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();
      const proxyBaseURL =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd
        .replace(BASEURL_REGEX, "")
        .replace(MPD_REGEX, `<MPD$1><BaseURL>${proxyBaseURL}</BaseURL>`);

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      res.send(mpd);
      return;
    }

    /* =========================
       SEGMENT STREAM
    ========================= */

    res.writeHead(upstream.status, {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Connection": "keep-alive"
    });

    upstream.body.pipe(res);

  } catch (e) {
    console.error("❌ Proxy Error:", e.message);
    res.sendStatus(502);
  }
});

/* =========================
   START
========================= */

app.listen(PORT, () =>
  console.log(`🚀 DASH Proxy running on port ${PORT}`)
);
