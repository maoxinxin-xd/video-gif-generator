const elements = {
  mainContainer: document.querySelector("#mainContainer"),
  dropZone: document.querySelector("#dropZone"),
  videoInput: document.querySelector("#videoInput"),
  previewVideo: document.querySelector("#previewVideo"),
  uploadPrompt: document.querySelector("#uploadPrompt"),
  replaceBtn: document.querySelector("#replaceBtn"),
  
  timelineContainer: document.querySelector("#timelineContainer"),
  timelineTrack: document.querySelector("#timelineTrack"),
  timelineProgress: document.querySelector("#timelineProgress"),
  durationText: document.querySelector("#durationText"),
  markerCount: document.querySelector("#markerCount"),
  gifDurationHint: document.querySelector("#gifDurationHint"),
  
  resultsSection: document.querySelector("#resultsSection"),
  gifPreview: document.querySelector("#gifPreview"),
  gifPlaceholder: document.querySelector("#gifPlaceholder"),
  resultTitle: document.querySelector("#resultTitle"),
  statusDot: document.querySelector("#statusDot"),
  downloadGifBtn: document.querySelector("#downloadGifBtn"),
  
  captureCanvas: document.querySelector("#captureCanvas"),
  statusToast: document.querySelector("#statusToast"),
  statusText: document.querySelector("#statusText"),
  statusSpinner: document.querySelector("#statusSpinner"),
};

const state = {
  videoUrl: "",
  duration: 0,
  markers: [], // Array of time in seconds
  isProcessing: false,
  gifBlobUrl: null,
  generateTimeout: null,
  draggingMarker: null,
};

let toastTimeout = null;
const GIF_INTERVAL_MS = 200; // Time between frames in GIF

function init() {
  bindEvents();
}

function bindEvents() {
  // Click to upload
  elements.dropZone.addEventListener("click", (e) => {
    if (elements.previewVideo.classList.contains("hidden")) {
        elements.videoInput.click();
    }
  });

  // Drag & Drop
  elements.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (elements.previewVideo.classList.contains("hidden")) {
        elements.dropZone.style.borderColor = "rgba(116, 94, 245, 0.5)";
        elements.dropZone.style.backgroundColor = "rgba(116, 94, 245, 0.05)";
    }
  });

  elements.dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.style.borderColor = "";
    elements.dropZone.style.backgroundColor = "";
  });

  elements.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropZone.style.borderColor = "";
    elements.dropZone.style.backgroundColor = "";
    
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // File Input Change
  elements.videoInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    elements.videoInput.value = "";
  });

  // Replace Video
  elements.replaceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetUI();
    elements.videoInput.click();
  });
  
  // Timeline Events
  elements.timelineTrack.addEventListener("click", (e) => {
    if (e.target !== elements.timelineTrack && e.target !== elements.timelineProgress) return;
    const rect = elements.timelineTrack.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const time = percent * state.duration;
    
    addMarker(time);
    triggerGifGeneration();
  });
  
  // Dragging globally
  window.addEventListener("mousemove", (e) => {
      if (state.draggingMarker !== null) {
          const rect = elements.timelineTrack.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          const percent = x / rect.width;
          const time = percent * state.duration;
          
          state.markers[state.draggingMarker] = time;
          updateMarkersUI();
          elements.previewVideo.currentTime = time;
      }
  });
  
  window.addEventListener("mouseup", () => {
      if (state.draggingMarker !== null) {
          state.draggingMarker = null;
          triggerGifGeneration();
      }
  });

  // Video Time Update for progress bar
  elements.previewVideo.addEventListener("timeupdate", () => {
      if (state.duration > 0) {
          const percent = (elements.previewVideo.currentTime / state.duration) * 100;
          elements.timelineProgress.style.width = `${percent}%`;
      }
  });
  
  // Downloads
  elements.downloadGifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.gifBlobUrl) {
          const a = document.createElement("a");
          a.href = state.gifBlobUrl;
          a.download = "generated.gif";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      }
  });
}

