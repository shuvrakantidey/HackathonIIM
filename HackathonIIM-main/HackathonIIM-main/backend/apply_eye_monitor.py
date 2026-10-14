#!/usr/bin/env python3
"""Adds a small EYE icon in the top-left corner. After the driver unlocks the car, the camera runs in the
background, tracks whether the driver's eyes are open or closed, and beeps if the eyes stay closed for 3 seconds.
Click the eye to pause or resume it. Video never leaves the browser (nothing is recorded or uploaded).

Run from the repo root:   python3 backend/apply_eye_monitor.py
Edits backend/public/index.html in place; stops without changing anything if the expected code is not found."""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "backend/public/index.html"
s = open(PATH, encoding="utf-8").read()
if 'id="eyeBtn"' in s:
    sys.exit("Already applied. Nothing to do.")

def stop(what):
    sys.exit(f"STOPPED: could not find '{what}'. Your file was NOT changed.")

# ---------- CSS ----------
css = '''#eyeBox{position:fixed;top:10px;left:10px;z-index:70;display:flex;align-items:center;gap:8px;pointer-events:none}
#eyeBtn{pointer-events:auto;width:40px;height:40px;border-radius:50%;border:2px solid #7d8590;background:rgba(12,16,24,.88);padding:6px;cursor:pointer;color:#9aa4b2;transition:color .2s,border-color .2s,background .2s}
#eyeBtn svg{width:100%;height:100%;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#eyeBtn .e-open,#eyeBtn .e-shut,#eyeBtn .e-off{display:none}
#eyeBtn.off .e-open,#eyeBtn.start .e-open,#eyeBtn.open .e-open,#eyeBtn.novis .e-open{display:inline}
#eyeBtn.off .e-off{display:inline}
#eyeBtn.closed .e-shut,#eyeBtn.alarm .e-shut{display:inline}
#eyeBtn.open{color:#1F8A70;border-color:#1F8A70}
#eyeBtn.closed,#eyeBtn.novis{color:#D99A00;border-color:#D99A00}
#eyeBtn.start{animation:eyeFade 1s infinite alternate}
#eyeBtn.alarm{color:#fff;background:#C8333D;border-color:#C8333D;animation:eyePulse .5s infinite alternate}
@keyframes eyePulse{to{transform:scale(1.18)}}
@keyframes eyeFade{to{opacity:.45}}
#eyeLbl{background:#C8333D;color:#fff;padding:4px 10px;border-radius:14px;font:600 14px/1.2 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
#eyeLbl[hidden]{display:none}
#eyeCam{position:fixed;left:0;top:0;width:8px;height:8px;opacity:.02;pointer-events:none;z-index:-1}
'''
if '</style>' not in s: stop("style block")
i = s.rindex('</style>')
s = s[:i] + css + s[i:]

# ---------- HTML ----------
if s.count('<body>') != 1: stop("<body>")
s = s.replace('<body>', '''<body>
<video id="eyeCam" autoplay muted playsinline aria-hidden="true"></video>
<div id="eyeBox">
  <button id="eyeBtn" class="eye off" title="Eye monitor starts after the car is unlocked" aria-label="Driver eye monitor">
    <svg viewBox="0 0 32 32">
      <path class="e-open" d="M2 16C6 9.5 10.5 7 16 7s10 2.5 14 9c-4 6.5-8.5 9-14 9S6 22.5 2 16z"/>
      <circle class="e-open" cx="16" cy="16" r="4" fill="currentColor"/>
      <path class="e-shut" d="M3 15c4 5.5 8.5 8 13 8s9-2.5 13-8M7.5 20.5 5 24M16 23.5v4M24.5 20.5 27 24"/>
      <path class="e-off" d="M5 27 27 5"/>
    </svg>
  </button>
  <span id="eyeLbl" hidden></span>
</div>''', 1)

