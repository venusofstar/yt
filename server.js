const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const agent = new http.Agent({ keepAlive: true, maxSockets: 500 });

/* ORIGIN LIST */
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

/* SESSION ROTATION HELPERS */
function rotateStartNumber() {
  const base = 46489952;
  const step = 6;
  return base + Math.floor(Math.random() * 100000) * step;
}

function rotateIAS() {
  return "RR" + Date.now() + Math.random().toString(36).slice(2, 10);
}

function rotateUserSession() {
  return Math.floor(Math.random() * 1e15).toString();
}

/* CACHE PER IP */
const sessions = new Map();
function getSession(ip) {
  if (!sessions.has(ip)) {
    sessions.set(ip, {
      startNumber: rotateStartNumber(),
      IAS: rotateIAS(),
      user: rotateUserSession()
    });
  }
  return sessions.get(ip);
}

/* BUILD URL */
function buildURL(origin, channelId, path, session) {
  const base = `${origin}/001/2/ch0000009099000000${channelId}/`;
  const auth = `JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1&NeedJITP=1&isjitp=0&startNumber=${session.startNumber}&filedura=6&ispcode=55&IASHttpSessionId=${session.IAS}&usersessionid=${session.user}`;
  return path.includes("?") ? `${base}${path}&${auth}` : `${base}${path}?${auth}`;
}

/* HELPER TO GET CLIENT IP */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
}

/* FETCH SEGMENT WITH FAILOVER */
async function fetchSegment(channelId, path, ip, maxRetries = 3) {
  let originIndex = Math.floor(Math.random() * ORIGINS.length);
  let session = getSession(ip);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const origin = ORIGINS[originIndex % ORIGINS.length];
    const url = buildURL(origin, channelId, path, session);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const upstream = await fetch(url, { agent, signal: controller.signal, headers: { "User-Agent": "OTT", "Accept": "*/*" } });
      clearTimeout(timeout);

      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);

      return upstream.body; // Return stream for piping

    } catch (err) {
      clearTimeout(timeout);
      console.warn(`Segment fetch failed (attempt ${attempt + 1}) from ${origin}: ${err.message}`);
      // Rotate session & origin
      originIndex++;
      session = {
        startNumber: rotateStartNumber(),
        IAS: rotateIAS(),
        user: rotateUserSession()
      };
      sessions.set(ip, session);
    }
  }

  throw new Error("All origins failed for this segment");
}

/* ROUTE */
app.get("/:channelId/*", async (req, res) => {
  const { channelId } = req.params;
  const path = req.params[0];
  const ip = getClientIP(req);

  if (path.endsWith(".mpd")) {
    try {
      // For MPD, fetch first available origin
      let originIndex = Math.floor(Math.random() * ORIGINS.length);
      let session = getSession(ip);

      let mpdText;
      for (let attempt = 0; attempt < ORIGINS.length; attempt++) {
        const origin = ORIGINS[(originIndex + attempt) % ORIGINS.length];
        const url = buildURL(origin, channelId, path, session);

        try {
          const upstream = await fetch(url, { agent, headers: { "User-Agent": "OTT", "Accept": "*/*" } });
          if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
          mpdText = await upstream.text();
          break; // Success
        } catch (err) {
          console.warn(`MPD fetch failed from ${origin}: ${err.message}`);
          // rotate session
          session = {
            startNumber: rotateStartNumber(),
            IAS: rotateIAS(),
            user: rotateUserSession()
          };
          sessions.set(ip, session);
        }
      }

      if (!mpdText) throw new Error("All origins failed for MPD");

      const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;
      mpdText = mpdText.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");
      mpdText = mpdText.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${baseURL}</BaseURL>`);
      mpdText = mpdText.replace(/&m4s_min=1/g, "");

      res.set({ "Content-Type": "application/dash+xml", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      return res.send(mpdText);

    } catch (err) {
      console.warn(err.message);
      return res.status(502).send("MPD unavailable");
    }
  } else {
    // Media segments
    res.set({ "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" });

    try {
      const segmentStream = await fetchSegment(channelId, path, ip, 5); // 5 retries per segment
      segmentStream.on("error", err => {
        console.warn("Stream chunk error:", err.message);
        res.end();
      });
      segmentStream.pipe(res);
      segmentStream.on("end", () => res.end());
    } catch (err) {
      console.warn(err.message);
      res.status(502).send("Segment unavailable after retries");
    }
  }
});

/* START SERVER */
app.listen(PORT, () => console.log(`🚀 DASH Proxy running on port ${PORT}`));
