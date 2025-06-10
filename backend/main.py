from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import cv2
import mediapipe as mp
import numpy as np
import os
import asyncio
from dotenv import load_dotenv

# 載入環境變數
load_dotenv()

app = FastAPI()

# 允許所有來源進行CORS，因為前端部署在S3，與後端網域不同
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 實際部署時請替換為您的S3前端網域
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MediaPipe Pose setup
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(static_image_mode=False, min_detection_confidence=0.5, min_tracking_confidence=0.5)
mp_drawing = mp.solutions.drawing_utils

# 儲存影片的臨時目錄
UPLOAD_DIR = "uploaded_videos"
os.makedirs(UPLOAD_DIR, exist_ok=True)

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"WebSocket connected: {websocket.client}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print(f"WebSocket disconnected: {websocket.client}")

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

@app.post("/upload_video/")
async def upload_video(file: UploadFile = File(...)):
    """
    接收影片檔案，並儲存到伺服器。
    """
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(await file.read())
        return JSONResponse(status_code=200, content={"message": "Video uploaded successfully", "filename": file.filename})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not upload file: {e}")

@app.websocket("/ws/analyze_video/{filename}")
async def analyze_video_websocket(websocket: WebSocket, filename: str):
    """
    WebSocket 端點，用於即時分析影片並串流結果。
    """
    await manager.connect(websocket)
    video_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(video_path):
        await manager.send_personal_message({"error": "Video file not found."}, websocket)
        manager.disconnect(websocket)
        return

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        await manager.send_personal_message({"error": "Could not open video file."}, websocket)
        manager.disconnect(websocket)
        return

    frame_count = 0
    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1
            # 轉換顏色空間 BGR -> RGB (MediaPipe 需要)
            image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image.flags.writeable = False # 提升效能

            # 進行姿態偵測
            results = pose.process(image)

            image.flags.writeable = True
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

            landmarks_data = []
            if results.pose_landmarks:
                # 繪製骨架
                # mp_drawing.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

                # 提取關節座標
                for id, lm in enumerate(results.pose_landmarks.landmark):
                    # 轉換為圖像座標 (x, y)
                    h, w, c = frame.shape
                    cx, cy = int(lm.x * w), int(lm.y * h)
                    landmarks_data.append({"id": id, "x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility, "px": cx, "py": cy}) # lm.x, lm.y 是相對座標 (0-1), cx, cy 是像素座標

                # 計算運動力學特徵範例 (簡化)
                # 您可以在這裡加入更複雜的計算，例如角度、速度、加速度等
                metrics = calculate_pitcher_metrics(landmarks_data)

            # 將處理後的幀轉為JPEG，用於前端顯示
            _, buffer = cv2.imencode('.jpg', image, [int(cv2.IMWRITE_JPEG_QUALITY), 70]) # 壓縮品質
            jpg_as_text = buffer.tobytes()

            # 發送數據到前端
            await manager.send_personal_message(
                {
                    "frame_data": jpg_as_text.decode('latin-1'), # 將bytes轉為字串傳輸
                    "frame_num": frame_count,
                    "landmarks": landmarks_data,
                    "metrics": metrics if 'metrics' in locals() else {}
                },
                websocket
            )
            await asyncio.sleep(0.01) # 控制幀率，避免過載

    except WebSocketDisconnect:
        print(f"WebSocket client disconnected during analysis.")
    except Exception as e:
        print(f"Error during video analysis: {e}")
        await manager.send_personal_message({"error": f"Server error during analysis: {e}"}, websocket)
    finally:
        cap.release()
        pose.close() # 釋放MediaPipe資源
        if os.path.exists(video_path):
            os.remove(video_path) # 處理完畢後刪除影片
        manager.disconnect(websocket)
        print(f"Analysis for {filename} finished.")

# --- 運動力學特徵計算範例 ---
def calculate_pitcher_metrics(landmarks_data: list) -> dict:
    """
    根據關節座標計算簡易的運動力學特徵。
    這是一個簡化示例，您可以根據您的分析需求擴展。
    """
    metrics = {}
    try:
        # 假設我們關心手肘角度 (以 LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST 為例)
        shoulder_l = np.array([lm['px'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_SHOULDER.value][0]), \
                     np.array([lm['py'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_SHOULDER.value][0])

        elbow_l = np.array([lm['px'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_ELBOW.value][0]), \
                  np.array([lm['py'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_ELBOW.value][0])

        wrist_l = np.array([lm['px'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_WRIST.value][0]), \
                  np.array([lm['py'] for lm in landmarks_data if lm['id'] == mp_pose.PoseLandmark.LEFT_WRIST.value][0])

        def calculate_angle(a, b, c):
            a = np.array(a)
            b = np.array(b)
            c = np.array(c)

            radians = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0])
            angle = np.abs(radians*180.0/np.pi)

            if angle > 180.0:
                angle = 360 - angle
            return angle

        elbow_angle_l = calculate_angle(shoulder_l, elbow_l, wrist_l)
        metrics["left_elbow_angle"] = round(elbow_angle_l, 2)

    except IndexError:
        metrics["left_elbow_angle"] = None # 如果關節點未偵測到
    except Exception as e:
        print(f"Error calculating metrics: {e}")
        metrics["calculation_error"] = str(e)

    return metrics

# 運行FastAPI應用 (開發用)
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)