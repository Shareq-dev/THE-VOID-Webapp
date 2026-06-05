function wallpaperCardMarkup(item) {
  const creator = item.creator || "The Void";
  const creatorUsername = normalizeUsernameInput(creator);
  const creatorMarkup = creatorUsername
    ? `<button class="wallpaper-creator-link" type="button" data-profile-username="${escapeHtml(creatorUsername)}">@${escapeHtml(creator)}</button>`
    : `<span class="wallpaper-creator-text">@${escapeHtml(creator)}</span>`;
  return `
    <article class="wallpaper-card">
      <div class="wallpaper-image-wrap">
        <img class="wallpaper-media" src="${escapeHtml(item.thumbUrl || item.mediaUrl)}" data-full-src="${escapeHtml(item.mediaUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" width="360" height="640" />
        <div class="wallpaper-actions wallpaper-actions-overlay">
          <button class="wallpaper-action" type="button" data-preview-id="${item.id}" aria-label="Preview ${escapeHtml(item.title)}">
            <span class="wallpaper-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12 18.7 18.5 12 18.5 1.5 12 1.5 12Z"></path><circle cx="12" cy="12" r="3.25"></circle></svg>
            </span>
            <span class="wallpaper-action-label">Preview</span>
          </button>
          <button class="wallpaper-action" type="button" data-download-id="${item.id}" aria-label="Download ${escapeHtml(item.title)}">
            <span class="wallpaper-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"></path><path d="m7.8 10.8 4.2 4.2 4.2-4.2"></path><path d="M4.5 18.5h15"></path></svg>
            </span>
            <span class="wallpaper-action-label">Download</span>
          </button>
        </div>
      </div>
      <div class="wallpaper-card-bottom">
        <div class="wallpaper-meta">
          <h3>${escapeHtml(item.title)}</h3>
          <p>by ${creatorMarkup}</p>
        </div>
      </div>
    </article>
  `;
}
function attachWallpaperCardHandlers(root = document) {
  root.querySelectorAll("[data-preview-id]").forEach((button) => {
    if (button.dataset.voidPreviewBound) return;
    button.dataset.voidPreviewBound = "1";
    button.addEventListener("click", () => {
      const openedFromSearch = Boolean(
        button.closest("#searchModal") ||
        button.closest("#wallpaperSearchResults"),
      );
      openWallpaperPreview(button.dataset.previewId, { openedFromSearch });
    });
  });
  root.querySelectorAll(".wallpaper-creator-link").forEach((button) => {
    if (button.dataset.voidProfileBound) return;
    button.dataset.voidProfileBound = "1";
    button.addEventListener("click", () =>
      openProfileModal(button.dataset.profileUsername || ""),
    );
  });
  root.querySelectorAll("[data-download-id]").forEach((button) => {
    if (button.dataset.voidDownloadBound) return;
    button.dataset.voidDownloadBound = "1";
    button.addEventListener("click", () => {
      requireUser("download", () =>
        startWallpaperDownload(button.dataset.downloadId),
      );
    });
  });
}
const WALLPAPER_BATCH_SIZE = 12;
let renderedWallpaperCount = 0;
let wallpaperBatchObserver = null;
function stopWallpaperBatchObserver() {
  if (wallpaperBatchObserver) {
    wallpaperBatchObserver.disconnect();
    wallpaperBatchObserver = null;
  }
}
function getWallpaperLoadMoreSentinel() {
  let sentinel = $("#wallpaperLoadMoreSentinel");
  const grid = $("#wallpapersGrid");
  if (!sentinel && grid) {
    sentinel = document.createElement("div");
    sentinel.id = "wallpaperLoadMoreSentinel";
    sentinel.className = "wallpaper-load-more-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    grid.after(sentinel);
  }
  return sentinel;
}
function setWallpaperSentinelVisible(visible) {
  const sentinel = getWallpaperLoadMoreSentinel();
  if (sentinel) sentinel.hidden = !visible;
}
function animateNewWallpaperCards(cards) {
  if (
    !(
      window.matchMedia &&
      window.matchMedia("(max-width: 700px), (pointer: coarse)").matches
    ) ||
    !cards.length
  )
    return;
  cards.forEach((card) => card.classList.add("void-card-enter"));
  requestAnimationFrame(() => {
    requestAnimationFrame(() =>
      cards.forEach((card) => card.classList.add("void-card-in")),
    );
  });
}
function prewarmUpcomingWallpaperImages() {
  if (
    !(
      window.matchMedia &&
      window.matchMedia("(max-width: 700px), (pointer: coarse)").matches
    )
  )
    return;
  const upcoming = approvedWallpapers.slice(
    renderedWallpaperCount,
    renderedWallpaperCount + 6,
  );
  if (!upcoming.length) return;
  window.setTimeout(() => {
    upcoming.forEach((item) => {
      const url = item.thumbUrl || item.previewUrl || item.mediaUrl;
      if (!prewarmUpcomingWallpaperImages.seen)
        prewarmUpcomingWallpaperImages.seen = new Set();
      if (!url || prewarmUpcomingWallpaperImages.seen.has(url)) return;
      prewarmUpcomingWallpaperImages.seen.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    });
  }, 180);
}
function appendWallpaperCards(items) {
  const grid = $("#wallpapersGrid");
  if (!grid || !items.length) return;
  const template = document.createElement("template");
  template.innerHTML = items.map(wallpaperCardMarkup).join("");
  attachWallpaperCardHandlers(template.content);
  const cards = [...template.content.querySelectorAll(".wallpaper-card")];
  grid.appendChild(template.content);
  animateNewWallpaperCards(cards);
}
function renderNextWallpaperBatch() {
  const nextWallpapers = approvedWallpapers.slice(
    renderedWallpaperCount,
    renderedWallpaperCount + WALLPAPER_BATCH_SIZE,
  );
  if (!nextWallpapers.length) {
    setWallpaperSentinelVisible(false);
    stopWallpaperBatchObserver();
    return;
  }
  appendWallpaperCards(nextWallpapers);
  renderedWallpaperCount += nextWallpapers.length;
  prewarmUpcomingWallpaperImages();
  if (renderedWallpaperCount >= approvedWallpapers.length) {
    setWallpaperSentinelVisible(false);
    stopWallpaperBatchObserver();
  }
}
function setupWallpaperInfiniteLoader() {
  const sentinel = getWallpaperLoadMoreSentinel();
  if (!sentinel) return;
  setWallpaperSentinelVisible(
    renderedWallpaperCount < approvedWallpapers.length,
  );
  stopWallpaperBatchObserver();
  if (renderedWallpaperCount >= approvedWallpapers.length) return;
  if (!("IntersectionObserver" in window)) {
    while (renderedWallpaperCount < approvedWallpapers.length)
      renderNextWallpaperBatch();
    return;
  }
  wallpaperBatchObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        renderNextWallpaperBatch();
      }
    },
    { rootMargin: "900px 0px", threshold: 0 },
  );
  wallpaperBatchObserver.observe(sentinel);
}
function renderWallpapers() {
  const grid = $("#wallpapersGrid");
  const empty = $("#wallpapersEmpty");
  if (!grid || !empty) return;
  stopWallpaperBatchObserver();
  renderedWallpaperCount = 0;
  grid.innerHTML = "";
  empty.classList.add("hidden");
  if (!approvedWallpapers.length) {
    setWallpaperSentinelVisible(false);
    empty.classList.remove("hidden");
    empty.textContent =
      "No wallpapers yet. New uploads appear here after review.";
    return;
  }
  renderNextWallpaperBatch();
  setupWallpaperInfiniteLoader();
}
function filenameFromDisposition(header, fallback) {
  const match = String(header || "").match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}