function handleFile(file) {
  if (!file.type.startsWith("video/")) {
    showToast("请选择有效的视频文件", "error");
    return;
  }

  resetUI();
  
  state.videoUrl = URL.createObjectURL(file);
  elements.previewVideo.src = state.videoUrl;
  
  elements.uploadPrompt.classList.add("hidden");
  elements.previewVideo.classList.remove("hidden");
  elements.replaceBtn.classList.remove("hidden");
  elements.timelineContainer.classList.remove("hidden");
  elements.timelineContainer.classList.add("flex");
  
  showToast("正在读取视频信息...", "info");
  
  elements.previewVideo.onloadedmetadata = () => {
      state.duration = elements.previewVideo.duration;
      elements.durationText.textContent = formatTime(state.duration);
      initMarkers();
      
      elements.mainContainer.classList.add("has-results");
      elements.resultsSection.classList.remove("hidden");
      
      triggerGifGeneration();
  };
  
  elements.previewVideo.onerror = () => {
      showToast("视频加载失败，可能格式不受支持", "error");
      resetUI();
  };
}

function initMarkers() {
    state.markers = [];
    // Automatically extract 1 frame per second as keyframes
    const interval = 1;
    for (let t = 0; t <= state.duration; t += interval) {
        state.markers.push(t);
    }
    // ensure last frame is not exactly 0 if duration is very short
    if (state.markers.length === 0 && state.duration > 0) {
        state.markers.push(state.duration / 2);
    }
    updateMarkersUI();
}

function addMarker(time) {
    state.markers.push(time);
    state.markers.sort((a, b) => a - b);
    updateMarkersUI();
}

function removeMarker(index) {
    if (state.markers.length <= 1) {
        showToast("至少需要保留一个关键帧", "error");
        return;
    }
    state.markers.splice(index, 1);
    updateMarkersUI();
    triggerGifGeneration();
}

function updateMarkersUI() {
    // Clear old markers
    const oldMarkers = elements.timelineTrack.querySelectorAll('.timeline-marker');
    oldMarkers.forEach(m => m.remove());
    
    state.markers.sort((a, b) => a - b);
    
    state.markers.forEach((time, index) => {
        const marker = document.createElement("div");
        marker.className = "timeline-marker";
        marker.style.left = `${(time / state.duration) * 100}%`;
        
        marker.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            state.draggingMarker = index;
            elements.previewVideo.currentTime = time;
        });
        
        marker.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            removeMarker(index);
        });
        
        elements.timelineTrack.appendChild(marker);
    });
    
    elements.markerCount.textContent = state.markers.length;
    elements.gifDurationHint.textContent = `预计生成时长：${((state.markers.length * GIF_INTERVAL_MS)/1000).toFixed(1)}s`;
}

function triggerGifGeneration() {
    if (state.generateTimeout) {
        clearTimeout(state.generateTimeout);
    }
    
    elements.gifPlaceholder.classList.remove("hidden");
    elements.gifPreview.classList.add("hidden");
    elements.downloadGifBtn.disabled = true;
    elements.statusDot.classList.replace("bg-success", "bg-info");
    elements.resultTitle.textContent = "准备生成...";
    
    // Debounce to avoid rapid re-generations
    state.generateTimeout = setTimeout(() => {
        generateGif();
    }, 1000);
}

