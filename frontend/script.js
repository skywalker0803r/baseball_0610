document.addEventListener('DOMContentLoaded', () => {
    const videoUpload = document.getElementById('videoUpload');
    const uploadButton = document.getElementById('uploadButton');
    const messageDiv = document.getElementById('message');
    const errorMessageDiv = document.getElementById('error-message');
    const analysisSection = document.getElementById('analysisSection');
    const analysisCanvas = document.getElementById('analysisCanvas');
    const ctx = analysisCanvas.getContext('2d');
    const currentFrameNumSpan = document.getElementById('currentFrameNum');
    const leftElbowAngleSpan = document.getElementById('leftElbowAngle');
    const stopAnalysisButton = document.getElementById('stopAnalysisButton');

    // **重要：將這裡替換為您的 FastAPI 後端實際部署的 URL**
    // 如果在本地測試，通常是 http://localhost:8000
    const API_BASE_URL = 'http://localhost:8000'; 
    let websocket = null;

    uploadButton.addEventListener('click', async () => {
        const file = videoUpload.files[0];
        if (!file) {
            errorMessageDiv.textContent = '請先選擇一個影片檔案。';
            errorMessageDiv.classList.remove('hidden');
            return;
        }

        messageDiv.textContent = '影片上傳中...';
        errorMessageDiv.classList.add('hidden');
        uploadButton.disabled = true; // 避免重複點擊

        const formData = new FormData();
        formData.append('file', file);

        try {
            // 1. 上傳影片
            const uploadResponse = await fetch(`${API_BASE_URL}/upload_video/`, {
                method: 'POST',
                body: formData,
            });

            if (!uploadResponse.ok) {
                const errorData = await uploadResponse.json();
                throw new Error(errorData.detail || '影片上傳失敗');
            }

            const uploadResult = await uploadResponse.json();
            messageDiv.textContent = `影片上傳成功: ${uploadResult.filename}，開始分析...`;
            analysisSection.classList.remove('hidden'); // 顯示分析區塊

            // 2. 建立 WebSocket 連線開始分析
            const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws/analyze_video/${uploadResult.filename}`;
            websocket = new WebSocket(wsUrl);

            websocket.onopen = () => {
                messageDiv.textContent = 'WebSocket 連線成功，正在接收分析數據...';
                stopAnalysisButton.disabled = false;
            };

            websocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.error) {
                    errorMessageDiv.textContent = `分析錯誤: ${data.error}`;
                    errorMessageDiv.classList.remove('hidden');
                    messageDiv.textContent = '';
                    websocket.close(); // 關閉連線
                    return;
                }

                // 繪製影片幀和骨架
                const img = new Image();
                img.src = 'data:image/jpeg;base64,' + btoa(data.frame_data); // 將 latin-1 string 轉回 binary, 再 Base64 編碼
                img.onload = () => {
                    // 根據 canvas 尺寸調整圖片大小
                    const aspectRatio = img.width / img.height;
                    let drawWidth = analysisCanvas.width;
                    let drawHeight = analysisCanvas.height;

                    if (img.width > analysisCanvas.width || img.height > analysisCanvas.height) {
                        if (img.width / img.height > analysisCanvas.width / analysisCanvas.height) {
                            drawHeight = analysisCanvas.width / aspectRatio;
                        } else {
                            drawWidth = analysisCanvas.height * aspectRatio;
                        }
                    }
                    
                    // 清空 canvas
                    ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
                    // 繪製影片幀
                    ctx.drawImage(img, (analysisCanvas.width - drawWidth) / 2, (analysisCanvas.height - drawHeight) / 2, drawWidth, drawHeight);

                    // 繪製骨架 (假設後端已經繪製好，或者前端根據landmarks繪製)
                    // 如果後端已繪製，前端只需顯示圖片。
                    // 如果後端只傳landmarks，前端需要自己繪製：
                    if (data.landmarks && data.landmarks.length > 0) {
                        drawSkeleton(ctx, data.landmarks, drawWidth, drawHeight, (analysisCanvas.width - drawWidth) / 2, (analysisCanvas.height - drawHeight) / 2);
                    }
                };

                // 更新運動力學數據
                currentFrameNumSpan.textContent = data.frame_num;
                leftElbowAngleSpan.textContent = data.metrics.left_elbow_angle !== undefined ? data.metrics.left_elbow_angle : '---';
                // 其他數據...
            };

            websocket.onclose = () => {
                messageDiv.textContent = '分析已結束或連線斷開。';
                uploadButton.disabled = false;
                stopAnalysisButton.disabled = true;
            };

            websocket.onerror = (error) => {
                errorMessageDiv.textContent = `WebSocket 錯誤: ${error.message || '未知錯誤'}`;
                errorMessageDiv.classList.remove('hidden');
                messageDiv.textContent = '';
                uploadButton.disabled = false;
                stopAnalysisButton.disabled = true;
            };

        } catch (error) {
            errorMessageDiv.textContent = `上傳或分析失敗: ${error.message}`;
            errorMessageDiv.classList.remove('hidden');
            messageDiv.textContent = '';
            uploadButton.disabled = false;
            if (websocket) websocket.close();
        }
    });

    stopAnalysisButton.addEventListener('click', () => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.close();
            messageDiv.textContent = '分析已手動停止。';
        }
        stopAnalysisButton.disabled = true;
        uploadButton.disabled = false; // 允許再次上傳
    });

    // 輔助函數：在 Canvas 上繪製骨架
    // 這裡的繪製假定後端已經繪製了，但如果後端只傳landmarks，前端可以這樣繪製
    // 由於後端已經繪製了骨架在圖片上，這段前端繪製骨架的程式碼在這個版本中暫時不需要
    // 但為了展示靈活性，我保留了其結構。
    function drawSkeleton(ctx, landmarks, imgWidth, imgHeight, offsetX, offsetY) {
        // 定義連接點，這與 MediaPipe 的 POSE_CONNECTIONS 相似
        const connections = [
            [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [12, 14], [14, 16],
            [16, 18], [16, 20], [16, 22], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
            [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
        ];

        ctx.strokeStyle = 'lime'; // 骨架線條顏色
        ctx.lineWidth = 2;
        ctx.fillStyle = 'red'; // 關節點顏色

        // 繪製連接線
        connections.forEach(connection => {
            const startLm = landmarks.find(lm => lm.id === connection[0]);
            const endLm = landmarks.find(lm => lm.id === connection[1]);

            if (startLm && endLm && startLm.visibility > 0.5 && endLm.visibility > 0.5) {
                // 將相對座標轉換為繪圖座標
                const startX = startLm.x * imgWidth + offsetX;
                const startY = startLm.y * imgHeight + offsetY;
                const endX = endLm.x * imgWidth + offsetX;
                const endY = endLm.y * imgHeight + offsetY;

                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            }
        });

        // 繪製關節點
        landmarks.forEach(lm => {
            if (lm.visibility > 0.5) {
                const pointX = lm.x * imgWidth + offsetX;
                const pointY = lm.y * imgHeight + offsetY;
                ctx.beginPath();
                ctx.arc(pointX, pointY, 4, 0, 2 * Math.PI); // 關節點半徑為4
                ctx.fill();
            }
        });
    }
});