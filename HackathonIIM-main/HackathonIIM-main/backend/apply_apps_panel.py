#!/usr/bin/env python3
"""Adds YouTube and Google Maps icons to the left side of the Car dashboard.
Clicking an icon opens that app in the right side (replacing the dashboard); click again, or press
'Back to dashboard', to return.

Run from the repo root:   python3 backend/apply_apps_panel.py      (adjust the path if the script is elsewhere)
It edits backend/public/index.html in place, keeps your colours, and stops without changing anything
if the expected code is not found."""
import re, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "backend/public/index.html"
s = open(PATH, encoding="utf-8").read()
if 'id="appYt"' in s:
    sys.exit("Already applied. Nothing to do.")

def stop(what):
    sys.exit(f"STOPPED: could not find '{what}'. Your file was NOT changed.")

# 1. Icons in the left sidebar, under the Owner dashboard button
anchor = '<button id="ownerBtn">🔐 Owner dashboard</button>'
if s.count(anchor) != 1: stop("Owner dashboard button")
s = s.replace(anchor, anchor + '''
    <div class="sl-apps">
      <div class="sl-label">Apps</div>
      <button class="app-ic" id="appYt" title="Open YouTube">
        <svg viewBox="0 0 32 32"><rect x="2" y="7" width="28" height="18" rx="5" fill="#FF0000"/><path d="M13 12v8l7-4z" fill="#fff"/></svg><span>YouTube</span></button>
      <button class="app-ic" id="appMaps" title="Open Google Maps">
        <svg viewBox="0 0 32 32"><path d="M16 2a9 9 0 0 0-9 9c0 7 9 19 9 19s9-12 9-19a9 9 0 0 0-9-9z" fill="#EA4335"/><circle cx="16" cy="11" r="3.5" fill="#fff"/></svg><span>Google Maps</span></button>
    </div>''', 1)

# 2. The right-side panel (first thing inside the Car dashboard's main area)
panel = '''
    <div id="appPanel" hidden>
      <div class="ap-bar"><button id="appClose">← Back to dashboard</button><h3 class="sl-h" id="apTitle"></h3></div>
      <div id="apYt" hidden>
        <div class="ap-row">
          <input id="ytLink" placeholder="Paste a YouTube video or playlist link, or type words to search" autocomplete="off">
          <button id="ytPlay" class="pri">▶ Play / Search</button>
        </div>
        <div class="sl-sub" style="margin-bottom:10px">YouTube does not allow its website to be shown inside other pages, so paste a link to play it here. Typed words open a YouTube search in a new tab. Watch only as a passenger or when the car is parked.</div>
        <div id="ytBox"></div>
      </div>
      <div id="apMaps" hidden>
        <div class="ap-row">
          <input id="mapQ" placeholder="Search a place or destination" autocomplete="off">
          <button id="mapGo" class="pri">Search</button>
          <button id="mapMe">📍 My location</button>
          <a id="mapOpen" class="ap-link" target="_blank" rel="noopener" href="https://www.google.com/maps">Open in Google Maps ↗</a>
        </div>
        <div id="mapMsg" class="sl-sub"></div>
        <div id="mapBox"></div>
      </div>
    </div>'''
s, n = re.subn(r'(<main id="car" hidden>.*?<section class="sl-main">)', lambda m: m.group(1) + panel, s, count=1, flags=re.S)
if n != 1: stop("Car dashboard main area")

# 3. Leaving the car page stops any video
anchor = 'if (v !== "owner") ownerReset();'
if s.count(anchor) != 1: stop("show() function")
s = s.replace(anchor, anchor + '\n  if (v !== "car") closeApp();', 1)

