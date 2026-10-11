// "What should I do?" advice.
// Uses Gemini if GEMINI_API_KEY is set, else Anthropic if ANTHROPIC_API_KEY is set.
// If there is no key or the call fails, it falls back to advice built from the rule engine alerts.
//  - If Google renames or retires the model (404), the newest Gemini "flash" model is found and used automatically.
//  - status() explains what is wrong; the server shows it at /api/ai-status.
const SYSTEM =
  "You are Saarthi, a calm in-car safety co-pilot. Give the driver exactly 3 short imperative steps, " +
  "one per line, max 14 words each. Plain sentences only: no numbering, no labels like 'Step 1', no headings, no brackets. " +
  "If the situation is critical, the first step must tell them to stop driving safely.";

const DEFAULT_MODEL = "gemini-3.8-flash";
let resolvedModel = null;   // model found automatically if the default stops working
let lastError = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fallbackSteps(analysis) {
  const steps = [...new Set(analysis.alerts.filter((a) => a.severity !== "info").map((a) => a.action))].slice(0, 3);
  return steps.length ? steps : ["Conditions look safe.", "Keep a steady speed and a safe distance.", "Take a break every two hours."];
}

const parse = (text) =>
  text.split("\n").map((s) => s.replace(/^[\d\-.)•*\s]+/, "").trim()).filter(Boolean).slice(0, 3);

// Ask Google which models this key can use, and pick the newest normal "flash" model
async function autoPickModel() {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    signal: AbortSignal.timeout(10000), headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
  });
  if (!res.ok) return null;
  const list = (await res.json()).models || [];
  const names = list
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-\d/.test(n) && /flash/.test(n) && !/(lite|image|tts|live|audio|embed|exp|vision|robot|computer|8b|thinking)/.test(n));
  const version = (n) => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  names.sort((a, b) => version(b) - version(a) || (/preview|\d{3,}/.test(a) ? 1 : 0) - (/preview|\d{3,}/.test(b) ? 1 : 0) || a.length - b.length);
  return names[0] || null;
}

async function callGemini(prompt, system = SYSTEM) {
  let model = process.env.MODEL || resolvedModel || DEFAULT_MODEL, triedPick = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      if (!parts) throw new Error("Gemini returned no text (the reply was empty or blocked)");
      return parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
    }
    if (res.status === 404 && !triedPick) {          // model name no longer exists: find the current one
      triedPick = true;
      const picked = await autoPickModel().catch(() => null);
      if (picked && picked !== model) { console.log("Gemini model", model, "not found. Switching to", picked); model = resolvedModel = picked; attempt--; continue; }
    }
    if ((res.status === 503 || res.status === 429) && attempt < 3) { await sleep(1500 * attempt); continue; }  // busy: wait and retry
    throw new Error(`Gemini ${res.status} (model ${model}): ${(await res.text()).replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

async function callAnthropic(prompt, system = SYSTEM) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.MODEL || "claude-sonnet-5-5", max_tokens: 200, system, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 200)}`);
  return (await res.json()).content[0].text;
}

async function getAdvice(scenario, analysis, trendInfo) {
  const prompt = JSON.stringify({
    situation: scenario.name, readings: scenario.data, riskScore: analysis.score, riskLevel: analysis.level,
    alerts: analysis.alerts.map((a) => `${a.severity}: ${a.title} (${a.detail})`), trends: trendInfo.messages,
  });
  const call = process.env.GEMINI_API_KEY ? callGemini : process.env.ANTHROPIC_API_KEY ? callAnthropic : null;
  if (!call) lastError = "No API key is set";
  else {
    try {
      const raw = await call(prompt);
      console.log("LLM raw reply:", JSON.stringify(raw));
      const steps = parse(raw);
      if (steps.length === 3 && steps.every((t) => t.length >= 15 && !/^step\s*\d/i.test(t))) { lastError = ""; return { source: "ai", steps }; }
      lastError = "The AI reply was not 3 clear steps";
      console.warn("LLM reply looked wrong, using fallback");
    } catch (e) {
      lastError = e.message;
      console.warn("LLM failed, using fallback:", e.message);
    }
  }
  return { source: "offline", steps: fallbackSteps(analysis), reason: lastError };
}

// ---- Diagnosis: open /api/ai-status in the browser to see what is wrong ----
const hint = (m) =>
  /No API key/i.test(m) ? "The server cannot see a key. Add GEMINI_API_KEY (Render: Environment tab, then redeploy; Codespace: export it, then restart the server)." :
  / 40[013] /.test(m) || /API key|API_KEY|permission|PERMISSION/.test(m) ? "Google rejected the key. Create a new key in Google AI Studio and set it again, with no spaces or quotes." :
  / 404 /.test(m) ? "The model name was not found and none could be picked automatically. Set the MODEL variable to a current Gemini flash model name." :
  / 429 /.test(m) ? "Free-tier limit reached. Wait a minute, or use another key." :
  / 503 /.test(m) ? "Google's model is busy right now. Try again in a minute." :
  /aborted|timeout|fetch failed/i.test(m) ? "The server could not reach Google. Check the internet connection." :
  "See the message above.";
let cached = null;
async function status() {
  if (cached && Date.now() - cached.at < 30000) return cached.v;
  const v = { geminiKeyFound: !!process.env.GEMINI_API_KEY, anthropicKeyFound: !!process.env.ANTHROPIC_API_KEY, modelInUse: process.env.MODEL || resolvedModel || DEFAULT_MODEL };
  if (!v.geminiKeyFound && !v.anthropicKeyFound) { v.ok = false; v.problem = "No API key found"; }
  else {
    try {
      const t = await (v.geminiKeyFound ? callGemini : callAnthropic)("Reply with the single word OK.", "Reply briefly.");
      v.ok = true; v.reply = t.trim().slice(0, 40); v.modelInUse = process.env.MODEL || resolvedModel || DEFAULT_MODEL;
    } catch (e) { v.ok = false; v.problem = e.message; }
  }
  if (!v.ok) v.whatToDo = hint(v.problem);
  cached = { at: Date.now(), v };
  return v;
}

module.exports = { getAdvice, status, _test: { autoPickModel } };