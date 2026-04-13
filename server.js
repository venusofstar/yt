const express = require("express");
const fetch = require("node-fetch");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

const UPSTREAM =
  "https://cdn-ue1-prod.tsv2.amagi.tv/linear/amg01006-abs-cbn-kapcha-dash-abscbnono/ea9b1903-75d6-490a-95cf-0fc3f3165ba3/index.mpd";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: "https://www.iwanttfc.com/",
  Origin: "https://www.iwanttfc.com",
  Accept: "*/*",
  Connection: "keep-alive",
};

// CORS for all players / web apps
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function makeProxyUrl(req, targetUrl) {
  return `${req.protocol}://${req.get("host")}/proxy?url=${encodeURIComponent(
    targetUrl
  )}`;
}

// Resolve relative URLs safely
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

// =========================
// UNIVERSAL MPD PROXY
// =========================
app.get("/manifest.mpd", async (req, res) => {
  try {
    const response = await fetch(UPSTREAM, { headers: HEADERS });

    if (!response.ok) {
      return res.status(response.status).send("Failed to fetch MPD");
    }

    let mpd = await response.text();
    const upstreamBase = UPSTREAM.substring(0, UPSTREAM.lastIndexOf("/") + 1);

    // Replace existing BaseURL with proxy URL
    mpd = mpd.replace(
      /<BaseURL>(.*?)<\/BaseURL>/g,
      (_, path) => {
        const full = resolveUrl(upstreamBase, path);
        return `<BaseURL>${makeProxyUrl(req, full)}</BaseURL>`;
      }
    );

    // Inject BaseURL if missing
    if (!/<BaseURL>/.test(mpd)) {
      mpd = mpd.replace(
        /<MPD[^>]*>/,
        (m) => `${m}\n<BaseURL>${makeProxyUrl(req, upstreamBase)}</BaseURL>`
      );
    }

    // Rewrite absolute URLs inside MPD
    mpd = mpd.replace(
      /(https?:\/\/[^\s"'<]+)/g,
      (url) => makeProxyUrl(req, url)
    );

    res.setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Cache-Control", "no-cache");
    res.send(mpd);
  } catch (err) {
    console.error("MPD Error:", err.message);
    res.status(500).send("MPD fetch error");
  }
});

// =========================
// UNIVERSAL SEGMENT / FILE PROXY
// =========================
async function proxyHandler(req, res) {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("Missing URL");

    const headers = { ...HEADERS };

    if (req.headers.range) headers.Range = req.headers.range;

    const response = await fetch(url, {
      method: req.method,
      headers,
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (!["content-encoding", "transfer-encoding"].includes(k)) {
        res.setHeader(key, value);
      }
    });

    if (req.method === "HEAD") {
      return res.end();
    }

    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy Error:", err.message);
    res.status(500).send("Proxy error");
  }
}

app.get("/proxy", proxyHandler);
app.head("/proxy", proxyHandler);

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("Universal DASH Proxy Running");
});

app.listen(PORT, () => {
  console.log(`🚀 DASH proxy ready: http://localhost:${PORT}/manifest.mpd`);
});
