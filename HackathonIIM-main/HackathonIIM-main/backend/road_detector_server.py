"""Browser bridge for Saarthi AI's OpenCV road-surface deviation demo.
Run with: python road_detector_server.py
Requires: pip install opencv-python numpy
"""
import cv2, numpy as np, json, time, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

HOST, PORT = '127.0.0.1', 8765
DEFAULT_SOURCE = 'http://192.168.29.173:8080/video'
lock = threading.RLock()
source = DEFAULT_SOURCE
cap = None
last_frame = None
connected = False
calibrated = False
baseline = None
status_text = 'NOT CONNECTED'
alert_count = 0
last_alert = 0.0
MIN_REGION_AREA = 450
ROI_LEFT, ROI_RIGHT, ROI_TOP, ROI_BOTTOM = .12, .88, .35, .96

def set_source(value):
    global source, cap, connected, calibrated, baseline, status_text, last_frame
    value = str(value or '').strip()
    with lock:
        source = value
        if cap is not None: cap.release()
        cap = None; connected = False; calibrated = False; baseline = None; last_frame = None
        status_text = 'NOT CONNECTED' if not value else 'CONNECTING TO CAMERA…'

def get_capture():
    global cap, connected, status_text
    with lock:
        if cap is None and source:
            cap = cv2.VideoCapture(source)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

def placeholder(text):
    frame = np.zeros((540, 960, 3), dtype=np.uint8)
    frame[:] = (18, 27, 43)
    cv2.putText(frame, 'SAARTHI AI | ROAD LEVEL DETECTOR', (42, 70), cv2.FONT_HERSHEY_SIMPLEX, .9, (220,240,255), 2, cv2.LINE_AA)
    cv2.rectangle(frame, (42, 145), (918, 440), (45, 62, 83), 2)
    cv2.putText(frame, text, (75, 285), cv2.FONT_HERSHEY_SIMPLEX, 1.05, (0,180,255), 2, cv2.LINE_AA)
    cv2.putText(frame, 'Turn on IP Webcam and check the stream URL', (75, 330), cv2.FONT_HERSHEY_SIMPLEX, .62, (180,200,220), 1, cv2.LINE_AA)
    return frame

