#!/usr/bin/env python3
"""Replaces the scenario dropdown in the Car dashboard with a 'Check health of your car' button.
Each click shows a RANDOM scenario. Everything else stays the same.

Run from the repo root:   python3 apply_check_button.py
It edits backend/public/index.html in place and keeps your own colours.
If any expected piece of code is not found, it stops and changes nothing."""
import re, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "backend/public/index.html"
s = open(PATH, encoding="utf-8").read()

if 'id="checkBtn"' in s:
    sys.exit("Already applied. Nothing to do.")

def sub(pattern, new, text, label, flags=re.S):
    out, n = re.subn(pattern, lambda m: new, text, count=1, flags=flags)
    if n != 1:
        sys.exit(f"STOPPED: could not find '{label}'. Your file was NOT changed.")
    return out

# 1. Sidebar: dropdown -> button
s = sub(r'<label class="sl-label" for="scSel">.*?</label>\s*<select id="scSel"></select>',
        '<button id="checkBtn">🔍 Check health of your car</button>\n    <div class="sl-sub" id="lastCheck"></div>',
        s, "scenario dropdown")

# 2. Start with no scenario selected
s = sub(r'let scenarios = \[\], trends = null, cur = 0,', 'let scenarios = [], trends = null, cur = -1,', s, "cur variable")

# 3. Empty state + render() no longer reads the dropdown
s = sub(r'function render\(\) \{\s*const s = scenarios\[cur\], d = s\.data, a = s\.analysis;\s*\$\("scSel"\)\.value = cur;',
'''function renderEmpty() {
  const sec = secEvents.map((t) => `<div class="sl-box sl-err"><b>Unauthorized access attempt</b>: Unknown face rejected at ${t}</div>`).join("");
  $("risk").innerHTML = `<div class="sl-box sl-info">Press <b>Check health of your car</b> to scan the vehicle.</div>`;
  $("metrics").innerHTML = "";
  $("alerts").innerHTML = sec || `<div class="sl-box sl-info">No health check has been run yet.</div>`;
  $("steps").innerHTML = ""; $("src").innerHTML = "";
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  lastSpoken = []; $("replay").hidden = true; $("ask").disabled = true;
}

function render() {
  if (cur < 0) return renderEmpty();
  const s = scenarios[cur], d = s.data, a = s.analysis;
  $("ask").disabled = false;''', s, "render()")

# 4. Button picks a random scenario (never the same one twice in a row)
s = sub(r'\$\("scSel"\)\.innerHTML = scenarios\.map.*?\n\s*\$\("scSel"\)\.onchange = .*?\n',
'''let checking = false;
  $("checkBtn").onclick = () => {
    if (checking || !scenarios.length) return;
    checking = true;
    const btn = $("checkBtn");
    btn.disabled = true; btn.textContent = "🔍 Scanning vehicle…";
    setTimeout(() => {
      let n;
      do { n = Math.floor(Math.random() * scenarios.length); } while (n === cur && scenarios.length > 1);
      cur = n; render();
      $("lastCheck").textContent = "Last check: " + new Date().toLocaleTimeString();
      btn.disabled = false; btn.textContent = "🔍 Check health of your car"; checking = false;
    }, 900);
  };
''', s, "dropdown setup in the loader")

# 5. A new unlock starts with a fresh "check health" prompt
s = sub(r'fails = 0; isUnlocked = true; stopScan\(\);', 'fails = 0; isUnlocked = true; stopScan(); cur = -1;', s, "unlock code")

# 6. Button style
css = '''#car #checkBtn{display:block;width:100%;background:#FF4B4B;color:#fff;border:1px solid #FF4B4B;border-radius:8px;padding:10px 12px;font-family:inherit;font-size:16px;cursor:pointer}
#car #checkBtn:disabled{opacity:.7;cursor:wait}
#lastCheck{margin:8px 0 0}
'''
if s.count('</style>') != 1:
    sys.exit("STOPPED: could not find the style block. Your file was NOT changed.")
s = s.replace('</style>', css + '</style>', 1)

open(PATH, "w", encoding="utf-8").write(s)
print("Done: the Car dashboard now has the 'Check health of your car' button (random scenario on each click).")
