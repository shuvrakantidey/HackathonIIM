// Rule engine: turns one scenario's data into status, alerts and a 0-100 risk score.
const hi = (v, w, c) => (v >= c ? "critical" : v >= w ? "warning" : "ok");
const lo = (v, w, c) => (v <= c ? "critical" : v <= w ? "warning" : "ok");
const rank = { critical: 3, warning: 2, info: 1 };

function analyze(d) {
  const status = {
    fatigue: hi(d.fatigue, 60, 85),
    drivingHours: hi(d.drivingHours, 3, 5),
    distraction: hi(d.distraction, 20, 40),
    tyrePressure: lo(d.tyrePressure, 29, 25),
    engineTemp: hi(d.engineTemp, 95, 105),
    rain: d.rain === "heavy" ? "warning" : "ok",
  };
  const alerts = [];
  const add = (severity, title, detail, action) => alerts.push({ severity, title, detail, action });

  if (status.fatigue !== "ok")
    add(status.fatigue, status.fatigue === "critical" ? "Severe fatigue" : "Driver fatigue",
      `Fatigue level ${d.fatigue}%`,
      status.fatigue === "critical" ? "Pull over safely and rest before driving on." : "Take a break within 15 minutes.");
  if (status.drivingHours !== "ok")
    add(status.drivingHours, "Long drive", `${d.drivingHours} hours at the wheel`, "Stop, stretch and drink water.");
  if (status.distraction !== "ok")
    add(status.distraction, "Driver distracted", `Distraction level ${d.distraction}%`, "Put the phone away and eyes on the road.");
  if (status.tyrePressure !== "ok")
    add(status.tyrePressure, "Low tyre pressure", `${d.tyrePressure} PSI (normal 32-35)`,
      status.tyrePressure === "critical" ? "Slow down and stop to check the tyre." : "Check tyre pressure at the next stop.");
  if (status.engineTemp !== "ok")
    add(status.engineTemp, "Engine running hot", `${d.engineTemp} °C`,
      status.engineTemp === "critical" ? "Stop and switch off the engine to cool down." : "Reduce speed and watch the temperature.");
  if (d.rain === "heavy") add("warning", "Heavy rain", "Reduced grip and visibility", "Slow down and double your following distance.");
  if (d.rain === "light") add("info", "Wet road", "Light rain", "Keep a longer gap to the vehicle ahead.");

  // Compound risks: dangerous combinations
  let compound = 0;
  if (d.fatigue >= 60 && d.isNight) {
    compound++;
    add("critical", "Tired driving at night", "Fatigue and darkness together", "Stop at the next safe place and rest.");
  }
  if (d.rain === "heavy" && (d.isNight || d.tyrePressure < 30)) {
    compound++;
    add("warning", "Poor grip in heavy rain", d.tyrePressure < 30 ? "Low tyre pressure on wet road" : "Low visibility on wet road",
      "Reduce speed well below the limit.");
  }
  if (d.distraction >= 40 && d.isNight) {
    compound++;
    add("critical", "Distracted at night", "Low visibility and eyes off the road", "Stop using the phone right now.");
  }

  let score =
    d.fatigue * 0.3 + Math.min(d.drivingHours / 6, 1) * 15 + Math.min(d.distraction / 60, 1) * 20 +
    (d.rain === "heavy" ? 10 : d.rain === "light" ? 4 : 0) + (d.isNight ? 5 : 0) +
    Math.min(Math.max(0, 34 - d.tyrePressure) / 12, 1) * 10 + Math.min(Math.max(0, d.engineTemp - 85) / 25, 1) * 10 +
    compound * 10;
  if (alerts.some((a) => a.severity === "critical")) score = Math.max(score, 60);
  score = Math.min(100, Math.round(score));
  const level = score < 20 ? "safe" : score < 45 ? "caution" : score < 70 ? "high" : "critical";

  alerts.sort((a, b) => rank[b.severity] - rank[a.severity]);
  return { score, level, status, alerts };
}

// Slow-moving trends across past trips (predictive part)
function trends(h) {
  const n = h.length - 1;
  const tyreLoss = (h[0].tyre - h[n].tyre) / n;
  const batLoss = (h[0].battery - h[n].battery) / n;
  const tripsToLowTyre = tyreLoss > 0 ? Math.floor((h[n].tyre - 26) / tyreLoss) : null;
  const tripsToLowBattery = batLoss > 0 ? Math.floor((h[n].battery - 50) / batLoss) : null;
  const messages = [];
  if (tripsToLowTyre !== null && tripsToLowTyre <= 10)
    messages.push(`Tyre pressure is dropping about ${tyreLoss.toFixed(1)} PSI per trip, a possible slow leak. It could reach an unsafe level in about ${tripsToLowTyre} trips.`);
  if (tripsToLowBattery !== null && tripsToLowBattery <= 10)
    messages.push(`Battery health is falling about ${batLoss.toFixed(1)}% per trip. It could drop below 50% in about ${tripsToLowBattery} trips.`);
  return { history: h, tyreLossPerTrip: +tyreLoss.toFixed(2), batteryLossPerTrip: +batLoss.toFixed(2), tripsToLowTyre, tripsToLowBattery, messages };
}

module.exports = { analyze, trends };
