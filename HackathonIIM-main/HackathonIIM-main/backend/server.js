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
  console.log("Starting with empty event data.");
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

function send(
  res,
  statusCode,
  body,
  contentType = "application/json"
) {
  if (res.writableEnded) return;

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
  let tooLarge = false;

  req.on("data", (chunk) => {
    if (tooLarge) return;

    body += chunk;

    if (body.length > 3000) {
      tooLarge = true;
      send(res, 413, { error: "Request too large" });
    }
  });

  req.on("end", async () => {
    if (tooLarge) return;

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
  const unlocks = list.filter(
    (event) => event.type === "unlock"
  );

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

function servePublicFile(res, filename) {
  const safeRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(safeRoot, filename);

  if (
    filePath !== safeRoot &&
    !filePath.startsWith(safeRoot + path.sep)
  ) {
    return send(res, 403, { error: "Forbidden" });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      console.error(
        `Could not read ${filename}:`,
        error.message
      );

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
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };

    res.writeHead(200, {
      "Content-Type":
        contentTypes[extension] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });

    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  // FIXED: Use backticks around the URL.
  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname;

  // Dashboard scenarios
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

  // Dashboard trends
  if (req.method === "GET" && pathname === "/api/trends") {
    return send(res, 200, trendInfo);
  }

  // AI status
  if (req.method === "GET" && pathname === "/api/ai-status") {
    try {
      return send(res, 200, await aiStatus());
    } catch (error) {
      console.error("AI status error:", error.message);

      return send(res, 500, {
        error: "AI status unavailable",
      });
    }
  }

  // AI advice
  if (req.method === "POST" && pathname === "/api/advice") {
    return readJson(req, res, async (body) => {
      const scenario = scenarios[body.index];

      if (!scenario) {
        return send(res, 400, {
          error: "Unknown scenario",
        });
      }

      const advice = await getAdvice(
        scenario,
        analyze(scenario.data),
        trendInfo
      );

      return send(res, 200, advice);
    });
  }

  // Log lock/unlock events
  if (req.method === "POST" && pathname === "/api/log") {
    return readJson(req, res, (body) => {
      if (!TYPES.includes(body.type)) {
        return send(res, 400, {
          error: "Bad event",
        });
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

  // Register vehicle owner
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
        return send(res, 503, {
          error: "Owner limit reached.",
        });
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
  if (
    req.method === "POST" &&
    pathname === "/api/owner/login"
  ) {
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

      let valid = false;

      if (owner) {
        valid = await ownerTool.verify(
          String(body.password || ""),
          owner.salt,
          owner.hash
        );
      }

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

  // Owner event history
  if (req.method === "GET" && pathname === "/api/log") {
    const token = String(
      req.headers["x-owner-token"] || ""
    );

    const session = sessions.get(token);

    if (!session || session.expires < Date.now()) {
      sessions.delete(token);

      return send(res, 401, {
        error: "Session expired",
      });
    }

    const owner = owners[session.key];

    if (!owner) {
      sessions.delete(token);

      return send(res, 401, {
        error: "Owner not found",
      });
    }

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

  // Road Level Detector page
  if (
    req.method === "GET" &&
    pathname === "/road-scan.html"
  ) {
    return servePublicFile(res, "road-scan.html");
  }

  // Serve other existing files from the public folder.
  if (req.method === "GET") {
    const filename = path.basename(pathname);

    if (
      filename &&
      filename !== "." &&
      filename !== ".." &&
      pathname !== "/"
    ) {
      return servePublicFile(res, filename);
    }
  }

  return send(res, 404, {
    error: "Not found",
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Saarthi AI running on port ${PORT}`);
  console.log(`Port: ${PORT}`);
  console.log("Dashboard route: /");
  console.log("Road Level Detector route: /road-scan.html");
});

server.on("error", (error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});
