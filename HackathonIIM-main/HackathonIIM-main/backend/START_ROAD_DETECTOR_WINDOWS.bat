@echo off
cd /d "%~dp0"
python -m pip install -r requirements-road-detector.txt
python road_detector_server.py
pause
