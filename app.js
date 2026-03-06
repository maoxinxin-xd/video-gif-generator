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
  zoomSlider: document.querySelector("#zoomSlider"),
  timelineScroll: document.querySelector("#timelineScroll"),
  
  resultsSection: document.querySelector("#resultsSection"),
  gifPreview: document.querySelector("#gifPreview"),
  gifPlaceholder: document.querySelector("#gifPlaceholder"),
  resultTitle: document.querySelector("#resultTitle"),
  statusDot: document.querySelector("#statusDot"),
  downloadGifBtn: document.querySelector("#downloadGifBtn"),
  downloadZipBtn: document.querySelector("#downloadZipBtn"),
  targetWidthSelect: document.querySelector("#targetWidthSelect"),
  
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
  draggingMarkerElement: null,
  didDragMarker: false,
  zoomLevel: 1,
  videoPool: null,
  videoPoolUrl: "",
  activeGenerationToken: 0,
  requestedGenerationToken: 0,
  pendingGeneration: false,
  frameCache: new Map(),
  targetWidthPreset: "480", // "480" | "720" | "1080" | "original"
};

let toastTimeout = null;
const GIF_INTERVAL_MS = 200; // Time between frames in GIF
const DEFAULT_TARGET_WIDTH = 480;
const GENERATION_DEBOUNCE_MS = 1000;
const FRAME_CAPTURE_TIMEOUT_MS = 5000;
const FRAME_CAPTURE_RETRIES = 1;
const MAX_CAPTURE_CONCURRENCY = 10;
const MOBILE_MAX_CAPTURE_CONCURRENCY = 4;
const MIN_CAPTURE_CONCURRENCY = 2;
const SAFE_SEEK_OFFSET_SECONDS = 0.05;

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
  
  // Zoom Events
  if (elements.zoomSlider) {
      elements.zoomSlider.addEventListener("input", (e) => {
          state.zoomLevel = parseFloat(e.target.value);
          elements.timelineTrack.style.width = `${state.zoomLevel * 100}%`;
      });
  }

  // Target width preset (GIF frame resolution)
  if (elements.targetWidthSelect) {
      elements.targetWidthSelect.addEventListener("change", (e) => {
          state.targetWidthPreset = e.target.value;
          state.frameCache.clear();
          triggerGifGeneration();
      });
  }
  
  // Timeline Events
  elements.timelineTrack.addEventListener("click", (e) => {
    // Prevent adding a new marker if clicked on an existing one
    if (e.target.closest('.timeline-marker')) return;
    
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
          state.didDragMarker = true;
          const rect = elements.timelineTrack.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          const percent = x / rect.width;
          const time = percent * state.duration;
          
          state.markers[state.draggingMarker] = time;
          
          // Update the DOM element directly to avoid re-rendering and index shifting
          if (state.draggingMarkerElement) {
              state.draggingMarkerElement.style.left = `${percent * 100}%`;
          }
          
          elements.previewVideo.currentTime = time;
      }
  });
  
  window.addEventListener("mouseup", () => {
      if (state.draggingMarker !== null) {
          if (state.didDragMarker) {
              updateMarkersUI(); // sync UI only when actually dragged
              triggerGifGeneration();
          }
          state.draggingMarker = null;
          state.draggingMarkerElement = null;
          state.didDragMarker = false;
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

  if (elements.downloadZipBtn) elements.downloadZipBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!state.videoUrl || state.markers.length === 0 || typeof JSZip === "undefined") return;
      elements.downloadZipBtn.disabled = true;
      try {
          showToast("正在抓取视频原图帧...", "info");
          const sortedMarkers = [...state.markers].sort((a, b) => a - b);
          const frameSize = {
              ...getOriginalFrameSize(elements.previewVideo.videoWidth, elements.previewVideo.videoHeight),
              captureFormat: "png"
          };
          const concurrency = getOptimalConcurrency(sortedMarkers.length);
          const framesData = await captureFramesParallel(sortedMarkers, {
              token: 1,
              frameSize,
              concurrency,
              skipStaleCheck: true,
              skipCache: true
          });
          if (framesData.length === 0) {
              showToast("没有可用的关键帧", "error");
              return;
          }
          showToast("正在打包 ZIP...", "info");
          const zip = new JSZip();
          framesData.forEach((dataUrl, i) => {
              const base64 = dataUrl.split(",")[1];
              const name = `frame_${String(i + 1).padStart(3, "0")}.png`;
              zip.file(name, base64, { base64: true });
          });
          const blob = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "keyframes.zip";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast("原图打包下载成功！", "success");
      } catch (err) {
          console.error(err);
          showToast("打包失败：" + err.message, "error");
      } finally {
          elements.downloadZipBtn.disabled = false;
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
      if (elements.downloadZipBtn) elements.downloadZipBtn.disabled = false;
      
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
    // Remove auto-sorting to maintain marker indices for dragging independence
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
    
    // We intentionally do not sort state.markers here so the index bindings remain intact
    // Sorting is done only during GIF generation.
    
    state.markers.forEach((time, index) => {
        const marker = document.createElement("div");
        marker.className = "timeline-marker";
        marker.style.left = `${(time / state.duration) * 100}%`;
        
        marker.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            state.draggingMarker = index;
            state.draggingMarkerElement = marker;
            state.didDragMarker = false;
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
    if (!state.videoUrl || state.markers.length === 0) return;

    if (state.generateTimeout) {
        clearTimeout(state.generateTimeout);
    }

    requestGeneration();

    // Debounce: only start generation after keyframes settle
    state.generateTimeout = setTimeout(() => {
        state.generateTimeout = null;
        startPendingGeneration();
    }, GENERATION_DEBOUNCE_MS);
}

async function generateGif(token) {
    if (state.markers.length === 0 || isGenerationStale(token)) return;

    state.isProcessing = true;
    state.activeGenerationToken = token;

    elements.gifPlaceholder.classList.remove("hidden");
    elements.gifPreview.classList.add("hidden");
    elements.downloadGifBtn.disabled = true;
    elements.statusDot.classList.remove("bg-success", "bg-error");
    elements.statusDot.classList.add("bg-info");
    elements.resultTitle.textContent = "生成中...";
    elements.statusDot.classList.add("animate-pulse");

    try {
        // Ensure markers are sorted by time before generating GIF
        const sortedMarkers = [...state.markers].sort((a, b) => a - b);
        const frameSize = getTargetFrameSize(
            elements.previewVideo.videoWidth,
            elements.previewVideo.videoHeight
        );
        const capturePlan = getFrameCapturePlan(sortedMarkers, frameSize);
        const concurrency = getOptimalConcurrency(sortedMarkers.length);

        if (capturePlan.requests.length === 0) {
            showToast("关键帧已全部命中缓存，正在合成 GIF...", "info");
        } else if (capturePlan.cachedCount > 0) {
            showToast(
                `正在提取新增关键帧...（复用 ${capturePlan.cachedCount} 帧，新增 ${capturePlan.requests.length} 帧）`,
                "info"
            );
        } else {
            showToast("正在提取关键帧...", "info");
        }

        const framesData = await captureFramesParallel(sortedMarkers, {
            token,
            frameSize,
            concurrency,
            capturePlan,
        });

        if (isGenerationStale(token)) {
            throw createGenerationCancelledError();
        }
        if (framesData.length === 0) {
            throw new Error("没有可用的关键帧可用于生成 GIF");
        }

        showToast("关键帧提取完成，正在合成 GIF...", "info");
        const image = await createGifFromFrames(framesData, frameSize, token);

        if (isGenerationStale(token)) {
            throw createGenerationCancelledError();
        }

        state.gifBlobUrl = image;
        elements.gifPreview.src = state.gifBlobUrl;
        elements.gifPlaceholder.classList.add("hidden");
        elements.gifPreview.classList.remove("hidden");

        elements.downloadGifBtn.disabled = false;
        elements.resultTitle.textContent = "生成完成";
        elements.statusDot.classList.remove("bg-info", "bg-error");
        elements.statusDot.classList.add("bg-success");
        elements.statusDot.classList.remove("animate-pulse");

        showToast("GIF 生成成功！", "success");

    } catch (error) {
        if (isGenerationCancelledError(error)) {
            return;
        }

        console.error(error);
        showToast("生成失败：" + error.message, "error");
        elements.resultTitle.textContent = "生成失败";
        elements.statusDot.classList.remove("bg-info", "bg-success");
        elements.statusDot.classList.add("bg-error");
        elements.statusDot.classList.remove("animate-pulse");
    } finally {
        if (state.activeGenerationToken === token) {
            state.isProcessing = false;
            state.activeGenerationToken = 0;
        }
        if (state.pendingGeneration || state.requestedGenerationToken !== token) {
            startPendingGeneration();
        }
    }
}

function createGenerationCancelledError() {
  const error = new Error("当前生成任务已取消");
  error.code = "GENERATION_CANCELLED";
  return error;
}

function isGenerationCancelledError(error) {
  return error && error.code === "GENERATION_CANCELLED";
}

function requestGeneration() {
  state.requestedGenerationToken += 1;
  state.pendingGeneration = true;
}

function startPendingGeneration() {
  if (state.isProcessing || !state.pendingGeneration) return;
  state.pendingGeneration = false;
  void generateGif(state.requestedGenerationToken);
}

function isGenerationStale(token) {
  return !token || token !== state.requestedGenerationToken || !state.videoUrl;
}

function cancelPendingGeneration() {
  state.requestedGenerationToken += 1;
  state.pendingGeneration = false;

  if (state.generateTimeout) {
      clearTimeout(state.generateTimeout);
      state.generateTimeout = null;
  }
}

function getTargetFrameSize(videoWidth, videoHeight) {
  const sourceWidth = Math.max(1, Math.round(videoWidth || DEFAULT_TARGET_WIDTH));
  const sourceHeight = Math.max(1, Math.round(videoHeight || 1));

  if (state.targetWidthPreset === "original") {
    return { width: sourceWidth, height: sourceHeight };
  }

  const maxWidth = parseInt(state.targetWidthPreset, 10) || DEFAULT_TARGET_WIDTH;
  const width = Math.max(1, Math.min(sourceWidth, maxWidth));
  const height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));

  return { width, height };
}

function getOriginalFrameSize(videoWidth, videoHeight) {
  const width = Math.max(1, Math.round(videoWidth || DEFAULT_TARGET_WIDTH));
  const height = Math.max(1, Math.round(videoHeight || 1));
  return { width, height };
}

function getFrameCacheKey(time, frameSize) {
  const normalizedTime = Math.max(0, Number.isFinite(time) ? time : 0).toFixed(3);
  return `${frameSize.width}x${frameSize.height}:${normalizedTime}`;
}

function getFrameCapturePlan(times, frameSize) {
  const frames = new Array(times.length).fill(null);
  const requestMap = new Map();
  let cachedCount = 0;

  times.forEach((time, index) => {
      const key = getFrameCacheKey(time, frameSize);
      const cachedFrame = state.frameCache.get(key);

      if (cachedFrame) {
          frames[index] = cachedFrame;
          cachedCount += 1;
          return;
      }

      const existingRequest = requestMap.get(key);
      if (existingRequest) {
          existingRequest.indexes.push(index);
          return;
      }

      requestMap.set(key, {
          key,
          time,
          indexes: [index],
      });
  });

  return {
      frames,
      requests: Array.from(requestMap.values()),
      cachedCount,
  };
}

function mergeCapturedFrames(plan, capturedFrames) {
  plan.requests.forEach((request, index) => {
      const frameData = capturedFrames[index];
      if (!frameData) return;

      request.indexes.forEach((markerIndex) => {
          plan.frames[markerIndex] = frameData;
      });
  });

  return plan.frames.filter(Boolean);
}

function isMobileDevice() {
  return window.matchMedia("(max-width: 768px)").matches || /Mobi|Android/i.test(navigator.userAgent);
}

function getOptimalConcurrency(markerCount = state.markers.length) {
  if (markerCount <= 1) return 1;

  const cpu = navigator.hardwareConcurrency || 4;
  const deviceMax = isMobileDevice() ? MOBILE_MAX_CAPTURE_CONCURRENCY : MAX_CAPTURE_CONCURRENCY;
  const suggested = Math.max(MIN_CAPTURE_CONCURRENCY, Math.floor(cpu / 2));

  return Math.max(1, Math.min(markerCount, deviceMax, suggested));
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
        resolve(video);
        return;
    }

    const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("error", onError);
    };

    const onLoadedMetadata = () => {
        cleanup();
        resolve(video);
    };

    const onError = () => {
        cleanup();
        reject(new Error("视频元数据加载失败"));
    };

    const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("等待视频元数据超时"));
    }, FRAME_CAPTURE_TIMEOUT_MS);

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForVideoFrameData(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) {
        resolve(video);
        return;
    }

    const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener("loadeddata", onLoadedData);
        video.removeEventListener("canplay", onLoadedData);
        video.removeEventListener("error", onError);
    };

    const onLoadedData = () => {
        cleanup();
        resolve(video);
    };

    const onError = () => {
        cleanup();
        reject(new Error("视频首帧数据加载失败"));
    };

    const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("等待视频首帧数据超时"));
    }, FRAME_CAPTURE_TIMEOUT_MS);

    video.addEventListener("loadeddata", onLoadedData, { once: true });
    video.addEventListener("canplay", onLoadedData, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForRenderableVideoFrame() {
  return new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
}

async function createVideoPool(src, size) {
  const poolSize = Math.max(1, size);
  const workers = Array.from({ length: poolSize }, () => {
      const video = document.createElement("video");
      video.src = src;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
          throw new Error("无法创建用于抓帧的 canvas 上下文");
      }
      ctx.imageSmoothingEnabled = true;

      video.load();

      return { video, canvas, ctx };
  });

  await Promise.all(workers.map(({ video }) => Promise.all([
      waitForVideoMetadata(video),
      waitForVideoFrameData(video),
  ])));
  return workers;
}

