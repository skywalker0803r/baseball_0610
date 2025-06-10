document.addEventListener('DOMContentLoaded', () => {
    const videoUpload = document.getElementById('videoUpload');
    const uploadButton = document.getElementById('uploadButton');
    const messageDiv = document.getElementById('message');
    const errorMessageDiv = document.getElementById('error-message');
    const analysisSection = document.getElementById('analysisSection');
    const analysisCanvas = document.getElementById('analysisCanvas');
    const ctx = analysisCanvas.getContext('2d');
    const currentFrameNumSpan = document.getElementById('currentFrameNum');

    //運動力學特徵
    const stride_angle = document.getElementById('stride_angle');
    const throwing_angle = document.getElementById('throwing_angle');
    const arm_symmetry = document.getElementById('arm_symmetry');
    const hip_rotation = document.getElementById('hip_rotation');
    const elbow_height = document.getElementById('elbow_height');
    const ankle_height = document.getElementById('ankle_height');
    const shoulder_rotation = document.getElementById('shoulder_rotation');
    const torso_tilt_angle = document.getElementById('torso_tilt_angle');
    const release_distance = document.getElementById('release_distance');
    const shoulder_to_hip = document.getElementById('shoulder_to_hip');

    // 姿勢改善建議
    const suggestionsContentDiv = document.getElementById('suggestionsContent');
    // 歷史紀錄
    const historyList = document.getElementById('historyList');
    const stopAnalysisButton = document.getElementById('stopAnalysisButton');

    // **重要：將這裡替換為您的 FastAPI 後端實際部署的 URL**
    const API_BASE_URL = 'https://13.158.25.83:8000';
    let websocket = null;

    // 模擬歷史記錄
    const historicalAnalyses = [];

    // --- 輔助函數 ---
    function addHistoryEntry(filename, status, analysisTime) {
        const li = document.createElement('li');
        li.textContent = `${analysisTime} - 影片: ${filename} - 狀態: ${status}`;
        historyList.prepend(li); // 新的記錄放在最上面
        if (historyList.children.length > 5) { // 最多顯示5條記錄
            historyList.removeChild(historyList.lastChild);
        }
    }

    // --- 事件監聽器 ---
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
        suggestionsContentDiv.innerHTML = '<p>等待影片分析完成以獲取建議...</p>'; // 清空建議

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
                img.src = 'data:image/jpeg;base64,' + btoa(data.frame_data);
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

                    ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
                    ctx.drawImage(img, (analysisCanvas.width - drawWidth) / 2, (analysisCanvas.height - drawHeight) / 2, drawWidth, drawHeight);

                };

                // 更新運動力學數據 (關鍵指標分析區塊)
                currentFrameNumSpan.textContent = data.frame_num;
                stride_angle.textContent = data.metrics.stride_angle !== undefined ? data.metrics.stride_angle : '---';
                throwing_angle.textContent = data.metrics.throwing_angle !== undefined ? data.metrics.throwing_angle : '---';
                arm_symmetry.textContent = data.metrics.arm_symmetry !== undefined ? data.metrics.arm_symmetry : '---';
                hip_rotation.textContent = data.metrics.hip_rotation !== undefined ? data.metrics.hip_rotation : '---';
                elbow_height.textContent = data.metrics.elbow_height !== undefined ? data.metrics.elbow_height : '---';
                ankle_height.textContent = data.metrics.ankle_height !== undefined ? data.metrics.ankle_height : '---';
                shoulder_rotation.textContent = data.metrics.shoulder_rotation !== undefined ? data.metrics.shoulder_rotation : '---';
                torso_tilt_angle.textContent = data.metrics.torso_tilt_angle !== undefined ? data.metrics.torso_tilt_angle : '---';
                release_distance.textContent = data.metrics.release_distance !== undefined ? data.metrics.release_distance : '---';
                shoulder_to_hip.textContent = data.metrics.shoulder_to_hip !== undefined ? data.metrics.shoulder_to_hip : '---';

                // 根據數據生成和顯示建議 (姿勢改善建議區塊)
                // 這是一個非常簡化的範例，實際應基於更複雜的邏輯
                if (data.metrics.stride_angle !== undefined && data.metrics.stride_angle < 15) {
                    suggestionsContentDiv.innerHTML = '<p style="color: orange;">建議：步幅角度小於15度。</p>';
                } else if (data.metrics.throwing_angle !== undefined && data.metrics.throwing_angle > 120) {
                    suggestionsContentDiv.innerHTML = '<p style="color: orange;">建議：投擲角度大於120度。</p>';
                } else if (data.metrics.arm_symmetry !== undefined && data.metrics.arm_symmetry < 1) {
                    suggestionsContentDiv.innerHTML = '<p style="color: green;">手臂對稱性表現良好！</p>';
                } else {
                    suggestionsContentDiv.innerHTML = '<p>分析中...請等待數據</p>';
                }

                // 可以在此處將關鍵幀數據暫存，用於最終總結的建議

            };

            websocket.onclose = () => {
                messageDiv.textContent = '分析已結束或連線斷開。';
                uploadButton.disabled = false;
                stopAnalysisButton.disabled = true;
                addHistoryEntry(uploadResult.filename, '完成', new Date().toLocaleTimeString()); // 分析完成後新增歷史記錄
            };

            websocket.onerror = (error) => {
                errorMessageDiv.textContent = `WebSocket 錯誤: ${error.message || '未知錯誤'}`;
                errorMessageDiv.classList.remove('hidden');
                messageDiv.textContent = '';
                uploadButton.disabled = false;
                stopAnalysisButton.disabled = true;
                addHistoryEntry(uploadResult.filename, '失敗', new Date().toLocaleTimeString()); // 分析失敗後新增歷史記錄
            };

        } catch (error) {
            errorMessageDiv.textContent = `上傳或分析失敗: ${error.message}`;
            errorMessageDiv.classList.remove('hidden');
            messageDiv.textContent = '';
            uploadButton.disabled = false;
            if (websocket) websocket.close(); // 確保錯誤時關閉WebSocket
            addHistoryEntry(file.name, '上傳失敗', new Date().toLocaleTimeString()); // 上傳失敗後新增歷史記錄
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
});
