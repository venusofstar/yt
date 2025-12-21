
import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// SOURCE MPDs
// ==========================
const SOURCES = {
nba1: "http://143.44.136.67:6060/001/2/ch00000090990000001093/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1",
nba2: "http://143.44.136.67:6060/001/2/ch00000090990000001286/manifest.mpd?JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1"
};

// ==========================
// Proxy MPD
// ==========================
app.get("/:channel/manifest.mpd", async (req, res) => {
const sourceUrl = SOURCES[req.params.channel];
if (!sourceUrl) return res.status(404).send("Channel not found");

try {
const response = await fetch(sourceUrl, {
headers: {
"User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
"Referer": "http://143.44.136.67/",
},
});
res.set("Content-Type", "application/dash+xml");
response.body.pipe(res);
} catch (err) {
res.status(500).send("MPD fetch error");
}
});

// ==========================
// Proxy all segments (.m4s, .mp4)
// ==========================
app.get("/*", async (req, res) => {
const targetUrl = "http://143.44.136.67:6060" + req.originalUrl;

try {
const response = await fetch(targetUrl, {
headers: {
"User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
"Referer": "http://143.44.136.67/",
},
});
response.body.pipe(res);
} catch (err) {
res.status(404).send("Segment not found");
}
});

app.listen(PORT, () => {
console.log("MPD restream running on port", PORT);
});