def process_frame(frame):
    global calibrated, baseline, status_text, alert_count, last_alert
    frame = cv2.resize(frame, (960, 540)); h,w = frame.shape[:2]
    x1,y1,x2,y2 = int(w*ROI_LEFT),int(h*ROI_TOP),int(w*ROI_RIGHT),int(h*ROI_BOTTOM)
    road = frame[y1:y2,x1:x2]
    gray = cv2.cvtColor(road,cv2.COLOR_BGR2GRAY); gray = cv2.GaussianBlur(gray,(5,5),0)
    edges = cv2.Canny(gray,45,120)
    texture = cv2.convertScaleAbs(cv2.Laplacian(gray,cv2.CV_32F,ksize=3))
    candidates=[]
    with lock:
        base = None if baseline is None else baseline.copy()
        ready = calibrated
    if ready and base is not None and base.shape == gray.shape:
        diff = cv2.absdiff(cv2.GaussianBlur(gray,(9,9),0),cv2.GaussianBlur(base,(9,9),0))
        edge_diff = cv2.absdiff(edges,cv2.Canny(base,45,120))
        combined=cv2.GaussianBlur(cv2.addWeighted(diff,.75,edge_diff,.55,0),(5,5),0)
        _,binary=cv2.threshold(combined,24,255,cv2.THRESH_BINARY)
        kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
        binary=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,kernel,iterations=2)
        binary=cv2.morphologyEx(binary,cv2.MORPH_OPEN,kernel,iterations=1)
        contours,_=cv2.findContours(binary,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area=cv2.contourArea(c)
            if area<MIN_REGION_AREA: continue
            rx,ry,rw,rh=cv2.boundingRect(c)
            if rw>(x2-x1)*.75 or rh<8: continue
            patch=texture[ry:ry+rh,rx:rx+rw]
            md=float(np.mean(diff[ry:ry+rh,rx:rx+rw]))
            score=min(99,int(md*1.6+(float(np.mean(patch)) if patch.size else 0)*.35))
            candidates.append((x1+rx,y1+ry,rw,rh,score))
    display=frame.copy(); cv2.rectangle(display,(x1,y1),(x2,y2),(255,180,0),2)
    cv2.putText(display,'ROAD SCAN AREA',(x1+8,y1+24),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,180,0),2,cv2.LINE_AA)
    for bx,by,bw,bh,score in candidates:
        cv2.rectangle(display,(bx,by),(bx+bw,by+bh),(0,70,255),2)
        cv2.putText(display,f'LEVEL CANDIDATE {score}',(bx,max(130,by-8)),cv2.FONT_HERSHEY_SIMPLEX,.46,(0,70,255),2,cv2.LINE_AA)
    if not ready: text='CALIBRATE ON A FLAT ROAD'; color=(0,210,255)
    elif candidates:
        text='POSSIBLE SURFACE DEVIATION - VERIFY'; color=(0,70,255)
        now=time.time()
        if now-last_alert>2: alert_count+=1; last_alert=now
    else: text='NO SIGNIFICANT VISUAL DEVIATION'; color=(80,230,130)
    cv2.rectangle(display,(8,8),(min(w-8,680),112),(20,25,30),-1)
    cv2.putText(display,'SAARTHI AI | GROUND-LEVEL SCAN',(20,34),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),2,cv2.LINE_AA)
    cv2.putText(display,'Calibration: '+('READY' if ready else 'NOT SET'),(20,59),cv2.FONT_HERSHEY_SIMPLEX,.52,(80,230,130) if ready else (0,210,255),1,cv2.LINE_AA)
    cv2.putText(display,text,(20,84),cv2.FONT_HERSHEY_SIMPLEX,.55,color,2,cv2.LINE_AA)
    return display, text, len(candidates)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send_json(self, obj, code=200):
        raw=json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS'); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.end_headers()
    def do_GET(self):
        global connected, last_frame, status_text
        path=urlparse(self.path).path
        if path=='/api/status':
            with lock: data={'connected':connected,'calibrated':calibrated,'source':source,'status':status_text,'alerts':alert_count}
            return self.send_json(data)
        if path=='/api/stream':
            self.send_response(200); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Type','multipart/x-mixed-replace; boundary=frame'); self.end_headers()
            try:
                while True:
                    frame=None
                    with lock:
                        if last_frame is not None: frame=last_frame.copy()
                        is_connected=connected
                    if frame is None: frame=placeholder('NOT CONNECTED' if not is_connected else 'WAITING FOR VIDEO')
                    ok,enc=cv2.imencode('.jpg',frame)
                    if ok:
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n'+enc.tobytes()+b'\r\n')
                    time.sleep(.08)
            except (BrokenPipeError,ConnectionResetError): pass
            return
        return self.send_json({'error':'Not found'},404)
    def do_POST(self):
        global calibrated, baseline, status_text
        path=urlparse(self.path).path
        try: body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')) or 0) or b'{}')
        except Exception: body={}
        if path=='/api/source':
            set_source(body.get('source','')); return self.send_json({'ok':True,'source':source})
        if path=='/api/calibrate':
            with lock:
                if not connected or last_frame is None: return self.send_json({'ok':False,'error':'Camera is not connected'},409)
                f=last_frame.copy()
                x1,y1,x2,y2=int(f.shape[1]*ROI_LEFT),int(f.shape[0]*ROI_TOP),int(f.shape[1]*ROI_RIGHT),int(f.shape[0]*ROI_BOTTOM)
                baseline=cv2.GaussianBlur(cv2.cvtColor(f[y1:y2,x1:x2],cv2.COLOR_BGR2GRAY),(5,5),0); calibrated=True
            return self.send_json({'ok':True,'calibrated':True})
        return self.send_json({'error':'Not found'},404)

def capture_loop():
    global connected,last_frame,status_text,cap
    while True:
        try:
            c=get_capture()
            if c is None or not c.isOpened():
                with lock: connected=False; status_text='NOT CONNECTED'; last_frame=None
                if c is not None:
                    c.release()
                    with lock:
                        if cap is c: cap=None
                time.sleep(1); continue
            ok,frame=c.read()
            if not ok or frame is None:
                with lock: connected=False; status_text='NOT CONNECTED'; last_frame=None
                c.release()
                with lock:
                    if cap is c: cap=None
                time.sleep(1); continue
            rendered,txt,count=process_frame(frame)
            with lock: connected=True; last_frame=rendered; status_text=txt
        except Exception as e:
            with lock: connected=False; status_text='NOT CONNECTED'; last_frame=None
            time.sleep(1)

if __name__=='__main__':
    threading.Thread(target=capture_loop,daemon=True).start()
    print(f'Saarthi Road Detector API listening on http://{HOST}:{PORT}')
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
