const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const layoutPresets = [
  {
    id: "lock",
    name: "Lock screen",
    desc: "Large clock and lock-screen layout preview.",
    style: "lock",
    clock: "stacked",
    depth: "soft",
  },
  {
    id: "home",
    name: "Home screen",
    desc: "Home screen icon grid and dock preview.",
    style: "home",
    clock: "none",
    depth: "none",
  },
];
const previewDevice = { name: "Primary 9:16 · 1080×1920", w: 1080, h: 1920 };
let selectedFileDataUrl = "";
let selectedFileName = "";
let selectedImageMeta = null;
let selectedObjectUrl = "";
let activePreset = layoutPresets[0];
let sourceImage = null;
let previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
let approvedWallpapers = [];
let userSearchTimer = null;
let activeSearchQuery = "";
let modalScrollLockCount = 0;
const canvas = $("#wallpaperCanvas");
const ctx = canvas.getContext("2d");
function getUser() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return user?.creatorId && user?.creatorName ? user : null;
  } catch {
    return null;
  }
}
function randomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return (
    [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") ||
    `${Date.now()}-${Math.random()}`
  );
}
function getBrowserKey() {
  let key = localStorage.getItem("browserKey");
  if (!key) {
    key = randomId();
    localStorage.setItem("browserKey", key);
  }
  return key;
}
function hasOpenScrollLockedModal() {
  return Boolean(
    document.querySelector(
      "#wallpaperPreviewModal:not(.hidden), #loginModal, .profile-modal, .search-modal",
    ),
  );
}
function recoverPageScrollLock() {
  if (!hasOpenScrollLockedModal()) {
    modalScrollLockCount = 0;
    document.body.classList.remove("modal-open");
  }
}
function lockPageScroll() {
  modalScrollLockCount += 1;
  document.body.classList.add("modal-open");
}
function unlockPageScroll() {
  modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
  if (!modalScrollLockCount) document.body.classList.remove("modal-open");
  window.setTimeout(recoverPageScrollLock, 0);
}
function removeModal(modal) {
  if (!modal || !modal.isConnected) {
    recoverPageScrollLock();
    return;
  }
  modal.remove();
  unlockPageScroll();
}
window.addEventListener("pageshow", recoverPageScrollLock);
function normalizeUsernameInput(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 24);
}
function formatAuthError(message) {
  const text = String(message || "Request failed.");
  if (
    text === "USERNAME_TAKEN" ||
    /users_creator_name_key_unique|creator_name_key|username.*taken|duplicate key/i.test(
      text,
    )
  ) {
    return "Username already taken.";
  }
  if (
    /signup_ip_hash|already has an account|creator profile already exists?/i.test(
      text,
    )
  ) {
    return "Creator profile already exist on this IP.";
  }
  return text;
}
function showResponseToast(message) {
  const text = String(message || "").trim();
  if (!text) return;
  let toast = document.querySelector("#responseToast");
  if (!toast) {
    toast = document.createElement("p");
    toast.id = "responseToast";
    toast.className = "response-toast hidden";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.remove("hidden");
  window.clearTimeout(showResponseToast.timer);
  showResponseToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}
function setUser(user) {
  const normalized = {
    creatorId: user.creatorId,
    creatorName: user.creatorName || user.username,
    username: user.username || user.creatorName,
    authType: "password",
    profilePicUrl: user.profilePicUrl || user.avatarUrl || "",
    avatarUrl: user.avatarUrl || user.profilePicUrl || "",
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
  localStorage.setItem("user", JSON.stringify(normalized));
  localStorage.setItem("authType", "password");
  localStorage.setItem("creatorName", normalized.creatorName);
  const creatorInput = $("#creatorName");
  if (creatorInput) {
    creatorInput.value = normalized.creatorName;
    creatorInput.readOnly = true;
    creatorInput.placeholder = "Login to lock your username";
  }
  syncAccountMenuState();
}
function clearUser() {
  localStorage.removeItem("user");
  localStorage.removeItem("authType");
  localStorage.removeItem("creatorName");
  const creatorInput = $("#creatorName");
  if (creatorInput) {
    creatorInput.value = "";
    creatorInput.readOnly = true;
    creatorInput.placeholder = "Signup or login first";
  }
  syncAccountMenuState();
}
function creatorHeaders() {
  return {};
}
function requireUser(intent, onReady) {
  const user = getUser();
  if (user) {
    onReady?.(user);
    return true;
  }
  showLoginModal({ intent, onReady });
  return false;
}
function setupAccountMenu() {
  const toggle = $("#voidMenuToggle");
  const panel = $("#voidMenuPanel");
  if (!toggle || !panel) return;
  toggle.addEventListener("click", () => {
    const open = panel.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!$("#voidAccountMenu")?.contains(event.target)) {
      panel.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
  $("#menuLoginBtn")?.addEventListener("click", () =>
    showLoginModal({ intent: "profile" }),
  );
  $("#menuProfileBtn")?.addEventListener("click", () => openProfileModal());
  $("#menuLogoutBtn")?.addEventListener("click", logoutUser);
  $("#menuSearchBtn")?.addEventListener("click", () => {
    showSearchModal();
  });
  syncAccountMenuState();
}
function syncAccountMenuState() {
  const user = getUser();
  const label = $("#menuUserLabel");
  if (label) label.textContent = user ? `@${user.creatorName}` : "Guest";
  $("#menuLogoutBtn")?.classList.toggle("hidden", !user);
  $("#menuLoginBtn")?.classList.toggle("hidden", Boolean(user));
  $("#menuProfileBtn")?.classList.toggle("disabled", !user);
}
function getUserSearchResultsBox() {
  const box = $("#userSearchResults");
  return box;
}