# 4. Styles
css = '''.sl-apps{margin-top:24px}
.app-ic{display:flex;align-items:center;gap:10px;width:100%;margin:8px 0 0;padding:8px 12px;text-align:left}
.app-ic svg{width:28px;height:28px;flex-shrink:0}
.sl-side .app-ic.on{border-color:#FF4B4B;background:#fff5f5}
.sl-main.app > :not(#appPanel){display:none}
#appPanel[hidden],#appPanel [hidden]{display:none}
.ap-bar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.ap-bar .sl-h{margin:0}
.ap-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.ap-row input{flex:1;min-width:220px;padding:9px 10px;border:1px solid rgba(49,51,63,.3);border-radius:8px;font-family:inherit;font-size:16px}
.ap-link{color:#1c83e1;font-size:15px;white-space:nowrap}
#appPanel button{font-family:inherit;font-size:15px;background:#fff;border:1px solid rgba(49,51,63,.2);border-radius:8px;padding:8px 16px;cursor:pointer;color:#31333F}
#appPanel button.pri{background:#FF4B4B;border-color:#FF4B4B;color:#fff}
.ap-frame{display:block;width:100%;height:min(62vh,560px);border:0;border-radius:10px;background:#000}
</style>'''
if s.count('</style>') != 1: stop("style block")
s = s.replace('</style>', css, 1)

# 5. Behaviour
js = r'''
// ---- Apps: YouTube and Google Maps open on the right side ----
const mainBox = document.querySelector("#car .sl-main");
let openedApp = "";
function closeApp() {
  openedApp = "";
  mainBox.classList.remove("app"); $("appPanel").hidden = true;
  $("ytBox").innerHTML = ""; $("mapBox").innerHTML = "";          // removing the frames also stops any video
  $("appYt").classList.remove("on"); $("appMaps").classList.remove("on");
}
function openApp(which) {
  if (openedApp === which) return closeApp();
  openedApp = which;
  mainBox.classList.add("app"); $("appPanel").hidden = false;
  $("apYt").hidden = which !== "yt"; $("apMaps").hidden = which !== "maps";
  $("apTitle").textContent = which === "yt" ? "YouTube" : "Google Maps";
  $("appYt").classList.toggle("on", which === "yt"); $("appMaps").classList.toggle("on", which === "maps");
  if (which === "maps" && !$("mapBox").innerHTML) showMap("India", 5);
  if (which === "yt") $("ytLink").focus();
}
function ytEmbed(text) {
  const list = (text.match(/[?&]list=([\w-]+)/) || [])[1];
  const id = (text.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || [])[1];
  if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` + (list ? `&list=${list}` : "");
  if (list) return `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`;
  return null;
}
function playYt() {
  const t = $("ytLink").value.trim();
  if (!t) return;
  const url = ytEmbed(t);
  if (url) $("ytBox").innerHTML = `<iframe class="ap-frame" src="${url}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  else window.open("https://www.youtube.com/results?search_query=" + encodeURIComponent(t), "_blank", "noopener");
}
function showMap(q, zoom) {
  $("mapBox").innerHTML = `<iframe class="ap-frame" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="https://www.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed"></iframe>`;
  $("mapOpen").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}
$("appYt").onclick = () => openApp("yt");
$("appMaps").onclick = () => openApp("maps");
$("appClose").onclick = closeApp;
$("ytPlay").onclick = playYt;
$("ytLink").onkeydown = (e) => { if (e.key === "Enter") playYt(); };
$("mapGo").onclick = () => { const q = $("mapQ").value.trim(); if (q) { $("mapMsg").textContent = ""; showMap(q, 14); } };
$("mapQ").onkeydown = (e) => { if (e.key === "Enter") $("mapGo").onclick(); };
$("mapMe").onclick = () => {
  if (!navigator.geolocation) return ($("mapMsg").textContent = "This browser cannot share your location.");
  $("mapMsg").textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    (p) => { $("mapMsg").textContent = ""; showMap(p.coords.latitude + "," + p.coords.longitude, 15); },
    () => ($("mapMsg").textContent = "Could not get your location. Allow location access for this site, or search for a place."));
};
'''
i = s.rindex('</script>')
s = s[:i] + js + s[i:]

open(PATH, "w", encoding="utf-8").write(s)
print("Done: YouTube and Google Maps icons added to the left side of the Car dashboard.")
