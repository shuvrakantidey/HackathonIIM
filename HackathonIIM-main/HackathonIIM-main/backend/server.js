```javascript
// Saarthi AI backend server
// Node.js 18+
// Run with: node server.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const scenarios = require("./scenarios");
const tripHistory = require("./vehiclehealth");
const { analyze, trends } = require("./ruleEngine");
const { getAdvice, status: aiStatus } = require("./llm");
const ownerTool = require("./ownerTool");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data.json");

const trendInfo = trends(tripHistory);
const TYPES = ["unlock", "lock", "denied"];

let owners = {};
let events = [];

try {
  ({ owners = {}, events = [] } = JSON.parse(
    fs.readFileSync(DATA_FILE, "utf8")
  ));
} catch (error) {
  // First run: start with empty data.
}

const save = () => {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ owners, events }, null, 2)
    );
  } catch (error) {
    console.error("Could not save data:", error.message);
  }
};

const lastUnlock = {};
const sessions = new Map();
const failTimes = {};

const normPlate = (plate) =>
  String(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const clean = (value, maxLength) =>
  String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, maxLength);

function send(res, statusCode, body, contentType = "application/json") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(
    typeof body === "string" ? body : JSON.stringify(body)
  );
}

function readJson(req, res, callback) {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;

    if (body.length > 3000) {
      send(res, 413, { error: "Request too large" });
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      await callback(JSON.parse(body || "{}"));
    } catch (error) {
      console.error("Request error:", error.message);

      if (!res.writableEnded) {
        send(res, 400, { error: "Bad request" });
      }
    }
  });
}

function statsFor(list) {
  const unlocks = list.filter((event) => event.type === "unlock");
  const last = [...list].reverse().find(
    (event) => event.type !== "denied"
  );

  return {
    unlocks: unlocks.length,
    drivers: new Set(unlocks.map((event) => event.name)).size,
    locks: list.filter((event) => event.type === "lock").length,
    denied: list.filter((event) => event.type === "denied").length,
    current:
      last && last.type === "unlock"
        ? {
            state: "unlocked",
            name: last.name,
            plate: last.plate,
            since: last.time,
          }
        : { state: "locked" },
  };
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname;

  // Existing dashboard APIs
  if (req.method === "GET" && pathname === "/api/scenarios") {
    return send(
      res,
      200,
      scenarios.map((scenario) => ({
        ...scenario,
        analysis: analyze(scenario.data),
      }))
    );
  }

  if (req.method === "GET" && pathname === "/api/trends") {
    return send(res, 200, trendInfo);
  }

  if (req.method === "GET" && pathname === "/api/ai-status") {
    try {
      return send(res, 200, await aiStatus());
    } catch (error) {
      return send(res, 500, { error: "AI status unavailable" });
    }
  }

  if (req.method === "POST" && pathname === "/api/advice") {
    return readJson(req, res, async (body) => {
      const scenario = scenarios[body.index];

      if (!scenario) {
        return send(res, 400, { error: "Unknown scenario" });
      }

      return send(
        res,
        200,
        await getAdvice(
          scenario,
          analyze(scenario.data),
          trendInfo
        )
      );
    });
  }

  // Driver lock/unlock event logging
  if (req.method === "POST" && pathname === "/api/log") {
    return readJson(req, res, (body) => {
      if (!TYPES.includes(body.type)) {
        return send(res, 400, { error: "Bad event" });
      }

      const now = Date.now();
      const name = clean(body.name, 40) || "Unknown";
      const plate = clean(body.plate, 20);
      const key = normPlate(plate);

      const event = {
        type: body.type,
        name,
        plate,
        plateKey: key,
        time: new Date(now).toISOString(),
        durationSec: null,
      };

      const who = key + "|" + name;

      if (body.type === "unlock") {
        lastUnlock[who] = now;
      }

      if (body.type === "lock" && lastUnlock[who]) {
        event.durationSec = Math.round(
          (now - lastUnlock[who]) / 1000
        );
        delete lastUnlock[who];
      }

      events.push(event);

      if (events.length > 1000) {
        events.shift();
      }

      save();
      return send(res, 200, { ok: true });
    });
  }

  // Owner registration
  if (
    req.method === "POST" &&
    pathname === "/api/owner/register"
  ) {
    return readJson(req, res, async (body) => {
      const plate = clean(body.plate, 15)
        .toUpperCase()
        .replace(/\s+/g, " ");

      const key = normPlate(plate);
      const name = clean(body.name, 40);

      if (key.length < 4 || !name) {
        return send(res, 400, {
          error: "Enter a vehicle number and the owner name.",
        });
      }

      if (owners[key]) {
        return send(res, 409, {
          error: "This vehicle number is already registered.",
        });
      }

      if (Object.keys(owners).length >= 100) {
        return send(res, 503, { error: "Owner limit reached." });
      }

      const generated = await ownerTool.generate();

      owners[key] = {
        plate,
        name,
        contact: clean(body.contact, 60),
        salt: generated.salt,
        hash: generated.hash,
        created: new Date().toISOString(),
      };

      save();

      return send(res, 200, {
        plate,
        password: generated.password,
        engine: generated.engine,
      });
    });
  }

  // Owner login
  if (req.method === "POST" && pathname === "/api/owner/login") {
    return readJson(req, res, async (body) => {
      const key = normPlate(body.plate);
      const now = Date.now();

      failTimes[key] = (failTimes[key] || []).filter(
        (time) => now - time < 60000
      );

      if (failTimes[key].length >= 5) {
        return send(res, 429, {
          error: "Too many wrong attempts",
        });
      }

      const owner = owners[key];

      const valid = owner
        ? await ownerTool.verify(
            String(body.password || ""),
            owner.salt,
            owner.hash
          )
        : (
            await ownerTool.verify("x", "00", "00"),
            false
          );

      if (!valid) {
        failTimes[key].push(now);

        return send(res, 401, {
          error: "Wrong vehicle number or password",
        });
      }

      const token = crypto.randomBytes(24).toString("hex");

      sessions.set(token, {
        key,
        expires: now + 15 * 60 * 1000,
      });

      return send(res, 200, { token });
    });
  }

  // Owner-specific event history
  if (req.method === "GET" && pathname === "/api/log") {
    const token = String(req.headers["x-owner-token"] || "");
    const session = sessions.get(token);

    if (!session || session.expires < Date.now()) {
      sessions.delete(token);

      return send(res, 401, {
        error: "Session expired",
      });
    }

    const owner = owners[session.key];
    const mine = events.filter(
      (event) => event.plateKey === session.key
    );

    return send(res, 200, {
      owner: {
        name: owner.name,
        plate: owner.plate,
      },
      events: [...mine].reverse(),
      stats: statsFor(mine),
    });
  }

  // Main dashboard
  if (
    req.method === "GET" &&
    (pathname === "/" || pathname === "/index.html")
  ) {
    return servePublicFile(res, "index.html");
  }

  // Road Level Detector interface
  if (
    req.method === "GET" &&
    pathname === "/road-scan.html"
  ) {
    return servePublicFile(res, "road-scan.html");
  }

  // Other static files inside backend/public
  if (req.method === "GET") {
    const allowed = new Set([
      "/favicon.ico",
      "/style.css",
      "/script.js",
    ]);

    if (allowed.has(pathname)) {
      return servePublicFile(res, pathname.slice(1));
    }
  }

  return send(res, 404, { error: "Not found" });
});

function servePublicFile(res, filename) {
  const filePath = path.resolve(PUBLIC_DIR, filename);

  // Prevent serving files outside the public directory.
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    return send(res, 403, { error: "Forbidden" });
  }

  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      return send(res, 404, {
        error: `File not found: ${filename}`,
      });
    }

    const extension = path.extname(filename).toLowerCase();

    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };

    return send(
      res,
      200,
      content,
      contentTypes[extension] || "application/octet-stream"
    );
  });
}

server.listen(PORT, () => {
  console.log(`Saarthi AI running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Road Level Detector: http://localhost:${PORT}/road-scan.html`);
});
```
