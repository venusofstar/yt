const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const { pipeline } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// KEEP-ALIVE AGENTS
// =========================
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 200,
  keepAliveMsecs: 30000
});

// =========================
// ORIGINS
// =========================
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

const channelOriginMap = new Map();
let rr = 0;

// =========================
// PRELOAD CACHE
// =========================
const preloadCache = new Map();

// =========================
// ORIGIN SELECTORS
// =========================
function getStickyOrigin(channelId) {
  if (!channelOriginMap.has(channelId)) {
    channelOriginMap.set(channelId, ORIGINS[rr++ % ORIGINS.length]);
  }
  return channelOriginMap.get(channelId);
}

// =========================
// AUTH ROTATION
// =========================
const rotateStartNumber = () =>
  46489952 + Math.floor(Math.random() * 100000) * 6;

const rotateIAS = () =>
  "RR" + Date.now() + Math.random().toString(36).slice(2, 10);

const rotateUserSession = () =>
  Math.floor(Math.random() * 1e15).toString();

// =========================
// FAILOVER FETCH
// =========================
async function fetchWithFailover(urlBuilder, options, channelId) {
  const tried = new Set();
  let lastErr;

  for (let i = 0; i < ORIGINS.length; i++) {
    const origin = getStickyOrigin(channelId);
    tried.add(origin);

    try {
      const res = await fetch(urlBuilder(origin), options);
      if (res.ok) return { res, origin };
      lastErr = res.status;
    } catch (e) {
      lastErr = e.message;
    }

    channelOriginMap.delete(channelId);
    const next = ORIGINS.find(o => !tried.has(o));
    if (next) channelOriginMap.set(channelId, next);
  }

  throw new Error(`All origins failed: ${lastErr}`);
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("✅ DASH MPD → MPD Proxy (FAILOVER + PRELOAD)");
});

// =========================
// DASH PROXY
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];

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

  const buildURL = (origin) => {
    const base =
      `${origin}/001/2/ch0000009099000000${channelId}/`;
    return path.includes("?")
      ? `${base}${path}&${authParams}`
      : `${base}${path}?${authParams}`;
  };

  try {
    const { res: upstream, origin } = await fetchWithFailover(
      buildURL,
      {
        agent: buildURL("https").startsWith("https")
          ? httpsAgent
          : httpAgent,
        headers: {
          "User-Agent": req.headers["user-agent"] || "OTT",
          "Accept": "*/*",
          "Range": req.headers.range || "",
          "Connection": "keep-alive"
        }
      },
      channelId
    );

    channelOriginMap.set(channelId, origin);

    // =========================
    // MPD HANDLING
    // =========================
    if (path.endsWith(".mpd")) {
      let mpd = await upstream.text();

      const proxyBase =
        `${req.protocol}://${req.get("host")}/${channelId}/`;

      mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpd = mpd.replace(
        /<MPD([^>]*)>/,
        `<MPD$1><BaseURL>${proxyBase}</BaseURL>`
      );

      res.set({
        "Content-Type": "application/dash+xml",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });

      return res.send(mpd);
    }

    // =========================
    // SEGMENT PRELOAD
    // =========================
    if (path.endsWith(".m4s")) {
      const m = path.match(/(\d+)\.m4s/);
      if (m) {
        const nextPath = path.replace(m[1], Number(m[1]) + 1);
        const preloadURL = buildURL(origin).replace(path, nextPath);

        if (!preloadCache.has(preloadURL)) {
          preloadCache.set(preloadURL, true);
          fetch(preloadURL, {
            agent: preloadURL.startsWith("https")
              ? httpsAgent
              : httpAgent,
            headers: { "User-Agent": "OTT" }
          }).catch(() => {});
          setTimeout(() => preloadCache.delete(preloadURL), 3000);
        }
      }
    }

    // =========================
    // STREAM PIPE
    // =========================
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    res.set({
      "Cache-Control": "public, max-age=1",
      "Access-Control-Allow-Origin": "*"
    });

    pipeline(upstream.body, res, err => {
      if (err) res.destroy();
    });

  } catch (err) {
    console.error("❌ Proxy error:", err.message);
    channelOriginMap.delete(channelId);
    res.sendStatus(502);
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`✅ DASH Proxy running on port ${PORT}`);
});