function destroyVideoPool(pool = state.videoPool) {
  if (!pool) return;

  pool.forEach(({ video, canvas }) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      canvas.width = 0;
      canvas.height = 0;
  });

  if (pool === state.videoPool) {
      state.videoPool = null;
      state.videoPoolUrl = "";
  }
}

async function ensureVideoPool(size) {
  const poolSize = Math.max(1, size);

  if (state.videoPool && state.videoPoolUrl === state.videoUrl && state.videoPool.length >= poolSize) {
      return state.videoPool.slice(0, poolSize);
  }

  destroyVideoPool();
  state.videoPool = await createVideoPool(state.videoUrl, poolSize);
  state.videoPoolUrl = state.videoUrl;
  return state.videoPool;
}

function captureFrameWithVideo(video, time, canvas, ctx, token, frameSize, options = {}) {
  return new Promise((resolve, reject) => {
    if (!options.skipStaleCheck && isGenerationStale(token)) {
        reject(createGenerationCancelledError());
        return;
    }

    let settled = false;
    let captureStarted = false;
    const maxSeekTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, video.duration - SAFE_SEEK_OFFSET_SECONDS)
        : time;
    const boundedTime = Math.max(0, Math.min(time, maxSeekTime));

    const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
    };

    const finish = (callback) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
    };

    const onError = () => {
        finish(() => reject(new Error("视频帧解码失败")));
    };

    const startFinalizeCapture = () => {
        if (captureStarted) return;
        captureStarted = true;
        void finalizeCapture();
    };

    const finalizeCapture = async () => {
        if (!options.skipStaleCheck && isGenerationStale(token)) {
            finish(() => reject(createGenerationCancelledError()));
            return;
        }

        try {
            await waitForVideoFrameData(video);
            await waitForRenderableVideoFrame();

            if (!options.skipStaleCheck && isGenerationStale(token)) {
                finish(() => reject(createGenerationCancelledError()));
                return;
            }

            canvas.width = frameSize.width;
            canvas.height = frameSize.height;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const usePng = frameSize.captureFormat === "png";
            const dataUrl = usePng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.8);
            finish(() => resolve(dataUrl));
        } catch (error) {
            finish(() => reject(error));
        }
    };

    const onSeeked = () => {
        startFinalizeCapture();
    };

    const timeout = setTimeout(() => {
        finish(() => reject(new Error("等待帧定位超时")));
    }, FRAME_CAPTURE_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = boundedTime;

    if (Math.abs(video.currentTime - boundedTime) < 0.03) {
        startFinalizeCapture();
    }
  });
}

