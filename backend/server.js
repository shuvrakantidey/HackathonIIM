// Zero-dependency server. Run: node server.js  (Node 18+), then open http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const scenarios = require("./scenarios");
const tripHistory = require("./vehiclehealth");
const { analyze, trends } = require("./ruleEngine");
const { getAdvice } = require("./llm");

const trendInfo = trends(tripHistory);
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/scenarios")
    return send(res, 200, scenarios.map((s) => ({ ...s, analysis: analyze(s.data) })));
  if (req.method === "GET" && req.url === "/api/trends") return send(res, 200, trendInfo);
  if (req.method === "POST" && req.url === "/api/advice") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const s = scenarios[JSON.parse(body).index];
        if (!s) return send(res, 400, { error: "Unknown scenario" });
        send(res, 200, await getAdvice(s, analyze(s.data), trendInfo));
      } catch (e) {
        send(res, 400, { error: "Bad request" });
      }
    });
    return;
  }
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html"))
    return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), "text/html");
  send(res, 404, { error: "Not found" });
}).listen(3000, () => console.log("Saarthi AI running at http://localhost:3000"));
