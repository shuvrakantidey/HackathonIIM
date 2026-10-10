// Owner password security. Uses the compiled C++ module (./owner_tool) when it exists,
// and falls back to Node's built-in crypto if it was not built. Both produce the same
// PBKDF2-HMAC-SHA256 hashes, so they are interchangeable.
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BIN = path.join(__dirname, "owner_tool");
const ITERATIONS = 100000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const isHex = (s) => /^[0-9a-f]+$/i.test(s) && s.length % 2 === 0;

function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("timeout")); }, 5000);
    p.stdout.on("data", (d) => (out += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error("exit " + code)); });
    p.stdin.on("error", () => {});
    p.stdin.end(input || "");
  });
}

const jsHash = (pw, saltHex) =>
  crypto.pbkdf2Sync(Buffer.from(pw, "utf8"), Buffer.from(saltHex, "hex"), ITERATIONS, 32, "sha256").toString("hex");

async function generate() {
  if (fs.existsSync(BIN)) {
    try { return { ...JSON.parse(await run(["generate"])), engine: "C++" }; } catch (e) { console.warn("C++ module failed, using Node fallback:", e.message); }
  }
  let pw = "";
  for (let i = 0; i < 12; i++) { pw += ALPHABET[crypto.randomInt(ALPHABET.length)]; if (i === 3 || i === 7) pw += "-"; }
  const salt = crypto.randomBytes(16).toString("hex");
  return { password: pw, salt, hash: jsHash(pw, salt), engine: "Node.js (C++ module not built)" };
}

async function verify(password, saltHex, hashHex) {
  if (!isHex(saltHex) || !isHex(hashHex) || String(password).length > 100) return false;
  if (fs.existsSync(BIN)) {
    try { return (await run(["verify", saltHex, hashHex], password + "\n")).trim() === "ok"; } catch (e) { /* fall through */ }
  }
  const got = Buffer.from(jsHash(String(password), saltHex), "hex"), want = Buffer.from(hashHex, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { generate, verify };
