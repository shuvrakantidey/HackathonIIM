const SYSTEM =
  "You are Saarthi, a calm in-car safety co-pilot. Give the driver exactly 3 short imperative steps, " +
  "one per line, max 14 words each. Plain sentences only: no numbering, no labels like 'Step 1', no headings, no brackets. " +
  "If the situation is critical, the first step must tell them to stop driving safely.";

function fallbackSteps(analysis) {
  const steps = [...new Set(analysis.alerts.filter((a) => a.severity !== "info").map((a) => a.action))].slice(0, 3);
  return steps.length ? steps : ["Conditions look safe.", "Keep a steady speed and a safe distance.", "Take a break every two hours."];
}

const parse = (text) =>
  text.split("\n").map((s) => s.replace(/^[\d\-.)•*\s]+/, "").trim()).filter(Boolean).slice(0, 3);

async function callGemini(prompt, attempt = 1) {
  const model = process.env.MODEL || "gemini-3.8-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500 },
    }),
  });
  if ((res.status === 503 || res.status === 429) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500)); // busy right now: wait and retry
    return callGemini(prompt, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates[0].content.parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
}

async function callAnthropic(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.MODEL || "claude-sonnet-5-5",
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).content[0].text;
}

async function getAdvice(scenario, analysis, trendInfo) {
  const prompt = JSON.stringify({
    situation: scenario.name, readings: scenario.data, riskScore: analysis.score, riskLevel: analysis.level,
    alerts: analysis.alerts.map((a) => `${a.severity}: ${a.title} (${a.detail})`), trends: trendInfo.messages,
  });
  const call = process.env.GEMINI_API_KEY ? callGemini : process.env.ANTHROPIC_API_KEY ? callAnthropic : null;
  if (call) {
    try {
      const raw = await call(prompt);
      console.log("LLM raw reply:", JSON.stringify(raw));
      const steps = parse(raw);
      // Only trust a proper answer: 3 real sentences, otherwise use the offline advice
      if (steps.length === 3 && steps.every((t) => t.length >= 15 && !/^step\s*\d/i.test(t))) return { source: "ai", steps };
      console.warn("LLM reply looked wrong, using fallback");
    } catch (e) {
      console.warn("LLM failed, using fallback:", e.message);
    }
  }
  return { source: "offline", steps: fallbackSteps(analysis) };
}

module.exports = { getAdvice };