async function captureFrameWithRetry(worker, time, token, frameSize, options = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= FRAME_CAPTURE_RETRIES; attempt += 1) {
      if (!options.skipStaleCheck && isGenerationStale(token)) {
          throw createGenerationCancelledError();
      }

      try {
          return await captureFrameWithVideo(
              worker.video,
              time,
              worker.canvas,
              worker.ctx,
              token,
              frameSize,
              options
          );
      } catch (error) {
          if (isGenerationCancelledError(error)) {
              throw error;
          }
          lastError = error;
      }
  }

  console.warn(`关键帧抓取失败，已跳过 time=${time}`, lastError);
  return null;
}

async function runCaptureWorkers(requests, workers, token, frameSize, options = {}) {
  const frames = new Array(requests.length).fill(null);
  let nextIndex = 0;

  const tasks = workers.map((worker) => (async () => {
      while (true) {
          if (!options.skipStaleCheck && isGenerationStale(token)) {
              throw createGenerationCancelledError();
          }

          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= requests.length) {
              return;
          }

          const request = requests[currentIndex];
          const frameData = await captureFrameWithRetry(
              worker,
              request.time,
              token,
              frameSize,
              options
          );

          frames[currentIndex] = frameData;
          if (frameData && !options.skipCache) {
              state.frameCache.set(request.key, frameData);
          }
      }
  })());

  const results = await Promise.allSettled(tasks);
  const cancelled = results.find(
      (result) => result.status === "rejected" && isGenerationCancelledError(result.reason)
  );
  if (cancelled) {
      throw cancelled.reason;
  }

  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
      throw failed.reason;
  }

  return frames;
}