async function startWallpaperDownload(id) {
  const item = approvedWallpapers.find((wallpaper) => wallpaper.id === id);
  if (!item) return;
  const button = document.querySelector(
    `[data-download-id="${CSS.escape(id)}"]`,
  );
  if (button) button.disabled = true;
  try {
    const response = await fetch(`/api/download/${encodeURIComponent(id)}`, {
      headers: creatorHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Login required to download.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ext =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : "jpg";
    link.href = url;
    link.download = filenameFromDisposition(
      response.headers.get("Content-Disposition"),
      `${safeFileName(item.title)}.${ext}`,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showResponseToast(error.message || "Could not download wallpaper.");
  } finally {
    if (button) button.disabled = false;
  }
}
function safeFileName(value) {
  return (
    String(value || "wallpaper")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "wallpaper"
  );
}
let wallpaperPreviewLoadToken = 0;
function clearApprovedPreviewCanvases() {
  ["#approvedLockCanvas", "#approvedHomeCanvas"].forEach((selector) => {
    const canvas = $(selector);
    if (!canvas) return;
    canvas.classList.remove("void-media-ready");
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
}
function openWallpaperPreview(id, options = {}) {
  const item = approvedWallpapers.find((wallpaper) => wallpaper.id === id);
  if (!item) return;
  const token = ++wallpaperPreviewLoadToken;
  $("#wallpaperPreviewTitle").textContent = item.title;
  $("#wallpaperPreviewCreator").textContent =
    `by ${item.creator || "The Void"}`;
  clearApprovedPreviewCanvases();
  const modal = $("#wallpaperPreviewModal");
  modal.dataset.previewId = id;
  modal.classList.toggle(
    "opened-from-search",
    Boolean(options.openedFromSearch),
  );
  const wasHidden = modal.classList.contains("hidden");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  if (wasHidden) lockPageScroll();

  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    if (
      token !== wallpaperPreviewLoadToken ||
      modal.dataset.previewId !== id ||
      modal.classList.contains("hidden")
    )
      return;
    const lockCanvas = $("#approvedLockCanvas");
    const homeCanvas = $("#approvedHomeCanvas");
    drawPreviewToCanvas(
      lockCanvas,
      lockCanvas.getContext("2d"),
      image,
      "lock",
      { drawGrid: false, adjusted: false },
    );
    drawPreviewToCanvas(
      homeCanvas,
      homeCanvas.getContext("2d"),
      image,
      "home",
      { drawGrid: false, adjusted: false },
    );
    lockCanvas?.classList.add("void-media-ready");
    homeCanvas?.classList.add("void-media-ready");
  };
  image.onerror = () => {
    if (token !== wallpaperPreviewLoadToken) return;
    const fallback = item.mediaUrl;
    const fallbackUrl = fallback
      ? new URL(fallback, window.location.href).href
      : "";
    if (fallbackUrl && image.src !== fallbackUrl) image.src = fallback;
  };

  image.src = item.previewUrl || item.mediaUrl;
}
function closeWallpaperPreview() {
  const modal = $("#wallpaperPreviewModal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) return;
  wallpaperPreviewLoadToken += 1;
  clearApprovedPreviewCanvases();
  modal.classList.add("hidden");
  modal.classList.remove("opened-from-search");
  modal.removeAttribute("data-preview-id");
  modal.setAttribute("aria-hidden", "true");
  unlockPageScroll();
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}
(function () {
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lowPowerScroll =
    reduceMotion ||
    (window.matchMedia && window.matchMedia("(max-width: 700px)").matches);
  const canObserveMotion = "IntersectionObserver" in window;
  const mediaSelector =
    ".wallpaper-media, .profile-post-card img, .profile-post-edit-card > img, .profile-avatar img";
  const revealSelector = lowPowerScroll
    ? ".section, .about-panel, .upload-panel, .footer-panel, .search-results-head, .search-results-empty, .legal-document > *"
    : ".section, .about-panel, .upload-panel, .footer-panel, .wallpaper-card, .preset-card, .profile-post-card, .approved-preview-item, .search-results-head, .search-results-empty, .legal-document > *";
  const pressSelector =
    'a, button, [role="button"], label.dropzone, .preset-card, .wallpaper-card, .profile-post-card, .void-menu-item, .login-tab, .wallpaper-action, .reset-pill';
  const mediaWrapSelector =
    ".wallpaper-image-wrap, .profile-post-card, .profile-post-edit-card";

  function collectElements(root, selector) {
    if (!root) return [];
    const elements = [];
    if (root.nodeType === 1 && root.matches && root.matches(selector))
      elements.push(root);
    if (root.querySelectorAll)
      elements.push(...root.querySelectorAll(selector));
    return elements;
  }

  const revealObserver =
    lowPowerScroll || !canObserveMotion
      ? null
      : new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("in-view");
              revealObserver.unobserve(entry.target);
            });
          },
          { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
        );

  function closestMotionWrap(element) {
    return (
      element.closest(
        ".wallpaper-image-wrap, .profile-post-card, .profile-post-edit-card, .profile-avatar, .approved-phone-frame",
      ) || element.parentElement
    );
  }

  function markMediaReady(element) {
    if (!element) return;
    element.classList.add("void-media-ready");
    closestMotionWrap(element)?.classList.add("void-media-wrap-ready");
  }

  function prepareMedia(root) {
    collectElements(root, mediaSelector).forEach((element) => {
      if (element.dataset.voidMotionMedia) return;
      element.dataset.voidMotionMedia = "1";
      if (lowPowerScroll) {
        markMediaReady(element);
        return;
      }
      if (element.complete && element.naturalWidth) {
        requestAnimationFrame(() => markMediaReady(element));
        return;
      }
      element.addEventListener("load", () => markMediaReady(element), {
        once: true,
      });
      element.addEventListener("error", () => {
        const fallback = element.dataset.fullSrc;
        if (fallback && element.getAttribute("src") !== fallback) {
          element.setAttribute("src", fallback);
          return;
        }
        markMediaReady(element);
      });
    });
  }

  function prepareCanvasReveal(root) {
    collectElements(root, ".approved-phone-frame canvas").forEach((canvas) => {
      if (canvas.dataset.voidMotionCanvas) return;
      canvas.dataset.voidMotionCanvas = "1";
      if (lowPowerScroll) {
        markMediaReady(canvas);
        return;
      }
      canvas.classList.remove("void-media-ready");
      setTimeout(() => markMediaReady(canvas), 90);
    });
  }

  function prepareMediaWrappers(root) {
    collectElements(root, mediaWrapSelector).forEach((wrap) => {
      if (wrap.querySelector && !wrap.querySelector(mediaSelector)) {
        wrap.classList.add("void-media-wrap-ready");
      }
    });
  }

  function prepareReveal(root) {
    collectElements(root, revealSelector).forEach((element, index) => {
      if (
        element.dataset.voidMotionReveal ||
        element.classList.contains("hidden")
      )
        return;
      element.dataset.voidMotionReveal = "1";
      element.classList.add("void-reveal");
      element.style.setProperty(
        "--void-reveal-delay",
        `${Math.min((index % 7) * 45, 270)}ms`,
      );
      if (lowPowerScroll || !revealObserver) {
        element.classList.add("in-view");
      } else {
        revealObserver.observe(element);
      }
    });
  }

  function prepareMotion(root = document) {
    prepareMedia(root);
    prepareCanvasReveal(root);
    prepareMediaWrappers(root);
    prepareReveal(root);
  }

  function attachPressFeedback() {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target.closest(pressSelector);
        if (
          !target ||
          target.disabled ||
          target.getAttribute("aria-disabled") === "true"
        )
          return;
        target.classList.remove("void-press");
        void target.offsetWidth;
        target.classList.add("void-press");
        window.setTimeout(() => target.classList.remove("void-press"), 320);
      },
      { passive: true },
    );
  }

  function watchDom() {
    const pendingNodes = new Set();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const nodes = [...pendingNodes];
      pendingNodes.clear();
      nodes.forEach((node) => prepareMotion(node));
    };
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(flush, { timeout: 300 });
      } else {
        window.requestAnimationFrame(flush);
      }
    };
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          pendingNodes.add(node);
        });
      });
      if (pendingNodes.size) scheduleFlush();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        prepareMotion();
        attachPressFeedback();
        watchDom();
      },
      { once: true },
    );
  } else {
    prepareMotion();
    attachPressFeedback();
    watchDom();
  }
})();

function setupHeroPerformanceGuard() {
  const hero = document.querySelector(".app-hero");
  if (!hero || !("IntersectionObserver" in window)) return;
  const root = document.documentElement;
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      root.classList.toggle("void-hero-paused", !visible);
    },
    { threshold: 0 },
  );
  observer.observe(hero);
}
