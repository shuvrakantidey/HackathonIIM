// "What should I do?" advice. Uses the Anthropic API if ANTHROPIC_API_KEY is set,
// otherwise (or if the call fails) falls back to advice built from the rule engine alerts.
const SYSTEM =
  "You are Saarthi, a calm in-car safety co-pilot. Give the driver exactly 3 short imperative steps, " +
  "one per line, no numbering, max 14 words each. If the situation is critical, the first step must tell them to stop driving safely.";

function fallbackSteps(analysis) {
  const steps = [...new Set(analysis.alerts.filter((a) => a.severity !== "info").map((a) => a.action))].slice(0, 3);
  return steps.length ? steps : ["Conditions look safe.", "Keep a steady speed and a safe distance.", "Take a break every two hours."];
}

async function getAdvice(scenario, analysis, trendInfo) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.MODEL || "claude-sonnet-5-5",
          max_tokens: 200,
          system: SYSTEM,
          messages: [{ role: "user", content: JSON.stringify({
            situation: scenario.name, readings: scenario.data, riskScore: analysis.score, riskLevel: analysis.level,
            alerts: analysis.alerts.map((a) => `${a.severity}: ${a.title} (${a.detail})`), trends: trendInfo.messages }) }],
        }),
      });
      if (!res.ok) throw new Error("API status " + res.status);
      const data = await res.json();
      const steps = data.content[0].text.split("\n").map((s) => s.replace(/^[\d\-.)•\s]+/, "").trim()).filter(Boolean).slice(0, 3);
      if (steps.length) return { source: "ai", steps };
    } catch (e) {
      console.warn("LLM failed, using fallback:", e.message);
    }
  }
  return { source: "offline", steps: fallbackSteps(analysis) };
}

module.exports = { getAdvice };
