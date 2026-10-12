# Saarthi AI

Saarthi AI is a browser-based driving-safety co-pilot prototype. The dashboard includes a rule-based risk display, simulated vehicle scenarios, safety advice, driver verification UI, owner dashboard, YouTube and Google Maps panels.

## Run locally

Requirements: Node.js 18 or newer.

```bash
cd backend
npm install
npm start
```

Open the local URL printed by the server (usually `http://localhost:3000`). Use a recent Chrome or Edge browser for the best speech-recognition support.

## Floating voice assistant

A small Saarthi Voice panel floats on the right side of the page. Drag its header to move it; use the arrow button to slide it against the screen edge and expand it again. Press **Start listening** once and grant microphone access. If the browser allows it, the assistant will attempt to resume listening after a reload once you have opted in before. Use **Stop** or say “stop listening” to turn recognition off.

Supported voice commands (English, best-effort browser speech recognition):

- “help”
- “check vehicle” / “run health check”
- “what should I do” / “give advice”
- “open maps”
- “search maps for Kolkata” / “navigate to the airport”
- “open YouTube”
- “play on YouTube lo-fi music” / “search YouTube for lo-fi music”
- “close app”
- “repeat advice”
- “open owner dashboard” / “home” / “verify driver”

## Important limitations

- Browsers do not guarantee true always-on microphone access. Microphone permission is required; a fresh user gesture may be required after reload, browser restart, permission changes, or recognition errors. Speech recognition support varies by browser and network. The page must remain open and generally foregrounded. This is not a background operating-system assistant like Google Assistant.
- Voice commands do not bypass driver verification or owner authentication.
- Vehicle health scenarios and some trend values are simulated in the current prototype. Do not use it to make real driving or vehicle-safety decisions.
- Face recognition in a browser prototype is not equivalent to a certified vehicle immobilizer.
