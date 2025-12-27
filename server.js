
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
const base = ${origin}/001/2/ch0000009099000000${channelId}/;
const auth = JITPDRMType=Widevine&virtualDomain=001.live_hls.zte.com&m4s_min=1&NeedJITP=1&isjitp=0&startNumber=${session.startNumber}&filedura=6&ispcode=55&IASHttpSessionId=${session.IAS}&usersessionid=${session.user};
return path.includes("?") ? ${base}${path}&${auth} : ${base}${path}?${auth};
}

/* ROUTE /
app.get("/:channelId/", async (req, res) => {
const { channelId } = req.params;
const path = req.params[0];
const ip = req.ip;

let originIndex = 0;
let session = getSession(ip);

const maxRetries = 3;

for (let attempt = 0; attempt < maxRetries; attempt++) {
const origin = ORIGINS[originIndex % ORIGINS.length];
const url = buildURL(origin, channelId, path, session);

try {  
  const upstream = await fetch(url, { agent, headers: { "User-Agent": "OTT", "Accept": "*/*" } });  

  if (!upstream.ok) throw new Error(`Upstream error ${upstream.status}`);  

  if (path.endsWith(".mpd")) {  
    let mpd = await upstream.text();  
    const baseURL = `${req.protocol}://${req.get("host")}/${channelId}/`;  
    mpd = mpd.replace(/<BaseURL>.*?<\/BaseURL>/gs, "");  
    mpd = mpd.replace(/<MPD([^>]*)>/, `<MPD$1><BaseURL>${baseURL}</BaseURL>`);  
    mpd = mpd.replace(/&m4s_min=1/g, ""); // bypass m4s_min for player  
    res.set({ "Content-Type": "application/dash+xml", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });  
    return res.send(mpd);  
  }  

  // Media segments  
  res.set({ "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" });  
  return upstream.body.pipe(res);  

} catch (err) {  
  console.warn(`❌ Attempt ${attempt + 1} failed: ${err.message}`);  
  // rotate origin and session  
  originIndex++;  
  session = {  
    startNumber: rotateStartNumber(),  
    IAS: rotateIAS(),  
    user: rotateUserSession()  
  };  
  sessions.set(ip, session);  
}

}

res.status(502).send("Stream unavailable after retries");
});

/* START SERVER */
app.listen(PORT, () => console.log(🚀 DASH Proxy running on port ${PORT}));