async function captureFramesParallel(times, { token, frameSize, concurrency, capturePlan, skipStaleCheck, skipCache }) {
  if (times.length === 0) return [];
  const options = { skipStaleCheck: !!skipStaleCheck, skipCache: !!skipCache };
  let plan = capturePlan || getFrameCapturePlan(times, frameSize);

  if (plan.requests.length === 0) {
      return plan.frames.filter(Boolean);
  }

  try {
      const workers = await ensureVideoPool(concurrency);
      const capturedFrames = await runCaptureWorkers(plan.requests, workers, token, frameSize, options);
      return mergeCapturedFrames(plan, capturedFrames);
  } catch (error) {
      if (isGenerationCancelledError(error)) {
          throw error;
      }

      if (concurrency > 1) {
          console.warn("并行抓帧失败，自动降级为串行模式", error);
          destroyVideoPool();
          plan = getFrameCapturePlan(times, frameSize);
          if (plan.requests.length === 0) {
              return plan.frames.filter(Boolean);
          }
          const workers = await ensureVideoPool(1);
          const capturedFrames = await runCaptureWorkers(plan.requests, workers, token, frameSize, options);
          return mergeCapturedFrames(plan, capturedFrames);
      }

      throw error;
  }
}

function createGifFromFrames(framesData, frameSize, token) {
  return new Promise((resolve, reject) => {
      if (isGenerationStale(token)) {
          reject(createGenerationCancelledError());
          return;
      }

      gifshot.createGIF({
          images: framesData,
          interval: GIF_INTERVAL_MS / 1000,
          gifWidth: frameSize.width,
          gifHeight: frameSize.height,
          numFrames: framesData.length,
          sampleInterval: 10,
      }, (obj) => {
          if (isGenerationStale(token)) {
              reject(createGenerationCancelledError());
              return;
          }

          if (!obj.error && obj.image) {
              resolve(obj.image);
              return;
          }

          reject(new Error(obj.errorMsg || "合成失败"));
      });
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m.toString().padStart(2, "0")}:${s.padStart(5, "0")}`;
}

function resetUI() {
  cancelPendingGeneration();
  destroyVideoPool();
  state.isProcessing = false;
  state.activeGenerationToken = 0;
  state.frameCache.clear();

  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);

  state.videoUrl = "";
  state.duration = 0;
  state.markers = [];
  state.gifBlobUrl = null;
  state.zoomLevel = 1;
  state.targetWidthPreset = "480";
  state.draggingMarker = null;
  state.draggingMarkerElement = null;
  state.didDragMarker = false;
  state.videoPool = null;
  state.videoPoolUrl = "";

  if (elements.zoomSlider) {
      elements.zoomSlider.value = 1;
  }
  if (elements.targetWidthSelect) {
      elements.targetWidthSelect.value = "480";
  }
  if (elements.timelineTrack) {
      elements.timelineTrack.style.width = "100%";
  }

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
  if (elements.downloadZipBtn) elements.downloadZipBtn.disabled = true;
  
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