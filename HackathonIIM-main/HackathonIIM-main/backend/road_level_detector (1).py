import cv2
import numpy as np
import time
from collections import deque

# Saarthi AI: relative road-surface appearance deviation demo.
# Single RGB camera cannot directly measure true ground height reliably.
# This flags visual candidates against a calibrated flat-road reference.
CAMERA_SOURCE = "http://192.168.29.173:8080/video"
WINDOW_NAME = "Saarthi AI - Ground Level Deviation"
MIN_REGION_AREA = 450
ALERT_COOLDOWN_SEC = 2.0
MAX_FEATURES = 350
ROI_LEFT, ROI_RIGHT = 0.12, 0.88
ROI_TOP, ROI_BOTTOM = 0.35, 0.96

def roi_bounds(frame):
    h, w = frame.shape[:2]
    return int(w*ROI_LEFT), int(h*ROI_TOP), int(w*ROI_RIGHT), int(h*ROI_BOTTOM)

def road_mask(shape):
    h, w = shape[:2]
    mask = np.zeros((h, w), np.uint8)
    x1, y1, x2, y2 = roi_bounds(np.zeros((h, w, 3), np.uint8))
    mask[y1:y2, x1:x2] = 255
    return mask

def main():
    print("Starting Saarthi AI ground-level deviation demo...")
    cap = cv2.VideoCapture(CAMERA_SOURCE)
    if not cap.isOpened():
        print("Cannot open camera stream:", CAMERA_SOURCE)
        print("Try /video or /videofeed in the URL, and keep IP Webcam running.")
        return

    calibrated = False
    baseline = None
    last_alert = 0
    alert_count = 0
    times = deque(maxlen=20)
    prev_gray, prev_points = None, None

    while True:
        t0 = time.time()
        ok, frame = cap.read()
        if not ok or frame is None:
            print("No frame received; check phone stream and Wi-Fi.")
            time.sleep(0.2)
            continue

        frame = cv2.resize(frame, (960, 540))
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = roi_bounds(frame)
        gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Estimate scene/camera motion to help interpret a moving dashcam view.
        if prev_gray is not None and prev_points is not None and len(prev_points) > 8:
            next_points, status, _ = cv2.calcOpticalFlowPyrLK(
                prev_gray, gray_full, prev_points, None,
                winSize=(21, 21), maxLevel=3,
                criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))
            if next_points is not None and status is not None:
                good_old = prev_points[status.ravel() == 1]
                good_new = next_points[status.ravel() == 1]
                if len(good_new) >= 8:
                    shifts = good_new - good_old
                    dx, dy = np.median(shifts, axis=0).ravel()
                    cv2.putText(frame, f"Camera flow dx={dx:.1f} dy={dy:.1f}",
                                (w-320, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.48,
                                (230,230,230), 1, cv2.LINE_AA)
        prev_gray = gray_full
        prev_points = cv2.goodFeaturesToTrack(
            gray_full, maxCorners=MAX_FEATURES, qualityLevel=0.01,
            minDistance=8, mask=road_mask(frame.shape))

        # Inspect only the road area ahead, excluding most of the sky/background.
        road = frame[y1:y2, x1:x2]
        gray = cv2.cvtColor(road, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5,5), 0)
        edges = cv2.Canny(gray, 45, 120)
        texture = cv2.convertScaleAbs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3))

        candidates = []
        if calibrated and baseline is not None and baseline.shape == gray.shape:
            base_blur = cv2.GaussianBlur(baseline, (9,9), 0)
            cur_blur = cv2.GaussianBlur(gray, (9,9), 0)
            diff = cv2.absdiff(cur_blur, base_blur)
            base_edges = cv2.Canny(baseline, 45, 120)
            edge_diff = cv2.absdiff(edges, base_edges)
            combined = cv2.addWeighted(diff, 0.75, edge_diff, 0.55, 0)
            combined = cv2.GaussianBlur(combined, (5,5), 0)
            _, binary = cv2.threshold(combined, 24, 255, cv2.THRESH_BINARY)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7,7))
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
            binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = cv2.contourArea(contour)
                if area < MIN_REGION_AREA:
                    continue
                rx, ry, rw, rh = cv2.boundingRect(contour)
                if rw > (x2-x1)*0.75 or rh < 8:
                    continue
                patch = texture[ry:ry+rh, rx:rx+rw]
                mean_texture = float(np.mean(patch)) if patch.size else 0.0
                mean_diff = float(np.mean(diff[ry:ry+rh, rx:rx+rw]))
                candidates.append((x1+rx, y1+ry, rw, rh,
                                   min(99.0, mean_diff*1.6 + mean_texture*0.35)))

        display = frame.copy()
        cv2.rectangle(display, (x1,y1), (x2,y2), (255,180,0), 2)
        cv2.putText(display, "ROAD SCAN AREA", (x1+8,y1+24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,180,0), 2, cv2.LINE_AA)

        for bx, by, bw, bh, score in candidates:
            cv2.rectangle(display, (bx,by), (bx+bw,by+bh), (0,70,255), 2)
            cv2.putText(display, f"LEVEL CANDIDATE {score:.0f}", (bx,max(130,by-8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.46, (0,70,255), 2, cv2.LINE_AA)

        if not calibrated:
            status, color = "PRESS C WHILE VIEWING A FLAT ROAD", (0,210,255)
        elif candidates:
            status, color = "POSSIBLE SURFACE DEVIATION - VERIFY", (0,70,255)
            now = time.time()
            if now - last_alert >= ALERT_COOLDOWN_SEC:
                last_alert = now
                alert_count += 1
                try:
                    import winsound
                    winsound.Beep(850, 160)
                except Exception:
                    print("\a", end="", flush=True)
        else:
            status, color = "NO SIGNIFICANT VISUAL DEVIATION", (80,230,130)

        now = time.time()
        times.append(now)
        fps = len(times)/(times[-1]-times[0]) if len(times)>1 and times[-1]>times[0] else 0
        cv2.rectangle(display, (8,8), (min(w-8,650),112), (20,25,30), -1)
        cv2.putText(display, "SAARTHI AI | GROUND-LEVEL SCAN", (20,34),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2, cv2.LINE_AA)
        cv2.putText(display, "Calibration: " + ("READY" if calibrated else "NOT SET"),
                    (20,59), cv2.FONT_HERSHEY_SIMPLEX, 0.52,
                    (80,230,130) if calibrated else (0,210,255), 1, cv2.LINE_AA)
        cv2.putText(display, status, (20,84), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    color, 2, cv2.LINE_AA)
        cv2.putText(display, f"Demo alerts: {alert_count} | FPS: {fps:.1f} | C=calibrate D=diff Q=quit",
                    (20,105), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (220,220,220), 1, cv2.LINE_AA)
        cv2.imshow(WINDOW_NAME, display)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('c'), ord('C')):
            # Camera should be stationary while capturing a flat-road baseline.
            baseline = gray.copy()
            calibrated = True
            print("Flat-road visual baseline saved. Resume moving slowly.")
        elif key in (ord('d'), ord('D')):
            if calibrated and baseline is not None and baseline.shape == gray.shape:
                diff_view = cv2.absdiff(cv2.GaussianBlur(gray,(9,9),0),
                                        cv2.GaussianBlur(baseline,(9,9),0))
                cv2.imshow("Diagnostic - Difference", diff_view)
        elif key in (ord('q'), 27):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
