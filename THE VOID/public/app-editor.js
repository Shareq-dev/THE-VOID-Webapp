function presetIcon(id) {
  if (id === "lock") {
    return `<svg class="preset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="2"></rect><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"></path></svg>`;
  }
  return `<svg class="preset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2"></path><path d="M5.5 10.5V20h13v-9.5"></path><path d="M9.5 20v-5h5v5"></path></svg>`;
}
function renderPresetCards() {
  $("#presetGrid").innerHTML = layoutPresets
    .map(
      (preset) => `
    <button class="preset-card ${preset.id === activePreset.id ? "active" : ""}" data-id="${preset.id}" type="button">
      ${presetIcon(preset.id)}
      <span class="preset-text">
        <strong>${escapeHtml(preset.name)}</strong>
        <small>${escapeHtml(preset.desc)}</small>
      </span>
    </button>
  `,
    )
    .join("");
  $$(".preset-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!selectedFileDataUrl) {
        $("#uploadStatus").textContent =
          "Choose a wallpaper first, then tap a layout preset.";
        return;
      }
      activePreset =
        layoutPresets.find((preset) => preset.id === card.dataset.id) ||
        layoutPresets[0];
      syncPresetActive();
      $("#labTitle").textContent = activePreset.name;
      $("#previewStage").classList.remove("hidden");
      $("#previewStage").scrollIntoView({ behavior: "smooth", block: "start" });
      drawPreview();
    });
  });
}
function syncPresetActive() {
  $$(".preset-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.id === activePreset.id);
  });
}
function attachUploadEvents() {
  const input = $("#wallpaperFile");
  const dropzone = $("#dropzone");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    requireUser("upload", () => handleFile(file));
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });
  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    requireUser("upload", () => handleFile(file));
  });
  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    requireUser("upload", () => submitWallpaper());
  });
}
function attachPreviewEvents() {
  $("#refreshWallpapers").addEventListener("click", loadWallpapers);
  $("#zoomRange").addEventListener("input", () => {
    previewState.zoom = Number($("#zoomRange").value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $("#offsetXRange").addEventListener("input", () => {
    previewState.offsetX = Number($("#offsetXRange").value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $("#offsetYRange").addEventListener("input", () => {
    previewState.offsetY = Number($("#offsetYRange").value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $("#gridToggle").addEventListener("change", () => {
    previewState.showGrid = $("#gridToggle").checked;
    drawPreview();
  });
  $("#resetPreviewAdjustments").addEventListener("click", () => {
    previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
    syncPreviewControls();
    drawPreview();
  });
  ["zoomRange", "offsetXRange", "offsetYRange"].forEach((id) => {
    const slider = $(`#${id}`);
    slider.addEventListener("touchstart", (event) => event.stopPropagation(), {
      passive: true,
    });
    slider.addEventListener("touchmove", (event) => event.stopPropagation(), {
      passive: true,
    });
  });
}
function attachModalEvents() {
  $("#closeWallpaperPreview")?.addEventListener("click", closeWallpaperPreview);
  $$("[data-close-preview]").forEach((item) =>
    item.addEventListener("click", closeWallpaperPreview),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWallpaperPreview();
  });
}
function syncPreviewControls() {
  const zoomRange = $("#zoomRange");
  const { minZoom, maxZoom } = getZoomBounds(
    sourceImage,
    previewDevice.w,
    previewDevice.h,
  );
  zoomRange.min = String(minZoom);
  zoomRange.max = String(maxZoom);
  previewState.zoom = clamp(previewState.zoom, minZoom, maxZoom);
  zoomRange.value = String(previewState.zoom);
  updateZoomOriginalMarker(minZoom, maxZoom);
  $("#offsetXRange").value = String(previewState.offsetX);
  $("#offsetYRange").value = String(previewState.offsetY);
  $("#gridToggle").checked = previewState.showGrid;
  updatePreviewControlLabels();
}
function updateZoomOriginalMarker(minZoom, maxZoom) {
  const marker = $("#zoomOriginalMarker");
  if (!marker) return;
  const originalFitZoom = 1;
  if (
    originalFitZoom < minZoom ||
    originalFitZoom > maxZoom ||
    maxZoom <= minZoom
  ) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.left = `${((originalFitZoom - minZoom) / (maxZoom - minZoom)) * 100}%`;
}
function updatePreviewControlLabels() {
  const actualScale = sourceImage
    ? getEffectiveScale(
        sourceImage,
        previewDevice.w,
        previewDevice.h,
        previewState.zoom,
      )
    : previewState.zoom;
  $("#zoomValue").textContent = `${Math.round(actualScale * 100)}%`;
  $("#offsetXValue").textContent = `${Math.round(previewState.offsetX)}`;
  $("#offsetYValue").textContent = `${Math.round(previewState.offsetY)}`;
  const zoomWarning = $("#zoomOutWarning");
  if (zoomWarning) zoomWarning.hidden = !sourceImage || previewState.zoom >= 1;
}
async function handleFile(file) {
  const status = $("#uploadStatus");
  status.textContent = "";
  if (!file) return;
  if (
    !String(file.type || "").startsWith("image/") &&
    !/\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif|tiff?|jfif)$/i.test(
      file.name || "",
    )
  ) {
    status.textContent = "Please choose an image file from your gallery/media.";
    return;
  }
  status.textContent = "Loading image...";
  try {
    selectedFileName = file.name;
    clearSelectedObjectUrl();
    const loaded = await decodeImageWithFallback(file);
    selectedFileDataUrl = loaded.previewSrc;
    selectedObjectUrl = loaded.objectUrl || "";
    sourceImage = loaded.image;
    selectedImageMeta = {
      width: sourceImage.naturalWidth,
      height: sourceImage.naturalHeight,
      ratio: sourceImage.naturalWidth / sourceImage.naturalHeight,
      size: file.size,
    };
    $("#selectedInfo").classList.remove("hidden");
    $("#selectedInfo").innerHTML = buildSelectedInfo(file, selectedImageMeta);
    $("#presetArea").classList.remove("hidden");
    $("#submitBtn").disabled = false;
    if (!$("#wallpaperTitle").value.trim()) {
      $("#wallpaperTitle").value = cleanTitleFromFilename(file.name);
    }
    previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
    syncPreviewControls();
    syncPresetActive();
    $("#labTitle").textContent = activePreset.name;
    $("#previewStage").classList.remove("hidden");
    drawPreview();
    status.textContent = "";
  } catch {
    clearSelectedObjectUrl();
    status.textContent =
      "Could not load this image format on this browser. Please choose another picture.";
  }
}
function clearSelectedObjectUrl() {
  if (!selectedObjectUrl) return;
  try {
    URL.revokeObjectURL(selectedObjectUrl);
  } catch {}
  selectedObjectUrl = "";
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {}
      resolve(image);
    };
    image.onerror = () => reject(new Error("Image decode failed."));
    image.src = src;
  });
}
async function decodeImageWithFallback(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    return { previewSrc: objectUrl, image, objectUrl };
  } catch {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }
  const primaryDataUrl = await readFileAsDataUrl(file);
  try {
    const image = await loadImageElement(primaryDataUrl);
    return { previewSrc: primaryDataUrl, image, objectUrl: "" };
  } catch {}
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = bitmap.width;
      tempCanvas.height = bitmap.height;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === "function") bitmap.close();
      const fallbackDataUrl = tempCanvas.toDataURL("image/jpeg", 0.96);
      const image = await loadImageElement(fallbackDataUrl);
      return { previewSrc: fallbackDataUrl, image, objectUrl: "" };
    } catch {}
  }
  throw new Error("Unsupported image format");
}
function buildSelectedInfo(file, meta) {
  const ratio = meta.width / meta.height;
  const is916 = Math.abs(ratio - 9 / 16) < 0.015;
  return `
    <div class="selected-info-card">
      <div class="selected-copy">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${meta.width}×${meta.height} · ${formatBytes(file.size)}</span>
        <span>${is916 ? "Perfect 9:16 ratio." : "Not exactly 9:16. Use Crop / Zoom and the position sliders to fit it."}</span>
      </div>
      <div class="selected-thumb-frame">
        <img class="selected-thumb" src="${selectedFileDataUrl}" alt="Selected wallpaper preview" />
      </div>
    </div>
  `;
}
function cleanTitleFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 80);
}
function resizeCanvas() {
  canvas.width = previewDevice.w;
  canvas.height = previewDevice.h;
  $("#phoneFrame").style.aspectRatio =
    `${previewDevice.w} / ${previewDevice.h}`;
}
function drawPreview() {
  resizeCanvas();
  drawPreviewToCanvas(canvas, ctx, sourceImage, activePreset.style, {
    drawGrid: previewState.showGrid,
    adjusted: true,
  });
}
function drawPreviewToCanvas(
  targetCanvas,
  targetCtx,
  image,
  style,
  options = {},
) {
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.fillStyle = "#050505";
  targetCtx.fillRect(0, 0, w, h);
  if (image) {
    if (options.adjusted) {
      drawImageAdjustedToContext(targetCtx, image, w, h, previewState);
    } else {
      drawImageCoverToContext(targetCtx, image, w, h);
    }
  } else {
    drawEmptyCanvas(targetCtx, w, h);
  }
  drawColorToneOverlay(targetCtx, w, h);
  if (style === "lock") drawSoftDepth(targetCtx, w, h);
  if (options.drawGrid) drawGuideGrid(targetCtx, w, h);
  drawStatusBar(targetCtx, w, h);
  if (style === "lock") drawClock(targetCtx, w, h, "stacked");
  if (style === "home") drawHomeScreen(targetCtx, w, h);
}
function drawEditedWallpaperOnly() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = previewDevice.w;
  exportCanvas.height = previewDevice.h;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#050505";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  if (sourceImage)
    drawImageAdjustedToContext(
      exportCtx,
      sourceImage,
      exportCanvas.width,
      exportCanvas.height,
      previewState,
    );
  return exportCanvas.toDataURL("image/jpeg", 0.92);
}
function getBaseCoverScale(img, w, h) {
  return Math.max(w / img.naturalWidth, h / img.naturalHeight);
}
function getEffectiveScale(img, w, h, zoom) {
  return getBaseCoverScale(img, w, h) * zoom;
}
function getZoomBounds(img, w, h) {
  return { minZoom: 0.05, maxZoom: 2.2 };
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function drawImageAdjustedToContext(targetCtx, img, w, h, state) {
  const scale = getEffectiveScale(img, w, h, state.zoom);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  const moveRangeX = Math.abs(w - drawWidth) / 2;
  const moveRangeY = Math.abs(h - drawHeight) / 2;
  const drawX = (w - drawWidth) / 2 + moveRangeX * (state.offsetX / 100);
  const drawY = (h - drawHeight) / 2 + moveRangeY * (state.offsetY / 100);
  targetCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}
function drawImageCoverToContext(targetCtx, img, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  targetCtx.drawImage(
    img,
    (w - drawWidth) / 2,
    (h - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}
function drawGuideGrid(targetCtx, w, h) {
  targetCtx.save();
  targetCtx.strokeStyle = "rgba(255,255,255,.35)";
  targetCtx.lineWidth = Math.max(2, w * 0.0024);
  [1 / 3, 2 / 3].forEach((p) => {
    targetCtx.beginPath();
    targetCtx.moveTo(w * p, 0);
    targetCtx.lineTo(w * p, h);
    targetCtx.stroke();
    targetCtx.beginPath();
    targetCtx.moveTo(0, h * p);
    targetCtx.lineTo(w, h * p);
    targetCtx.stroke();
  });
  targetCtx.strokeStyle = "rgba(255,255,255,.22)";
  targetCtx.setLineDash([12, 12]);
  targetCtx.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
  targetCtx.setLineDash([]);
  targetCtx.strokeStyle = "rgba(255,255,255,.20)";
  targetCtx.beginPath();
  targetCtx.moveTo(w * 0.5, 0);
  targetCtx.lineTo(w * 0.5, h);
  targetCtx.stroke();
  targetCtx.beginPath();
  targetCtx.moveTo(0, h * 0.5);
  targetCtx.lineTo(w, h * 0.5);
  targetCtx.stroke();
  targetCtx.restore();
}
function drawEmptyCanvas(targetCtx, w, h) {
  const g = targetCtx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#171717");
  g.addColorStop(0.5, "#020202");
  g.addColorStop(1, "#111");
  targetCtx.fillStyle = g;
  targetCtx.fillRect(0, 0, w, h);
  targetCtx.strokeStyle = "rgba(255,255,255,.18)";
  targetCtx.lineWidth = Math.max(2, w * 0.002);
  for (let x = -w; x < w * 2; x += w * 0.12) {
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x + h * 0.42, h);
    targetCtx.stroke();
  }
}
function drawColorToneOverlay(targetCtx, w, h) {
  const vignette = targetCtx.createRadialGradient(
    w / 2,
    h * 0.42,
    h * 0.08,
    w / 2,
    h * 0.48,
    h * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.42)");
  targetCtx.fillStyle = vignette;
  targetCtx.fillRect(0, 0, w, h);
}
function drawSoftDepth(targetCtx, w, h) {
  const g = targetCtx.createLinearGradient(0, 0, 0, h * 0.38);
  g.addColorStop(0, "rgba(0,0,0,.34)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  targetCtx.fillStyle = g;
  targetCtx.fillRect(0, 0, w, h * 0.38);
}
function drawStatusBar(targetCtx, w, h) {
  targetCtx.save();
  const s = w / 1080;
  const topFade = targetCtx.createLinearGradient(0, 0, 0, 140 * s);
  topFade.addColorStop(0, "rgba(0,0,0,.30)");
  topFade.addColorStop(1, "rgba(0,0,0,0)");
  targetCtx.fillStyle = topFade;
  targetCtx.fillRect(0, 0, w, 144 * s);
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.textBaseline = "middle";
  targetCtx.shadowColor = "rgba(0,0,0,.42)";
  targetCtx.shadowBlur = 8 * s;
  targetCtx.shadowOffsetY = 2 * s;
  const islandW = 176 * s;
  const islandH = 42 * s;
  const islandX = (w - islandW) / 2;
  const islandY = 34 * s;
  roundedRect(
    targetCtx,
    islandX,
    islandY,
    islandW,
    islandH,
    22 * s,
    "rgba(0,0,0,.86)",
    true,
  );
  roundedRect(
    targetCtx,
    islandX + 24 * s,
    islandY + 7 * s,
    islandW - 70 * s,
    5 * s,
    3 * s,
    "rgba(255,255,255,.055)",
    true,
  );
  const baselineY = islandY + islandH / 2 + 2 * s;
  targetCtx.fillStyle = "rgba(255,255,255,.98)";
  targetCtx.font = `700 ${Math.round(35 * s)}px "SF Pro Text", "Segoe UI", Arial, sans-serif`;
  targetCtx.textAlign = "left";
  targetCtx.fillText("9:41", 70 * s, baselineY);
  const rightInset = 56 * s;
  const batteryW = 58 * s;
  const batteryX = w - rightInset - batteryW;
  drawBatteryGlyph(targetCtx, batteryX, baselineY - 13 * s, s, 0.76);
  targetCtx.restore();
}
function drawSignalGlyph(targetCtx, x, y, s) {
  const barW = 5 * s;
  const gap = 3.5 * s;
  const heights = [8, 12, 16, 20];
  heights.forEach((height, index) => {
    const barX = x + index * (barW + gap);
    roundedRect(
      targetCtx,
      barX,
      y + (20 - height) * s,
      barW,
      height * s,
      2.3 * s,
      "rgba(255,255,255,.96)",
      true,
    );
  });
}
function drawWifiGlyph(targetCtx, x, y, s) {
  const centerX = x + 17 * s;
  const centerY = y + 16 * s;
  targetCtx.strokeStyle = "rgba(255,255,255,.96)";
  targetCtx.lineWidth = Math.max(2.4 * s, 1.8);
  [13, 9, 5].forEach((radius) => {
    targetCtx.beginPath();
    targetCtx.arc(centerX, centerY, radius * s, Math.PI * 1.2, Math.PI * 1.8);
    targetCtx.stroke();
  });
  targetCtx.fillStyle = "rgba(255,255,255,.96)";
  targetCtx.beginPath();
  targetCtx.arc(centerX, centerY + 5.8 * s, 2.6 * s, 0, Math.PI * 2);
  targetCtx.fill();
}
function drawBatteryGlyph(targetCtx, x, y, s, level = 0.75) {
  const bodyW = 52 * s;
  const bodyH = 24 * s;
  const capW = 3.8 * s;
  const capH = 9 * s;
  const innerPad = 3.8 * s;
  const clamped = Math.max(0.1, Math.min(1, level));
  targetCtx.lineWidth = Math.max(2.2 * s, 1.6);
  roundedRect(
    targetCtx,
    x,
    y,
    bodyW,
    bodyH,
    7 * s,
    "rgba(255,255,255,.95)",
    false,
  );
  roundedRect(
    targetCtx,
    x + bodyW,
    y + (bodyH - capH) / 2,
    capW,
    capH,
    2 * s,
    "rgba(255,255,255,.95)",
    true,
  );
  roundedRect(
    targetCtx,
    x + innerPad,
    y + innerPad,
    (bodyW - innerPad * 2) * clamped,
    bodyH - innerPad * 2,
    4 * s,
    "rgba(255,255,255,.95)",
    true,
  );
}
function drawClock(targetCtx, w, h, type, subtle = false) {
  targetCtx.save();
  targetCtx.textAlign = "center";
  targetCtx.fillStyle = subtle
    ? "rgba(255,255,255,.36)"
    : "rgba(255,255,255,.94)";
  if (type === "editorial") {
    targetCtx.font = `${Math.round(w * 0.2)}px Georgia, serif`;
    targetCtx.fillText("09:41", w / 2, h * 0.21);
    targetCtx.font = `${Math.round(w * 0.035)}px Arial`;
    targetCtx.fillText("MONDAY · 24 MAY", w / 2, h * 0.255);
  } else {
    targetCtx.font = `900 ${Math.round(w * 0.24)}px Arial Black, Arial`;
    targetCtx.fillText("09", w / 2, h * 0.19);
    targetCtx.fillText("41", w / 2, h * 0.32);
    targetCtx.font = `700 ${Math.round(w * 0.035)}px Arial`;
    targetCtx.fillText("MONDAY 24", w / 2, h * 0.365);
  }
  targetCtx.restore();
}
function drawHomeScreen(targetCtx, w, h) {
  targetCtx.save();
  const glassPanel = (x, y, width, height, radius, alpha = 0.18) => {
    roundedRect(
      targetCtx,
      x,
      y,
      width,
      height,
      radius,
      `rgba(255,255,255,${alpha})`,
      true,
    );
    const g = targetCtx.createLinearGradient(x, y, x + width, y + height);
    g.addColorStop(0, "rgba(255,255,255,.18)");
    g.addColorStop(0.5, "rgba(255,255,255,.08)");
    g.addColorStop(1, "rgba(255,255,255,.035)");
    roundedRect(
      targetCtx,
      x + 2,
      y + 2,
      width - 4,
      height - 4,
      Math.max(8, radius - 2),
      g,
      true,
    );
  };
  glassPanel(w * 0.1, h * 0.135, w * 0.8, h * 0.11, w * 0.04, 0.14);
  glassPanel(w * 0.1, h * 0.27, w * 0.38, h * 0.09, w * 0.033, 0.115);
  glassPanel(w * 0.52, h * 0.27, w * 0.38, h * 0.09, w * 0.033, 0.105);
  const icon = w * 0.112;
  const gapX = w * 0.082;
  const totalWidth = icon * 4 + gapX * 3;
  const startX = (w - totalWidth) / 2;
  const startY = h * 0.62;
  const gapY = h * 0.102;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = startX + col * (icon + gapX);
      const y = startY + row * gapY;
      roundedRect(
        targetCtx,
        x,
        y,
        icon,
        icon,
        w * 0.028,
        "rgba(255,255,255,.22)",
        true,
      );
      const glass = targetCtx.createLinearGradient(x, y, x + icon, y + icon);
      glass.addColorStop(0, "rgba(255,255,255,.28)");
      glass.addColorStop(0.42, "rgba(255,255,255,.13)");
      glass.addColorStop(1, "rgba(255,255,255,.055)");
      roundedRect(
        targetCtx,
        x + 2,
        y + 2,
        icon - 4,
        icon - 4,
        w * 0.026,
        glass,
        true,
      );
      targetCtx.fillStyle = "rgba(255,255,255,.10)";
      targetCtx.beginPath();
      targetCtx.arc(
        x + icon * 0.62,
        y + icon * 0.34,
        icon * 0.16,
        0,
        Math.PI * 2,
      );
      targetCtx.fill();
    }
  }
  const dockY = h * 0.875;
  glassPanel(w * 0.08, dockY, w * 0.84, h * 0.074, h * 0.038, 0.17);
  const dockIcon = w * 0.086;
  const dockGap = w * 0.075;
  const dockTotal = dockIcon * 4 + dockGap * 3;
  const dockStartX = (w - dockTotal) / 2;
  for (let i = 0; i < 4; i += 1) {
    const x = dockStartX + i * (dockIcon + dockGap);
    const y = dockY + h * 0.012;
    roundedRect(
      targetCtx,
      x,
      y,
      dockIcon,
      dockIcon,
      w * 0.024,
      "rgba(255,255,255,.22)",
      true,
    );
    const glass = targetCtx.createLinearGradient(
      x,
      y,
      x + dockIcon,
      y + dockIcon,
    );
    glass.addColorStop(0, "rgba(255,255,255,.30)");
    glass.addColorStop(0.5, "rgba(255,255,255,.12)");
    glass.addColorStop(1, "rgba(255,255,255,.05)");
    roundedRect(
      targetCtx,
      x + 1.5,
      y + 1.5,
      dockIcon - 3,
      dockIcon - 3,
      w * 0.022,
      glass,
      true,
    );
  }
  targetCtx.restore();
}
function roundedRect(
  targetCtx,
  x,
  y,
  width,
  height,
  radius,
  color,
  fill = true,
) {
  targetCtx.beginPath();
  targetCtx.moveTo(x + radius, y);
  targetCtx.arcTo(x + width, y, x + width, y + height, radius);
  targetCtx.arcTo(x + width, y + height, x, y + height, radius);
  targetCtx.arcTo(x, y + height, x, y, radius);
  targetCtx.arcTo(x, y, x + width, y, radius);
  if (fill) {
    targetCtx.fillStyle = color;
    targetCtx.fill();
  } else {
    targetCtx.strokeStyle = color;
    targetCtx.stroke();
  }
}
async function submitWallpaper() {
  const status = $("#uploadStatus");
  if (!selectedFileDataUrl || !sourceImage) {
    status.textContent = "Choose a wallpaper first.";
    return;
  }
  const user = getUser();
  if (!user) {
    requireUser("upload", () => submitWallpaper());
    return;
  }
  $("#submitBtn").disabled = true;
  status.textContent = "Submitting wallpaper....";
  try {
    const title =
      $("#wallpaperTitle").value.trim() ||
      selectedFileName ||
      "Untitled wallpaper";
    const creator = user.creatorName || "The Void";
    $("#creatorName").value = creator;
    const editedDataUrl = drawEditedWallpaperOnly();
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, creator, dataUrl: editedDataUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    status.textContent =
      "Submitted. It will appear in Wallpapers after admin approval.";
    $("#wallpaperFile").value = "";
    $("#wallpaperTitle").value = "";
    $("#creatorName").value = getUser()?.creatorName || "";
    selectedFileDataUrl = "";
    selectedFileName = "";
    selectedImageMeta = null;
    sourceImage = null;
    clearSelectedObjectUrl();
    $("#selectedInfo").classList.add("hidden");
    $("#presetArea").classList.add("hidden");
    $("#previewStage").classList.add("hidden");
  } catch (error) {
    status.textContent = error.message;
    $("#submitBtn").disabled = false;
  }
}
const WALLPAPER_CACHE_KEY = "readyvoid.approvedWallpapers.v1";
const WALLPAPER_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
function readWallpaperCache() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(WALLPAPER_CACHE_KEY) || "null",
    );
    if (!cached || !Array.isArray(cached.wallpapers)) return [];
    if (Date.now() - Number(cached.savedAt || 0) > WALLPAPER_CACHE_MAX_AGE_MS)
      return [];
    return cached.wallpapers.filter(
      (item) => item && item.id && (item.thumbUrl || item.mediaUrl),
    );
  } catch {
    return [];
  }
}
function saveWallpaperCache(wallpapers) {
  try {
    if (Array.isArray(wallpapers))
      localStorage.setItem(
        WALLPAPER_CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          wallpapers: wallpapers.slice(0, 96),
        }),
      );
  } catch {}
}
function showWallpaperLoadingPlaceholders() {
  const grid = $("#wallpapersGrid");
  const empty = $("#wallpapersEmpty");
  if (!grid || !empty || approvedWallpapers.length) return;
  empty.classList.add("hidden");
  grid.classList.add("wallpaper-grid-loading");
  grid.innerHTML = Array.from(
    { length: 6 },
    (_, index) =>
      `<article class="wallpaper-card wallpaper-card-skeleton" aria-hidden="true" style="--skeleton-delay:${index * 60}ms"><div class="wallpaper-image-wrap"></div><div class="wallpaper-card-bottom"><div class="skeleton-line skeleton-title"></div><div class="skeleton-line skeleton-meta"></div></div></article>`,
  ).join("");
}
function clearWallpaperLoadingPlaceholders() {
  const grid = $("#wallpapersGrid");
  if (grid) grid.classList.remove("wallpaper-grid-loading");
}
async function loadWallpapers() {
  const grid = $("#wallpapersGrid");
  const empty = $("#wallpapersEmpty");
  const cached = readWallpaperCache();
  if (cached.length) {
    approvedWallpapers = cached;
    clearWallpaperLoadingPlaceholders();
    renderWallpapers();
    renderSearchWallpaperResults(activeSearchQuery);
  } else {
    approvedWallpapers = [];
    if (grid) grid.innerHTML = "";
    showWallpaperLoadingPlaceholders();
  }
  if (empty) empty.classList.add("hidden");
  try {
    const response = await fetch("/api/wallpapers", { cache: "no-cache" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Could not load wallpapers.");
    approvedWallpapers = Array.isArray(data.wallpapers) ? data.wallpapers : [];
    saveWallpaperCache(approvedWallpapers);
    clearWallpaperLoadingPlaceholders();
    renderWallpapers();
    renderSearchWallpaperResults(activeSearchQuery);
  } catch (error) {
    clearWallpaperLoadingPlaceholders();
    if (cached.length) {
      showResponseToast("Showing cached wallpapers while the server wakes up.");
      return;
    }
    if (grid) grid.innerHTML = "";
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent =
        error.message ||
        "Could not load wallpapers. Make sure the server is running.";
    }
  }
}