# ---------- JS (goes at the end of the main script, so it can use its functions) ----------
js = r'''
// ---- Driver eye monitor: camera stays on after unlock; beeps if the eyes stay closed for 3 seconds ----
let EYE_CLOSED_MS = 3000, EYE_NOFACE_MS = 5000;
let eyeOn = false, eyeStream = null, eyeUserOff = false, eyeAlerts = 0, eyeRun = 0, eyeLast = "";
const eyeWait = (ms) => new Promise((r) => setTimeout(r, ms));

function eyeSet(state, tip) {
  const key = state + "|" + tip + "|" + eyeAlerts;
  if (key === eyeLast) return;
  eyeLast = key;
  const t = tip + (eyeAlerts ? " · Alerts: " + eyeAlerts : "");
  $("eyeBtn").className = "eye " + state; $("eyeBtn").title = t;
  $("eyeBtn").setAttribute("aria-label", "Driver eye monitor. " + t);
  $("eyeLbl").textContent = state === "alarm" ? "Eyes closed! Wake up" : ""; $("eyeLbl").hidden = state !== "alarm";
}
// Eye aspect ratio from the 6 landmark points of one eye: small number = eye closed
function eyeAR(p) { const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y); return (d(p[1], p[5]) + d(p[2], p[4])) / (2 * d(p[0], p[3])); }
function eyeBeep() {
  try { audio().resume(); } catch (e) {}
  beep(1000, 0.22, "square", 0, 0.3); beep(1000, 0.22, "square", 0.32, 0.3);
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
}
function eyeStop(tip) {
  eyeRun++; eyeOn = false;
  if (eyeStream) eyeStream.getTracks().forEach((t) => t.stop());
  eyeStream = null; $("eyeCam").srcObject = null;
  eyeSet("off", tip || "Eye monitor starts after the car is unlocked");
}

async function eyeStart() {
  if (eyeOn || eyeUserOff) return;
  eyeOn = true; const run = ++eyeRun;
  eyeSet("start", "Starting the eye monitor…");
  try {
    if (typeof faceapi === "undefined" || !faceapi.nets) throw new Error("face models are not available");
    if (!modelsReady) {
      await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL), faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)]);
      modelsReady = true;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    if (run !== eyeRun) { stream.getTracks().forEach((t) => t.stop()); return; }
    eyeStream = stream;
    const v = $("eyeCam"); v.srcObject = stream; await v.play();

    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const samples = []; let base = 0, closedSince = 0, lastSeen = Date.now(), lastBeep = 0, alarm = false;
    while (run === eyeRun) {
      const now = Date.now();
      let ear = null;
      if (v.readyState >= 2 && v.videoWidth > 0) {
        try {
          const r = await faceapi.detectSingleFace(v, opts).withFaceLandmarks();
          if (r) ear = (eyeAR(r.landmarks.getLeftEye()) + eyeAR(r.landmarks.getRightEye())) / 2;
        } catch (e) {}
      }
      if (run !== eyeRun) break;

      if (ear === null) {                                   // no face in view
        const gap = now - lastSeen;
        if (gap > 1500) { closedSince = 0; alarm = false; }
        if (gap > EYE_NOFACE_MS) eyeSet("novis", "Face not visible to the eye monitor");
      } else {
        lastSeen = now;
        if (base === 0) {                                   // learn this driver's open-eye level first
          samples.push(ear);
          eyeSet("start", "Calibrating: keep your eyes open");
          if (samples.length >= 15) {
            const sorted = [...samples].sort((a, b) => a - b), b80 = sorted[Math.floor(sorted.length * 0.8)];
            if (b80 < 0.15) samples.length = 0; else base = b80;
          }
        } else {
          const closed = ear < base * 0.72;
          if (!closed) {
            if (ear > base * 0.85) base = base * 0.98 + ear * 0.02;   // follow slow lighting / posture changes
            closedSince = 0; alarm = false;
            eyeSet("open", "Eyes open");
          } else {
            if (!closedSince) closedSince = now;
            const ms = now - closedSince;
            if (ms >= EYE_CLOSED_MS) {
              if (!alarm) { alarm = true; eyeAlerts++; }
              eyeSet("alarm", "Eyes closed for " + Math.floor(ms / 1000) + " s");
              if (now - lastBeep > 900) { eyeBeep(); lastBeep = now; }   // keeps beeping until the eyes open
            } else eyeSet("closed", "Eyes closed");
          }
        }
      }
      await eyeWait(90);
    }
  } catch (e) {
    if (run === eyeRun) { eyeOn = false; eyeSet("off", "Eye monitor unavailable: " + (e.message || e)); }
  }
}

// Click the eye to pause or resume (the camera light goes off while paused)
$("eyeBtn").onclick = () => {
  if (eyeOn) { eyeUserOff = true; eyeStop("Eye monitor paused. Click to turn it on."); }
  else { eyeUserOff = false; if (isUnlocked) eyeStart(); else eyeSet("off", "Eye monitor starts after the car is unlocked"); }
};

// Start when the car is unlocked, stop when it is locked again
const eyeUnlockedOrig = unlocked;
unlocked = function () { const out = eyeUnlockedOrig.apply(this, arguments); eyeStart(); return out; };
const eyeRelockOrig = $("relockBtn").onclick;
$("relockBtn").onclick = function () { const out = eyeRelockOrig.apply(this, arguments); if (!isUnlocked) eyeStop(); return out; };
'''
b = s.index('<body>')
start = s.index('<script>', b)
end = s.index('</script>', start)
main = s[start:end]
for need in ['function unlocked(', 'function beep(', 'modelsReady', 'MODEL_URL', '$("relockBtn").onclick']:
    if need not in main: stop("main script piece: " + need)
s = s[:end] + js + s[end:]

open(PATH, "w", encoding="utf-8").write(s)
print("Done: eye icon added in the top-left corner. The eye monitor starts when the car is unlocked.")
