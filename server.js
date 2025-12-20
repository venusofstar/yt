import express from "express";
import { request, Agent } from "undici";

const app = express();
const PORT = process.env.PORT || 3000;

/* ==========================
   HTTP AGENT (KEEP-ALIVE)
========================== */
const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  connections: 50,
});

/* ==========================
   SOURCE MPDs
========================== */
const SOURCES = {
  nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
  nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
};

const BASE_ORIGIN = "http://143.44.136.67:6060";

/* ==========================
   COMMON FETCH FUNCTION
========================== */
async function proxyRequest(targetUrl, req, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const { statusCode, headers, body } = await request(targetUrl, {
      method: "GET",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        "referer": "http://143.44.136.67/",
        "range": req.headers.range || undefined,
      },
      dispatcher: agent,
      signal: controller.signal,
    });

    res.status(statusCode);

    for (const [key, value] of Object.entries(headers)) {
      if (value) res.setHeader(key, value);
    }

    body.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).send("Upstream fetch failed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

/* ==========================
   MPD PROXY
========================== */
app.get("/:channel/manifest.mpd", async (req, res) => {
  const sourceUrl = SOURCES[req.params.channel];
  if (!sourceUrl) return res.status(404).send("Channel not found");

  await proxyRequest(sourceUrl, req, res);
});

/* ==========================
   SEGMENT PROXY (.m4s/.mp4)
========================== */
app.get("*", async (req, res) => {
  const targetUrl = BASE_ORIGIN + req.originalUrl;
  await proxyRequest(targetUrl, req, res);
});

/* ==========================
   SERVER
========================== */
app.disable("x-powered-by");

app.listen(PORT, () => {
  console.log(`MPD restream running on port ${PORT}`);
});
