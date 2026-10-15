SAARTHI AI — PYTHON ROAD LEVEL DETECTOR

Your original dashboard and other apps are preserved. The Apps sidebar now labels the road app “Road Level Detector”.

FIRST-TIME SETUP (Windows)
1. Install Python 3.10+ if it is not installed. During setup, tick “Add Python to PATH”.
2. Open a terminal in this backend folder and run:
   python -m pip install -r requirements-road-detector.txt
3. Run START_ROAD_DETECTOR_WINDOWS.bat (or run: python road_detector_server.py).
   Keep this terminal open while using the detector.
4. In a second terminal, run the dashboard as usual:
   node server.js
5. Open http://localhost:3000, enter the car dashboard, and click Apps → Road Level Detector (below Google Maps).
6. On your phone, open IP Webcam and start its server. Ensure the phone and computer use the same Wi-Fi. Enter the exact video URL shown by IP Webcam (usually http://PHONE-IP:8080/video), then click Connect camera.
7. When the phone camera/server is off or the URL is unreachable, the panel displays NOT CONNECTED. Once connected, aim at a flat road/surface, keep the camera still, and click Calibrate flat road.

NOTES
- If your phone IP changes, update the URL in the detector panel.
- If the browser reports NOT CONNECTED, confirm the Python detector server is running on localhost:8765, then check the phone's IP Webcam URL and Wi-Fi.
- This is an experimental visual-difference demo. It does not measure true physical road height; lighting, shadows, texture, and camera movement may cause false positives. Do not rely on it for real driving decisions.
