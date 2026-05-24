const express = require("express");
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const app = express();

const US_PROXY =
  "http://162.253.68.97:4145";

const agent = new HttpsProxyAgent(US_PROXY);

app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;

    const response = await fetch(url, {
      agent,
      headers: {
        "User-Agent":
          "Mozilla/5.0",
        "Origin":
          "https://www.peacocktv.com",
        "Referer":
          "https://www.peacocktv.com/"
      }
    });

    const contentType =
      response.headers.get("content-type");

    res.setHeader(
      "Content-Type",
      contentType
    );

    response.body.pipe(res);

  } catch (e) {
    res.status(500).send(e.toString());
  }
});

app.listen(3000);