async function generateGif() {
    if (state.isProcessing || state.markers.length === 0) return;
    state.isProcessing = true;
    showToast("正在提取关键帧...", "info");
    
    elements.resultTitle.textContent = "生成中...";
    elements.statusDot.classList.add("animate-pulse");

    try {
        const framesData = [];
        // Capture frames in sequence
        for (const time of state.markers) {
            const dataUrl = await captureFrameAsDataUrl(time);
            framesData.push(dataUrl);
        }
        
        showToast("关键帧提取完成，正在合成 GIF...", "info");
        
        // Generate GIF
        gifshot.createGIF({
            images: framesData,
            interval: GIF_INTERVAL_MS / 1000,
            gifWidth: 480,  // Standard width, maintain aspect ratio roughly
            gifHeight: Math.floor(480 / (elements.previewVideo.videoWidth / elements.previewVideo.videoHeight)),
            numFrames: framesData.length,
            sampleInterval: 10,
        }, function(obj) {
            if (!obj.error) {
                const image = obj.image;
                state.gifBlobUrl = image;
                
                elements.gifPreview.src = state.gifBlobUrl;
                elements.gifPlaceholder.classList.add("hidden");
                elements.gifPreview.classList.remove("hidden");
                
                elements.downloadGifBtn.disabled = false;
                elements.resultTitle.textContent = "生成完成";
                elements.statusDot.classList.replace("bg-info", "bg-success");
                elements.statusDot.classList.remove("animate-pulse");
                
                showToast("GIF 生成成功！", "success");
            } else {
                throw new Error("合成失败");
            }
            state.isProcessing = false;
        });

    } catch (error) {
        console.error(error);
        showToast("生成失败：" + error.message, "error");
        state.isProcessing = false;
        elements.resultTitle.textContent = "生成失败";
        elements.statusDot.classList.replace("bg-info", "bg-error");
    }
}

function captureFrameAsDataUrl(time) {
  return new Promise((resolve, reject) => {
    const video = elements.previewVideo;
    
    let resolved = false;
    const timeout = setTimeout(() => {
        if (!resolved) {
            cleanup();
            reject(new Error("等待帧定位超时"));
        }
    }, 5000);

    const cleanup = () => {
        resolved = true;
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
    };

    const onSeeked = () => {
        try {
            cleanup();
            const canvas = elements.captureCanvas;
            // Limit resolution to avoid huge memory for GIF
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = video.videoWidth * scale;
            canvas.height = video.videoHeight * scale;
            
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            resolve(canvas.toDataURL("image/jpeg", 0.8));
        } catch (e) {
            reject(e);
        }
    };

    video.currentTime = time;
    
    if (Math.abs(video.currentTime - time) < 0.1) {
        setTimeout(onSeeked, 100); 
    } else {
        video.addEventListener("seeked", onSeeked, { once: true });
    }
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m.toString().padStart(2, "0")}:${s.padStart(5, "0")}`;
}

function resetUI() {
  state.isProcessing = false;
  if (state.generateTimeout) clearTimeout(state.generateTimeout);
  
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);

  state.videoUrl = "";
  state.duration = 0;
  state.markers = [];
  state.gifBlobUrl = null;

  elements.previewVideo.src = "";
  elements.previewVideo.removeAttribute("src");
  elements.previewVideo.load();
  
  elements.previewVideo.classList.add("hidden");
  elements.replaceBtn.classList.add("hidden");
  elements.uploadPrompt.classList.remove("hidden");
  elements.timelineContainer.classList.add("hidden");
  elements.timelineContainer.classList.remove("flex");
  
  elements.mainContainer.classList.remove("has-results");
  elements.resultsSection.classList.add("hidden");
  
  elements.gifPreview.src = "";
  elements.gifPreview.classList.add("hidden");
  elements.gifPlaceholder.classList.remove("hidden");
  elements.downloadGifBtn.disabled = true;
  
  if(elements.statusToast) elements.statusToast.classList.remove("toast-show");
}

function showToast(msg, type = "info") {
  if (!elements.statusToast || !elements.statusText) return;
  
  elements.statusText.innerText = msg;
  elements.statusToast.classList.add("toast-show");
  
  const alert = elements.statusToast.querySelector(".alert");
  if (alert) {
      if (type === "success") {
          alert.style.borderColor = "rgba(82, 196, 26, 0.5)";
      } else if (type === "error") {
          alert.style.borderColor = "rgba(245, 34, 45, 0.5)";
      } else {
          alert.style.borderColor = "rgba(116, 94, 245, 0.5)";
      }
  }

  if (elements.statusSpinner) {
      if (type === "info") {
          elements.statusSpinner.classList.remove("hidden");
      } else {
          elements.statusSpinner.classList.add("hidden");
      }
  }
  
  if (toastTimeout) {
      clearTimeout(toastTimeout);
  }

  if (type === "success" || type === "error") {
      toastTimeout = setTimeout(() => {
          elements.statusToast.classList.remove("toast-show");
      }, 3000);
  }
}

init();