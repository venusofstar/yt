const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");
const { PassThrough } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.raw({ type: "*/*" }));

// =========================
// KEEP ALIVE AGENTS
// =========================
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 300 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 300 });

// =========================
// ORIGINS (ZTE STYLE)
// =========================
const ORIGINS = [
  "http://143.44.136.67:6060",
  "http://136.239.158.18:6610"
];

// =========================
// DIRECT CHANNELS (MPD / HLS)
// =========================
const CHANNELS = {
  kapamilya:
    "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg01006-abs-cbn-kapcha-dash-abscbnono/ea9b1903-75d6-490a-95fc-0fc3f3165ba3/index.mpd"
};

// =========================
// SESSION STORE
// =========================
const sessions = new Map();

function createSession(id) {
  return {
    originIndex: Math.floor(Math.random() * ORIGINS.length),
    startNumber: 46489952 + Math.floor(Math.random() * 100000) * 6,
    IAS: "RR" + Date.now() + Math.random().toString(36).slice(2, 10),
    userSession: Math.floor(Math.random() * 1e15).toString(),
    ztecid: `ch0000009099000000${id}${Math.floor(Math.random() * 9000 + 1000)}`
  };
}

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, createSession(id));
  }
  return sessions.get(id);
}

function rotate(session) {
  session.originIndex = (session.originIndex + 1) % ORIGINS.length;
}

// cleanup sessions
setInterval(() => sessions.clear(), 10 * 60 * 1000);

// =========================
// FETCH WITH RETRY
// =========================
async function fetchUpstream(url, req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      agent: url.startsWith("https") ? httpsAgent : httpAgent,
      headers: {
        "User-Agent": req.headers["user-agent"] || "OTT",
        "Accept": "*/*",
        ...(req.headers.range ? { Range: req.headers.range } : {})
      },
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// =========================
// HOME
// =========================
app.get("/", (_, res) => {
  res.send("OK IPTV RESTREAM SERVER");
});

// =========================
// DIRECT MPD CHANNELS
// =========================
app.get("/:channelId/index.mpd", async (req, res) => {
  const url = CHANNELS[req.params.channelId];

  if (!url) return res.status(404).send("Channel not found");

  try {
    const upstream = await fetchUpstream(url, req);
    let mpd = await upstream.text();

    const proxyBase =
      `${req.protocol}://${req.get("host")}/${req.params.channelId}/`;

    mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
    mpd = mpd.replace(
      /<MPD([^>]*)>/,
      `<MPD$1><BaseURL>${proxyBase}</BaseURL>`
    );

    res.set({
      "Content-Type": "application/dash+xml",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });

    res.send(mpd);
  } catch (e) {
    res.status(502).send("MPD error");
  }
});

// =========================
// SEGMENTS (DIRECT CHANNELS fallback)
// =========================
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;

  // if direct MPD channel exists, but segment request
  const direct = CHANNELS[channelId];
  const session = getSession(channelId);

  const path = req.params[0];

  try {
    const upstream = await fetchUpstream(
      ORIGINS[session.originIndex] +
        `/001/2/ch0000009099000000${channelId}/${path}`,
      req
    );

    res.set({
      "Content-Type":
        upstream.headers.get("content-type") || "video/mp4",
      "Access-Control-Allow-Origin": "*"
    });

    const stream = new PassThrough();
    upstream.body.pipe(stream);
    stream.pipe(res);

    upstream.body.on("error", () => {
      rotate(session);
      stream.end();
    });
  } catch (e) {
    res.status(502).end();
  }
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log("🚀 IPTV server running on port", PORT);
});
