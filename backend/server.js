// Zero-dependency server. Run: node server.js  (Node 18+). Uses the PORT env var when hosted, else 3000.
// Owner password: set the OWNER_PASSWORD environment variable (defaults to "saarthi123" for local testing only).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const scenarios = require("./scenarios");
const tripHistory = require("./vehiclehealth");
const { analyze, trends } = require("./ruleEngine");
const { getAdvice } = require("./llm");

const trendInfo = trends(tripHistory);
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "saarthi123";
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest();
const passwordOk = (req) => crypto.timingSafeEqual(sha(req.headers["x-owner-password"] || ""), sha(OWNER_PASSWORD));

// Access log (kept in memory: it resets when the server restarts or a free host goes to sleep)
const events = [], lastUnlock = {};
let failTimes = [];
const TYPES = ["unlock", "lock", "denied"];
const clean = (t, n) => String(t || "").replace(/[\u0000-\u001f]/g, "").slice(0, n);

function stats() {
  const unlocks = events.filter((e) => e.type === "unlock");
  const last = [...events].reverse().find((e) => e.type !== "denied");
  return {
    unlocks: unlocks.length,
    drivers: new Set(unlocks.map((e) => e.name)).size,
    locks: events.filter((e) => e.type === "lock").length,
    denied: events.filter((e) => e.type === "denied").length,
    current: last && last.type === "unlock" ? { state: "unlocked", name: last.name, plate: last.plate, since: last.time } : { state: "locked" },
  };
}

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

  // Driver page reports unlock / lock / denied events (time is stamped here on the server)
  if (req.method === "POST" && req.url === "/api/log") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => {
      try {
        const b = JSON.parse(body);
        if (!TYPES.includes(b.type)) return send(res, 400, { error: "Bad event" });
        const now = Date.now(), name = clean(b.name, 40) || "Unknown";
        const ev = { type: b.type, name, plate: clean(b.plate, 20), time: new Date(now).toISOString(), durationSec: null };
        if (b.type === "unlock") lastUnlock[name] = now;
        if (b.type === "lock" && lastUnlock[name]) { ev.durationSec = Math.round((now - lastUnlock[name]) / 1000); delete lastUnlock[name]; }
        events.push(ev);
        if (events.length > 500) events.shift();
        send(res, 200, { ok: true });
      } catch (e) {
        send(res, 400, { error: "Bad request" });
      }
    });
    return;
  }

  // Owner reads the log (password required)
  if (req.method === "GET" && req.url === "/api/log") {
    const now = Date.now();
    failTimes = failTimes.filter((t) => now - t < 60000);
    if (failTimes.length >= 5) return send(res, 429, { error: "Too many wrong attempts" });
    if (!passwordOk(req)) { failTimes.push(now); return send(res, 401, { error: "Wrong password" }); }
    return send(res, 200, { events: [...events].reverse(), stats: stats(), defaultPassword: !process.env.OWNER_PASSWORD });
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html"))
    return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), "text/html");
  send(res, 404, { error: "Not found" });
}).listen(process.env.PORT || 3000, () => console.log("Saarthi AI running on port " + (process.env.PORT || 3000)));