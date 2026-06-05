function clearUserSearchResults() {
  const box = getUserSearchResultsBox();
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
}
function getWallpaperSearchResultsBox() {
  return $("#wallpaperSearchResults");
}
function clearSearchWallpaperResults() {
  const box = getWallpaperSearchResultsBox();
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
}
function renderSearchWallpaperResults(rawValue = activeSearchQuery) {
  const box = getWallpaperSearchResultsBox();
  if (!box) return;
  const rawSearch = String(rawValue || "").trim();
  if (!rawSearch || rawSearch.startsWith("@")) {
    clearSearchWallpaperResults();
    return;
  }
  const query = rawSearch.toLowerCase();
  const visibleWallpapers = approvedWallpapers.filter((item) =>
    `${item.title || ""} ${item.creator || ""}`.toLowerCase().includes(query),
  );
  box.classList.remove("hidden");
  if (!visibleWallpapers.length) {
    box.innerHTML = `<p class="search-results-empty">No wallpapers match “${escapeHtml(rawSearch)}”.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="search-results-head">
      <p class="eyebrow">Results</p>
      <strong>${visibleWallpapers.length} wallpaper${visibleWallpapers.length === 1 ? "" : "s"} found</strong>
    </div>
    <div class="wallpaper-grid search-wallpaper-grid">
      ${visibleWallpapers.map(wallpaperCardMarkup).join("")}
    </div>
  `;
  attachWallpaperCardHandlers(box);
}
function handleMenuSearchInput(event) {
  const raw = String(event?.target?.value || "").trim();
  activeSearchQuery = raw;
  if (raw.startsWith("@")) {
    clearSearchWallpaperResults();
    window.clearTimeout(userSearchTimer);
    userSearchTimer = window.setTimeout(() => searchUsersByName(raw), 220);
    return;
  }
  window.clearTimeout(userSearchTimer);
  clearUserSearchResults();
  renderSearchWallpaperResults(raw);
}
async function searchUsersByName(rawValue) {
  const box = getUserSearchResultsBox();
  if (!box) return;
  const username = normalizeUsernameInput(rawValue);
  if (!username) {
    clearUserSearchResults();
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = '<p class="user-search-hint">Searching creators...</p>';
  try {
    const data = await apiJson(
      `/api/users/search?q=${encodeURIComponent(username)}`,
    );
    renderUserSearchResults(data.users || [], username);
  } catch (error) {
    box.innerHTML = `<p class="user-search-hint">${escapeHtml(error.message || "Could not search users.")}</p>`;
  }
}
function renderUserSearchResults(users, username) {
  const box = getUserSearchResultsBox();
  if (!box) return;
  box.classList.remove("hidden");
  if (!users.length) {
    box.innerHTML = `<p class="search-results-empty">No creator found for @${escapeHtml(username)}.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="search-results-head">
      <p class="eyebrow">Results</p>
      <strong>${users.length} creator${users.length === 1 ? "" : "s"} found</strong>
    </div>
    <div class="creator-search-grid search-wallpaper-grid">
      ${users
        .map((user) => {
          const displayName = user.creatorName || user.username || "void";
          return `<button class="creator-search-card" type="button" data-profile-username="${escapeHtml(displayName)}"><span class="creator-search-avatar">${profileAvatarMarkup(user)}</span><span class="creator-search-copy"><strong>@${escapeHtml(displayName)}</strong><small>View profile</small></span></button>`;
        })
        .join("")}
    </div>
  `;
  box.querySelectorAll(".creator-search-card").forEach((button) => {
    button.addEventListener("click", () => {
      $("#voidMenuPanel")?.classList.add("hidden");
      $("#voidMenuToggle")?.setAttribute("aria-expanded", "false");
      removeModal(document.querySelector("#searchModal"));
      openProfileModal(button.dataset.profileUsername || "");
    });
  });
}
function showSearchModal() {
  if (document.querySelector("#searchModal")) return;
  $("#voidMenuPanel")?.classList.add("hidden");
  $("#voidMenuToggle")?.setAttribute("aria-expanded", "false");
  const modal = document.createElement("div");
  modal.id = "searchModal";
  modal.className = "search-modal fullscreen-modal";
  modal.innerHTML = `
    <section class="search-screen" role="dialog" aria-modal="true" aria-labelledby="searchTitle">
      <button class="login-close-btn" type="button" aria-label="Close search">&times;</button>
      <div class="fullscreen-section-head">
        <p class="eyebrow">Search</p>
        <h2 id="searchTitle">Find wallpapers or creators</h2>
      </div>
      <label class="field-label search-screen-label" for="wallpaperSearch">
        Wallpaper name or @username
        <input id="wallpaperSearch" type="search" placeholder="e.g. @the_void" autocomplete="off" />
      </label>
      <div id="userSearchResults" class="user-search-results hidden"></div>
      <div id="wallpaperSearchResults" class="search-wallpaper-results hidden"></div>
      <p class="search-screen-hint">Use @ before a username to search creator profiles.</p>
    </section>
  `;
  document.body.appendChild(modal);
  lockPageScroll();
  const input = modal.querySelector("#wallpaperSearch");
  const close = () => {
    closeWallpaperPreview();
    removeModal(modal);
  };
  modal.querySelector(".login-close-btn")?.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  input.value = activeSearchQuery;
  input.addEventListener("input", handleMenuSearchInput);
  input.focus();
  if (activeSearchQuery.startsWith("@")) {
    clearSearchWallpaperResults();
    searchUsersByName(activeSearchQuery);
  } else {
    clearUserSearchResults();
    renderSearchWallpaperResults(activeSearchQuery);
  }
}
function profileInitial(name) {
  return (
    String(name || "V")
      .replace(/^@+/, "")
      .trim()
      .charAt(0)
      .toUpperCase() || "V"
  );
}
function profileAvatarMarkup(user, size = "large") {
  const username = user?.creatorName || user?.username || "void";
  const src = user?.profilePicUrl || user?.avatarUrl || "";
  if (src)
    return `<img src="${escapeHtml(src)}" alt="@${escapeHtml(username)} profile picture" />`;
  return `<span class="profile-avatar-initial ${size === "small" ? "small" : ""}">${escapeHtml(profileInitial(username))}</span>`;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read selected image."));
    reader.readAsDataURL(file);
  });
}
function formatJoinDate(value) {
  if (!value) return "New creator";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "New creator";
  return `In space since ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
async function hydrateProfile() {
  try {
    const response = await fetch("/api/profile");
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.user) setUser(data.user);
    else clearUser();
  } catch {
    syncAccountMenuState();
  }
}
async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(formatAuthError(data.error || "Request failed."));
  return data;
}
function voidHeroTitleSection(extraClass = "") {
  return `
    <header class="app-hero ${extraClass}" aria-label="THE VOID hero">
      <div class="hero-stage" aria-hidden="true">
        <span class="hero-ring"></span>
        <span class="hero-core"></span>
        <span class="hero-glow"></span>
        <span class="hollow-wave wave-one"></span>
        <span class="hollow-wave wave-two"></span>
        <span class="hollow-orbit orbit-one"></span>
        <span class="hollow-orbit orbit-two"></span>
        <span class="hollow-slice slice-left"></span>
        <span class="hollow-slice slice-right"></span>
        <span class="hero-arc arc-a"></span>
        <span class="hero-arc arc-b"></span>
        <span class="hero-mist mist-left"></span>
        <span class="hero-mist mist-right"></span>
      </div>
      <div class="hero-content">
        <h1 class="hero-title" aria-label="THE VOID">THE VOID</h1>
        <p class="hero-subtitle">WALLPAPERS BEYOND LIGHT</p>
      </div>
    </header>
  `;
}
function showLoginModal({ intent = "upload", onReady } = {}) {
  if (document.querySelector("#loginModal")) return;
  const modal = document.createElement("div");
  modal.id = "loginModal";
  modal.innerHTML = `
    <div class="modal-card login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
      <button class="login-close-btn" type="button" aria-label="Close login">×</button>

      ${voidHeroTitleSection("login-title-section")}

      <div class="login-card-head">
        <p class="eyebrow">Creator access</p>
        <p id="loginTitle" class="login-intent-copy">Signup or login</p>
        <p class="login-copy">Use one unique username and password. Username is permanent after signup.</p>
      </div>

      <div class="login-tabs" role="tablist" aria-label="Login mode">
        <button id="signupTab" class="login-tab active" type="button">Signup</button>
        <button id="loginTab" class="login-tab" type="button">Login</button>
      </div>

      <div class="login-username">
        <label class="field-label" for="creatorInput">
          Username
          <input id="creatorInput" type="text" maxlength="24" autocomplete="username" placeholder="username" />
        </label>
        <label class="field-label" for="passwordInput">
          Password
          <input id="passwordInput" type="password" minlength="4" autocomplete="new-password" placeholder="Minimum 4 characters" />
        </label>
        <label id="confirmPasswordLabel" class="field-label" for="confirmPasswordInput">
          Confirm password
          <input id="confirmPasswordInput" type="password" minlength="4" autocomplete="new-password" placeholder="Re-enter password" />
        </label>
        <label id="legalAgreeLabel" class="legal-agree-field">
          <input id="legalAgreeInput" type="checkbox" />
          <span>I agree to the <a href="terms.html" target="_blank" rel="noopener noreferrer">Terms of service</a> and <a href="privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
        </label>
        <p class="login-back-copy" hidden>Welcome back to space.</p>
        <button id="confirmUser" class="primary-btn" type="button">Signup</button>
        <p class="login-note">Choose a unique username. You can use letters, numbers, underscore, dot, or dash. Username cannot be changed later.</p>
        <p id="err" class="status-text login-error" role="alert"></p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  lockPageScroll();
  let mode = "signup";
  const signupTab = modal.querySelector("#signupTab");
  const loginTab = modal.querySelector("#loginTab");
  const usernameInput = modal.querySelector("#creatorInput");
  const passwordInput = modal.querySelector("#passwordInput");
  const confirmPasswordLabel = modal.querySelector("#confirmPasswordLabel");
  const confirmPasswordInput = modal.querySelector("#confirmPasswordInput");
  const legalAgreeLabel = modal.querySelector("#legalAgreeLabel");
  const legalAgreeInput = modal.querySelector("#legalAgreeInput");
  const loginNote = modal.querySelector(".login-note");
  const loginBackCopy = modal.querySelector(".login-back-copy");
  const err = modal.querySelector("#err");
  const confirmButton = modal.querySelector("#confirmUser");
  const close = () => removeModal(modal);
  modal.querySelector(".login-close-btn").addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  const setMode = (nextMode) => {
    mode = nextMode;
    signupTab.classList.toggle("active", mode === "signup");
    loginTab.classList.toggle("active", mode === "login");
    confirmButton.textContent = mode === "signup" ? "Signup" : "Login";
    passwordInput.autocomplete =
      mode === "signup" ? "new-password" : "current-password";
    const showConfirmPassword = mode === "signup";
    confirmPasswordLabel.hidden = !showConfirmPassword;
    confirmPasswordLabel.style.display = showConfirmPassword ? "" : "none";
    confirmPasswordInput.disabled = !showConfirmPassword;
    confirmPasswordInput.value = "";
    legalAgreeLabel.hidden = !showConfirmPassword;
    legalAgreeLabel.style.display = showConfirmPassword ? "" : "none";
    legalAgreeInput.disabled = !showConfirmPassword;
    if (!showConfirmPassword) legalAgreeInput.checked = false;
    if (loginNote) {
      loginNote.hidden = mode === "login";
      loginNote.style.display = mode === "login" ? "none" : "";
    }
    if (loginBackCopy) {
      loginBackCopy.hidden = mode !== "login";
      loginBackCopy.style.display = mode === "login" ? "" : "none";
    }
    err.textContent = "";
    err.classList.remove("login-success");
    usernameInput.focus();
  };
  signupTab.addEventListener("click", () => setMode("signup"));
  loginTab.addEventListener("click", () => setMode("login"));
  const confirm = async () => {
    err.textContent = "";
    const username = normalizeUsernameInput(usernameInput.value);
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    usernameInput.value = username;
    if (!username || username.length < 3) {
      err.textContent = "Username must be at least 3 characters.";
      return;
    }
    if (password.length < 4) {
      err.textContent = "Password must be at least 4 characters.";
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      err.textContent = "Passwords do not match.";
      return;
    }
    if (mode === "signup" && !legalAgreeInput.checked) {
      err.textContent =
        "Please agree to the Terms of service and Privacy Policy.";
      return;
    }
    confirmButton.disabled = true;
    confirmButton.textContent =
      mode === "signup" ? "Signing up..." : "Logging in...";
    err.classList.remove("login-success");
    let closingAfterSuccess = false;
    try {
      const endpoint =
        mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload =
        mode === "signup"
          ? { username, password, browserKey: getBrowserKey() }
          : { username, password, browserKey: getBrowserKey() };
      const data = await apiJson(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUser(data.user);
      if (mode === "signup") {
        closingAfterSuccess = true;
        err.classList.add("login-success");
        err.textContent = data.alreadyExisted
          ? "Profile already exist, Loging in."
          : "Account Created Successfully";
        confirmButton.textContent = data.alreadyExisted
          ? "Existing account"
          : "Created";
        window.setTimeout(
          () => {
            removeModal(modal);
            if (onReady) onReady(getUser());
            else if (intent === "profile") openProfileModal();
          },
          data.alreadyExisted ? 650 : 900,
        );
        return;
      }
      removeModal(modal);
      onReady?.(getUser());
    } catch (error) {
      err.classList.remove("login-success");
      err.textContent = formatAuthError(error.message || "Access failed.");
    } finally {
      if (!closingAfterSuccess) {
        confirmButton.disabled = false;
        confirmButton.textContent = mode === "signup" ? "Signup" : "Login";
      }
    }
  };
  confirmButton.addEventListener("click", confirm);
  [usernameInput, passwordInput, confirmPasswordInput].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") confirm();
    });
  });
  setMode(intent === "login" ? "login" : "signup");
}
async function openProfileModal(profileUsername = "") {
  const currentUser = getUser();
  const requestedUsername = normalizeUsernameInput(profileUsername);
  const ownProfile =
    !requestedUsername ||
    (currentUser &&
      normalizeUsernameInput(currentUser.creatorName) === requestedUsername);
  if (!currentUser && ownProfile) {
    showLoginModal({ intent: "profile" });
    return;
  }
  removeModal(document.querySelector("#profileModal"));
  const modal = document.createElement("div");
  modal.id = "profileModal";
  modal.className = "profile-modal";
  modal.innerHTML = `
    <div class="profile-card instagram-profile-card" role="dialog" aria-modal="true" aria-labelledby="profileTitle">
      <button class="login-close-btn" type="button" aria-label="Close profile">×</button>
      <div id="profileBody" class="profile-body-loading">
        <p class="eyebrow">Creator Profile</p>
        <h2 id="profileTitle">Loading profile...</h2>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  lockPageScroll();
  const close = () => removeModal(modal);
  modal.querySelector(".login-close-btn").addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  try {
    const endpoint = ownProfile
      ? "/api/profile"
      : `/api/users/${encodeURIComponent(requestedUsername)}`;
    const data = await apiJson(endpoint);
    if (ownProfile) setUser(data.user);
    renderProfileContent(modal, data, ownProfile);
  } catch (error) {
    const body = modal.querySelector("#profileBody");
    body.innerHTML = `
      <p class="eyebrow">Creator Profile</p>
      <h2 id="profileTitle">Profile unavailable</h2>
      <p class="profile-muted">${escapeHtml(error.message || "Could not load profile.")}</p>
    `;
  }
}
