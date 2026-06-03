const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const layoutPresets = [
  { id: 'lock', name: 'Lock screen', desc: 'Large clock and lock-screen layout preview.', style: 'lock', clock: 'stacked', depth: 'soft' },
  { id: 'home', name: 'Home screen', desc: 'Home screen icon grid and dock preview.', style: 'home', clock: 'none', depth: 'none' },
];

const previewDevice = { name: 'Primary 9:16 · 1080×1920', w: 1080, h: 1920 };

let selectedFileDataUrl = '';
let selectedFileName = '';
let selectedImageMeta = null;
let selectedObjectUrl = '';
let activePreset = layoutPresets[0];
let sourceImage = null;
let previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
let approvedWallpapers = [];
let userSearchTimer = null;

const canvas = $('#wallpaperCanvas');
const ctx = canvas.getContext('2d');

init();


function getUser(){
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user?.creatorId && user?.creatorName ? user : null;
  } catch {
    return null;
  }
}

function randomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('') || `${Date.now()}-${Math.random()}`;
}

function getBrowserKey() {
  let key = localStorage.getItem('browserKey');
  if (!key) {
    key = randomId();
    localStorage.setItem('browserKey', key);
  }
  return key;
}

function normalizeUsernameInput(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24);
}

function formatAuthError(message) {
  const text = String(message || 'Request failed.');
  if (text === 'USERNAME_TAKEN' || /users_creator_name_key_unique|creator_name_key|username.*taken|duplicate key/i.test(text)) {
    return 'Username already taken.';
  }
  if (/signup_ip_hash|already has an account|creator profile already exists/i.test(text)) {
    return 'Creator profile already exists on this IP.';
  }
  return text;
}


function showResponseToast(message) {
  const text = String(message || '').trim();
  if (!text) return;
  let toast = document.querySelector('#responseToast');
  if (!toast) {
    toast = document.createElement('p');
    toast.id = 'responseToast';
    toast.className = 'response-toast hidden';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.remove('hidden');
  window.clearTimeout(showResponseToast.timer);
  showResponseToast.timer = window.setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}

function setUser(user) {
  const normalized = {
    creatorId: user.creatorId,
    creatorName: user.creatorName || user.username,
    username: user.username || user.creatorName,
    authType: 'password',
    profilePicUrl: user.profilePicUrl || user.avatarUrl || '',
    avatarUrl: user.avatarUrl || user.profilePicUrl || '',
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
  localStorage.setItem('user', JSON.stringify(normalized));
  localStorage.setItem('authType', 'password');
  localStorage.setItem('creatorName', normalized.creatorName);
  const creatorInput = $('#creatorName');
  if (creatorInput) {
    creatorInput.value = normalized.creatorName;
    creatorInput.readOnly = true;
    creatorInput.placeholder = 'Login to lock your username';
  }
  syncAccountMenuState();
}

function clearUser() {
  localStorage.removeItem('user');
  localStorage.removeItem('authType');
  localStorage.removeItem('creatorName');
  const creatorInput = $('#creatorName');
  if (creatorInput) {
    creatorInput.value = '';
    creatorInput.readOnly = true;
    creatorInput.placeholder = 'Signup or login first';
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
  const toggle = $('#voidMenuToggle');
  const panel = $('#voidMenuPanel');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!$('#voidAccountMenu')?.contains(event.target)) {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  $('#menuLoginBtn')?.addEventListener('click', () => showLoginModal({ intent: 'profile' }));
  $('#menuProfileBtn')?.addEventListener('click', () => openProfileModal());
  $('#menuLogoutBtn')?.addEventListener('click', logoutUser);
  $('#menuSearchBtn')?.addEventListener('click', () => {
    $('#menuSearchBox')?.classList.toggle('hidden');
    $('#wallpaperSearch')?.focus();
  });
  $('#wallpaperSearch')?.addEventListener('input', handleMenuSearchInput);
  syncAccountMenuState();
}

function syncAccountMenuState() {
  const user = getUser();
  const label = $('#menuUserLabel');
  if (label) label.textContent = user ? `@${user.creatorName}` : 'Guest';
  $('#menuLogoutBtn')?.classList.toggle('hidden', !user);
  $('#menuLoginBtn')?.classList.toggle('hidden', Boolean(user));
  $('#menuProfileBtn')?.classList.toggle('disabled', !user);
}


function clearUserSearchResults() {
  const box = $('#userSearchResults');
  if (!box) return;
  box.classList.add('hidden');
  box.innerHTML = '';
}

function handleMenuSearchInput() {
  const input = $('#wallpaperSearch');
  const raw = String(input?.value || '').trim();
  if (raw.startsWith('@')) {
    renderWallpapers();
    window.clearTimeout(userSearchTimer);
    userSearchTimer = window.setTimeout(() => searchUsersByName(raw), 220);
    return;
  }
  window.clearTimeout(userSearchTimer);
  clearUserSearchResults();
  renderWallpapers();
}

async function searchUsersByName(rawValue) {
  const box = $('#userSearchResults');
  if (!box) return;
  const username = normalizeUsernameInput(rawValue);
  if (!username) {
    clearUserSearchResults();
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="user-search-hint">Searching creators...</p>';
  try {
    const data = await apiJson(`/api/users/search?q=${encodeURIComponent(username)}`);
    renderUserSearchResults(data.users || [], username);
  } catch (error) {
    box.innerHTML = `<p class="user-search-hint">${escapeHtml(error.message || 'Could not search users.')}</p>`;
  }
}

function renderUserSearchResults(users, username) {
  const box = $('#userSearchResults');
  if (!box) return;
  box.classList.remove('hidden');
  if (!users.length) {
    box.innerHTML = `<p class="user-search-hint">No creator found for @${escapeHtml(username)}.</p>`;
    return;
  }
  box.innerHTML = users.map((user) => `
    <button class="user-search-result" type="button" data-profile-username="${escapeHtml(user.creatorName || user.username)}">
      <span class="user-search-avatar">${profileAvatarMarkup(user, 'small')}</span>
      <span><strong>@${escapeHtml(user.creatorName || user.username)}</strong><small>View profile</small></span>
    </button>
  `).join('');
  $$('.user-search-result').forEach((button) => {
    button.addEventListener('click', () => {
      $('#voidMenuPanel')?.classList.add('hidden');
      $('#voidMenuToggle')?.setAttribute('aria-expanded', 'false');
      openProfileModal(button.dataset.profileUsername || '');
    });
  });
}

function profileInitial(name) {
  return String(name || 'V').replace(/^@+/, '').trim().charAt(0).toUpperCase() || 'V';
}

function profileAvatarMarkup(user, size = 'large') {
  const username = user?.creatorName || user?.username || 'void';
  const src = user?.profilePicUrl || user?.avatarUrl || '';
  if (src) return `<img src="${escapeHtml(src)}" alt="@${escapeHtml(username)} profile picture" />`;
  return `<span class="profile-avatar-initial ${size === 'small' ? 'small' : ''}">${escapeHtml(profileInitial(username))}</span>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read selected image.'));
    reader.readAsDataURL(file);
  });
}

function formatJoinDate(value) {
  if (!value) return 'New creator';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'New creator';
  return `In space since ${date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
}

async function hydrateProfile() {
  try {
    const response = await fetch('/api/profile');
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.user) setUser(data.user);
    else clearUser();
  } catch {
    syncAccountMenuState();
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(formatAuthError(data.error || 'Request failed.'));
  return data;
}

function showLoginModal({ intent = 'upload', onReady } = {}) {
  if (document.querySelector('#loginModal')) return;

  const modal = document.createElement('div');
  modal.id = 'loginModal';
  modal.innerHTML = `
    <div class="modal-card login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
      <button class="login-close-btn" type="button" aria-label="Close login">×</button>

      <div class="login-preview-strip">
        <div class="login-title-card-content">
          <h2 id="loginTitle" class="login-void-title" aria-label="THE VOID">THE VOID</h2>
          <p class="login-void-subtitle">WALLPAPERS BEYOND LIGHT</p>
        </div>
      </div>

      <div class="login-card-head">
        <p class="eyebrow">Creator access</p>
        <p class="login-intent-copy">Signup or login</p>
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
        <button id="confirmUser" class="primary-btn" type="button">Signup</button>
        <p class="login-note">Choose a unique username. You can use letters, numbers, underscore, dot, or dash. Username cannot be changed later.</p>
        <p id="err" class="status-text login-error" role="alert"></p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let mode = 'signup';
  const signupTab = modal.querySelector('#signupTab');
  const loginTab = modal.querySelector('#loginTab');
  const usernameInput = modal.querySelector('#creatorInput');
  const passwordInput = modal.querySelector('#passwordInput');
  const confirmPasswordLabel = modal.querySelector('#confirmPasswordLabel');
  const confirmPasswordInput = modal.querySelector('#confirmPasswordInput');
  const loginNote = modal.querySelector('.login-note');
  const err = modal.querySelector('#err');
  const confirmButton = modal.querySelector('#confirmUser');

  const close = () => modal.remove();
  modal.querySelector('.login-close-btn').addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  const setMode = (nextMode) => {
    mode = nextMode;
    signupTab.classList.toggle('active', mode === 'signup');
    loginTab.classList.toggle('active', mode === 'login');
    confirmButton.textContent = mode === 'signup' ? 'Signup' : 'Login';
    passwordInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    const showConfirmPassword = mode === 'signup';
    confirmPasswordLabel.hidden = !showConfirmPassword;
    confirmPasswordLabel.style.display = showConfirmPassword ? '' : 'none';
    confirmPasswordInput.disabled = !showConfirmPassword;
    confirmPasswordInput.value = '';
    if (loginNote) {
      loginNote.hidden = mode === 'login';
      loginNote.style.display = mode === 'login' ? 'none' : '';
    }
    err.textContent = '';
    err.classList.remove('login-success');
    usernameInput.focus();
  };

  signupTab.addEventListener('click', () => setMode('signup'));
  loginTab.addEventListener('click', () => setMode('login'));

  const confirm = async () => {
    err.textContent = '';
    const username = normalizeUsernameInput(usernameInput.value);
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    usernameInput.value = username;
    if (!username || username.length < 3) {
      err.textContent = 'Username must be at least 3 characters.';
      return;
    }
    if (password.length < 4) {
      err.textContent = 'Password must be at least 4 characters.';
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      err.textContent = 'Passwords do not match.';
      return;
    }

    confirmButton.disabled = true;
    confirmButton.textContent = mode === 'signup' ? 'Signing up...' : 'Logging in...';
    err.classList.remove('login-success');
    let closingAfterSuccess = false;
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const payload = mode === 'signup'
        ? { username, password, browserKey: getBrowserKey() }
        : { username, password, browserKey: getBrowserKey() };
      const data = await apiJson(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      setUser(data.user);
      if (mode === 'signup') {
        closingAfterSuccess = true;
        err.classList.add('login-success');
        err.textContent = data.alreadyExisted ? 'Profile already exist, Loging in.' : 'Account Created Successfully';
        confirmButton.textContent = data.alreadyExisted ? 'Existing account' : 'Created';
        window.setTimeout(() => {
          modal.remove();
          if (onReady) onReady(getUser());
          else if (intent === 'profile') openProfileModal();
        }, data.alreadyExisted ? 650 : 900);
        return;
      }
      modal.remove();
      onReady?.(getUser());
    } catch (error) {
      err.classList.remove('login-success');
      err.textContent = formatAuthError(error.message || 'Access failed.');
    } finally {
      if (!closingAfterSuccess) {
        confirmButton.disabled = false;
        confirmButton.textContent = mode === 'signup' ? 'Signup' : 'Login';
      }
    }
  };

  confirmButton.addEventListener('click', confirm);
  [usernameInput, passwordInput, confirmPasswordInput].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') confirm();
    });
  });
  setMode(intent === 'login' ? 'login' : 'signup');
}

async function openProfileModal(profileUsername = '') {
  const currentUser = getUser();
  const requestedUsername = normalizeUsernameInput(profileUsername);
  const ownProfile = !requestedUsername || (currentUser && normalizeUsernameInput(currentUser.creatorName) === requestedUsername);

  if (!currentUser && ownProfile) {
    showLoginModal({ intent: 'profile' });
    return;
  }

  document.querySelector('#profileModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'profileModal';
  modal.className = 'profile-modal';
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
  modal.querySelector('.login-close-btn').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });

  try {
    const endpoint = ownProfile ? '/api/profile' : `/api/users/${encodeURIComponent(requestedUsername)}`;
    const data = await apiJson(endpoint);
    if (ownProfile) setUser(data.user);
    renderProfileContent(modal, data, ownProfile);
  } catch (error) {
    const body = modal.querySelector('#profileBody');
    body.innerHTML = `
      <p class="eyebrow">Creator Profile</p>
      <h2 id="profileTitle">Profile unavailable</h2>
      <p class="profile-muted">${escapeHtml(error.message || 'Could not load profile.')}</p>
    `;
  }
}

function renderProfileContent(modal, data, ownProfile) {
  const user = data.user || {};
  const username = user.creatorName || user.username || 'void';
  const counts = data.counts || { total: 0, approved: 0, pending: 0, rejected: 0 };
  const uploads = Array.isArray(data.uploads) ? data.uploads : [];
  const body = modal.querySelector('#profileBody');
  const visibleUploads = ownProfile ? uploads.slice(0, 12) : uploads.filter((item) => item.status === 'approved').slice(0, 12);

  body.className = 'profile-body';
  body.innerHTML = `
    <div class="profile-topline">
      <label class="profile-avatar ${ownProfile ? 'profile-avatar-editable' : ''}" title="${ownProfile ? 'Change profile picture' : `@${escapeHtml(username)}`}">
        ${profileAvatarMarkup(user)}
        ${ownProfile ? '<input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" hidden /><span class="profile-avatar-camera" aria-hidden="true">+</span>' : ''}
      </label>
      <div class="profile-identity">
        <p class="eyebrow">Creator Profile</p>
        <h2 id="profileTitle">@${escapeHtml(username)}</h2>
        <p class="profile-muted profile-joined-date">${formatJoinDate(user.createdAt)}</p>
      </div>
    </div>

    <div id="profileStats" class="profile-stats instagram-stats">
      <span><strong>${counts.approved || 0}</strong>Posts</span>
      <span><strong>${counts.total || 0}</strong>${ownProfile ? 'Uploads' : 'Shared'}</span>
      <span><strong>${counts.pending || 0}</strong>Pending</span>
      <span><strong>${counts.rejected || 0}</strong>Rejected</span>
    </div>

    ${ownProfile ? `
      <div class="profile-action-row">
        <label class="ghost-btn profile-photo-btn" for="avatarInput">Set profile picture</label>
        <p id="avatarStatus" class="status-text profile-white-status">${escapeHtml(data.avatarMessage || '')}</p>
      </div>
    ` : ''}

    <div class="profile-gallery-head">
      <span></span><strong>${ownProfile ? 'Your wallpapers' : 'Wallpaper posts'}</strong><span></span>
    </div>
    <div id="profileUploads" class="profile-post-grid">
      ${visibleUploads.length ? visibleUploads.map((item) => profileUploadCard(item, ownProfile)).join('') : `<p class="profile-muted profile-empty-wide">${ownProfile ? 'No uploads yet.' : 'No approved wallpapers yet.'}</p>`}
    </div>

    ${ownProfile ? `
      <form id="passwordForm" class="password-form instagram-password-form">
        <p class="eyebrow">Security</p>
        <label class="field-label">Current password<input id="currentPassword" type="password" autocomplete="current-password" /></label>
        <label class="field-label">New password<input id="newPassword" type="password" minlength="4" autocomplete="new-password" /></label>
        <button class="primary-btn" type="submit">Change password</button>
        <p id="passwordStatus" class="status-text profile-white-status"></p>
      </form>

      <form id="deleteProfileForm" class="password-form profile-danger-form">
        <p class="eyebrow">Delete profile</p>
        <label class="field-label">Enter password to delete profile<input id="deleteProfilePassword" type="password" autocomplete="current-password" /></label>
        <button id="deleteProfileBtn" class="ghost-btn profile-delete-btn" type="submit">Delete profile</button>
        <p id="deleteProfileStatus" class="status-text profile-white-status"></p>
      </form>
    ` : ''}
  `;

  $$('.profile-post-card[data-preview-id]').forEach((button) => {
    button.addEventListener('click', () => openWallpaperPreview(button.dataset.previewId));
  });

  if (ownProfile) attachOwnProfileActions(modal, data);
}

function profileUploadCard(item, ownProfile) {
  const status = item.status || 'pending';
  const title = item.title || 'Untitled wallpaper';
  const hasPreview = Boolean(item.mediaUrl && status === 'approved');
  return `
    <button class="profile-post-card ${hasPreview ? '' : 'profile-post-placeholder'}" type="button" ${hasPreview ? `data-preview-id="${escapeHtml(item.id)}"` : 'disabled'}>
      ${hasPreview ? `<img src="${escapeHtml(item.mediaUrl)}" alt="${escapeHtml(title)}" loading="lazy" />` : `<span>${escapeHtml(status)}</span>`}
      <small>${escapeHtml(title)}</small>
      ${ownProfile ? `<em>${escapeHtml(status)}</em>` : ''}
    </button>
  `;
}

function attachOwnProfileActions(modal, profileData) {
  const avatarInput = modal.querySelector('#avatarInput');
  const avatarStatus = modal.querySelector('#avatarStatus');
  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      avatarStatus.textContent = 'Use PNG, JPG, or WEBP.';
      avatarInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      avatarStatus.textContent = 'Profile picture must be under 5 MB.';
      avatarInput.value = '';
      return;
    }
    avatarStatus.textContent = 'Uploading profile picture...';
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await apiJson('/api/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });
      setUser(result.user);
      profileData.user = result.user;
      profileData.avatarMessage = result.message || 'Profile picture updated.';
      renderProfileContent(modal, profileData, true);
    } catch (error) {
      avatarStatus.textContent = error.message || 'Could not update profile picture.';
    } finally {
      avatarInput.value = '';
    }
  });

  const form = modal.querySelector('#passwordForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = modal.querySelector('#passwordStatus');
    status.textContent = 'Updating...';
    try {
      const data = await apiJson('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: modal.querySelector('#currentPassword').value,
          newPassword: modal.querySelector('#newPassword').value,
        }),
      });
      status.textContent = data.message || 'Password updated.';
      form.reset();
    } catch (error) {
      status.textContent = error.message || 'Could not update password.';
    }
  });

  const deleteForm = modal.querySelector('#deleteProfileForm');
  deleteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = modal.querySelector('#deleteProfileStatus');
    const button = modal.querySelector('#deleteProfileBtn');
    const passwordInput = modal.querySelector('#deleteProfilePassword');
    const password = passwordInput?.value || '';
    if (!password) {
      status.textContent = 'Enter your password to delete profile.';
      return;
    }
    const confirmed = window.confirm('Delete your profile and all wallpapers uploaded by this account? This cannot be undone.');
    if (!confirmed) return;
    status.textContent = 'Deleting profile...';
    if (button) button.disabled = true;
    try {
      const data = await apiJson('/api/profile/delete', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      clearUser();
      modal.remove();
      await loadWallpapers();
      const uploadStatus = $('#uploadStatus');
      if (uploadStatus) uploadStatus.textContent = data.message || 'Profile deleted.';
    } catch (error) {
      status.textContent = error.message || 'Could not delete profile.';
      if (button) button.disabled = false;
    }
  });
}

async function logoutUser() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  clearUser();
}

function init() {
  setupAccountMenu();
  clearUser();
  hydrateProfile();
  renderPresetCards();
  attachUploadEvents();
  attachPreviewEvents();
  attachModalEvents();
  loadWallpapers();
  syncPreviewControls();
}

function presetIcon(id) {
  if (id === 'lock') {
    return `<svg class="preset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="2"></rect><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"></path></svg>`;
  }
  return `<svg class="preset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2"></path><path d="M5.5 10.5V20h13v-9.5"></path><path d="M9.5 20v-5h5v5"></path></svg>`;
}

function renderPresetCards() {
  $('#presetGrid').innerHTML = layoutPresets.map((preset) => `
    <button class="preset-card ${preset.id === activePreset.id ? 'active' : ''}" data-id="${preset.id}" type="button">
      ${presetIcon(preset.id)}
      <span class="preset-text">
        <strong>${escapeHtml(preset.name)}</strong>
        <small>${escapeHtml(preset.desc)}</small>
      </span>
    </button>
  `).join('');

  $$('.preset-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (!selectedFileDataUrl) {
        $('#uploadStatus').textContent = 'Choose a wallpaper first, then tap a layout preset.';
        return;
      }
      activePreset = layoutPresets.find((preset) => preset.id === card.dataset.id) || layoutPresets[0];
      syncPresetActive();
      $('#labTitle').textContent = activePreset.name;
      $('#previewStage').classList.remove('hidden');
      $('#previewStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
      drawPreview();
    });
  });
}

function syncPresetActive() {
  $$('.preset-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.id === activePreset.id);
  });
}

function attachUploadEvents() {
  const input = $('#wallpaperFile');
  const dropzone = $('#dropzone');

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    requireUser('upload', () => handleFile(file));
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    requireUser('upload', () => handleFile(file));
  });

  $('#uploadForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    requireUser('upload', () => submitWallpaper());
  });
}

function attachPreviewEvents() {
  $('#refreshWallpapers').addEventListener('click', loadWallpapers);

  $('#zoomRange').addEventListener('input', () => {
    previewState.zoom = Number($('#zoomRange').value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $('#offsetXRange').addEventListener('input', () => {
    previewState.offsetX = Number($('#offsetXRange').value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $('#offsetYRange').addEventListener('input', () => {
    previewState.offsetY = Number($('#offsetYRange').value);
    updatePreviewControlLabels();
    drawPreview();
  });
  $('#gridToggle').addEventListener('change', () => {
    previewState.showGrid = $('#gridToggle').checked;
    drawPreview();
  });
  $('#resetPreviewAdjustments').addEventListener('click', () => {
    previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
    syncPreviewControls();
    drawPreview();
  });

  ['zoomRange', 'offsetXRange', 'offsetYRange'].forEach((id) => {
    const slider = $(`#${id}`);
    slider.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
    slider.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });
  });
}

function attachModalEvents() {
  $('#closeWallpaperPreview')?.addEventListener('click', closeWallpaperPreview);
  $$('[data-close-preview]').forEach((item) => item.addEventListener('click', closeWallpaperPreview));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeWallpaperPreview();
  });
}

function syncPreviewControls() {
  const zoomRange = $('#zoomRange');
  const { minZoom, maxZoom } = getZoomBounds(sourceImage, previewDevice.w, previewDevice.h);
  zoomRange.min = String(minZoom);
  zoomRange.max = String(maxZoom);
  previewState.zoom = clamp(previewState.zoom, minZoom, maxZoom);
  zoomRange.value = String(previewState.zoom);
  updateZoomOriginalMarker(minZoom, maxZoom);
  $('#offsetXRange').value = String(previewState.offsetX);
  $('#offsetYRange').value = String(previewState.offsetY);
  $('#gridToggle').checked = previewState.showGrid;
  updatePreviewControlLabels();
}

function updateZoomOriginalMarker(minZoom, maxZoom) {
  const marker = $('#zoomOriginalMarker');
  if (!marker) return;
  const originalFitZoom = 1;
  if (originalFitZoom < minZoom || originalFitZoom > maxZoom || maxZoom <= minZoom) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.left = `${((originalFitZoom - minZoom) / (maxZoom - minZoom)) * 100}%`;
}

function updatePreviewControlLabels() {
  const actualScale = sourceImage ? getEffectiveScale(sourceImage, previewDevice.w, previewDevice.h, previewState.zoom) : previewState.zoom;
  $('#zoomValue').textContent = `${Math.round(actualScale * 100)}%`;
  $('#offsetXValue').textContent = `${Math.round(previewState.offsetX)}`;
  $('#offsetYValue').textContent = `${Math.round(previewState.offsetY)}`;
  const zoomWarning = $('#zoomOutWarning');
  if (zoomWarning) zoomWarning.hidden = !sourceImage || previewState.zoom >= 1;
}

async function handleFile(file) {
  const status = $('#uploadStatus');
  status.textContent = '';
  if (!file) return;
  if (!String(file.type || '').startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif|tiff?|jfif)$/i.test(file.name || '')) {
    status.textContent = 'Please choose an image file from your gallery/media.';
    return;
  }

  status.textContent = 'Loading image...';
  try {
    selectedFileName = file.name;
    clearSelectedObjectUrl();
    const loaded = await decodeImageWithFallback(file);
    selectedFileDataUrl = loaded.previewSrc;
    selectedObjectUrl = loaded.objectUrl || '';
    sourceImage = loaded.image;

    selectedImageMeta = {
      width: sourceImage.naturalWidth,
      height: sourceImage.naturalHeight,
      ratio: sourceImage.naturalWidth / sourceImage.naturalHeight,
      size: file.size,
    };
    $('#selectedInfo').classList.remove('hidden');
    $('#selectedInfo').innerHTML = buildSelectedInfo(file, selectedImageMeta);
    $('#presetArea').classList.remove('hidden');
    $('#submitBtn').disabled = false;
    if (!$('#wallpaperTitle').value.trim()) {
      $('#wallpaperTitle').value = cleanTitleFromFilename(file.name);
    }
    previewState = { zoom: 1, offsetX: 0, offsetY: 0, showGrid: true };
    syncPreviewControls();
    syncPresetActive();
    $('#labTitle').textContent = activePreset.name;
    $('#previewStage').classList.remove('hidden');
    drawPreview();
    status.textContent = '';
  } catch {
    clearSelectedObjectUrl();
    status.textContent = 'Could not load this image format on this browser. Please choose another picture.';
  }
}

function clearSelectedObjectUrl() {
  if (!selectedObjectUrl) return;
  try {
    URL.revokeObjectURL(selectedObjectUrl);
  } catch {}
  selectedObjectUrl = '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('File read failed.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
      } catch {}
      resolve(image);
    };
    image.onerror = () => reject(new Error('Image decode failed.'));
    image.src = src;
  });
}

async function decodeImageWithFallback(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    return { previewSrc: objectUrl, image, objectUrl };
  } catch {
    try { URL.revokeObjectURL(objectUrl); } catch {}
  }

  const primaryDataUrl = await readFileAsDataUrl(file);
  try {
    const image = await loadImageElement(primaryDataUrl);
    return { previewSrc: primaryDataUrl, image, objectUrl: '' };
  } catch {}

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bitmap.width;
      tempCanvas.height = bitmap.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === 'function') bitmap.close();
      const fallbackDataUrl = tempCanvas.toDataURL('image/jpeg', 0.96);
      const image = await loadImageElement(fallbackDataUrl);
      return { previewSrc: fallbackDataUrl, image, objectUrl: '' };
    } catch {}
  }

  throw new Error('Unsupported image format');
}

function buildSelectedInfo(file, meta) {
  const ratio = meta.width / meta.height;
  const is916 = Math.abs(ratio - 9 / 16) < 0.015;
  return `
    <div class="selected-info-card">
      <div class="selected-copy">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${meta.width}×${meta.height} · ${formatBytes(file.size)}</span>
        <span>${is916 ? 'Perfect 9:16 ratio.' : 'Not exactly 9:16. Use Crop / Zoom and the position sliders to fit it.'}</span>
      </div>
      <div class="selected-thumb-frame">
        <img class="selected-thumb" src="${selectedFileDataUrl}" alt="Selected wallpaper preview" />
      </div>
    </div>
  `;
}

function cleanTitleFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .slice(0, 80);
}

function resizeCanvas() {
  canvas.width = previewDevice.w;
  canvas.height = previewDevice.h;
  $('#phoneFrame').style.aspectRatio = `${previewDevice.w} / ${previewDevice.h}`;
}

function drawPreview() {
  resizeCanvas();
  drawPreviewToCanvas(canvas, ctx, sourceImage, activePreset.style, {
    drawGrid: previewState.showGrid,
    adjusted: true,
  });
}

function drawPreviewToCanvas(targetCanvas, targetCtx, image, style, options = {}) {
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.fillStyle = '#050505';
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
  if (style === 'lock') drawSoftDepth(targetCtx, w, h);
  if (options.drawGrid) drawGuideGrid(targetCtx, w, h);

  drawStatusBar(targetCtx, w, h);
  if (style === 'lock') drawClock(targetCtx, w, h, 'stacked');
  if (style === 'home') drawHomeScreen(targetCtx, w, h);
}

function drawEditedWallpaperOnly() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = previewDevice.w;
  exportCanvas.height = previewDevice.h;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.fillStyle = '#050505';
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  if (sourceImage) drawImageAdjustedToContext(exportCtx, sourceImage, exportCanvas.width, exportCanvas.height, previewState);
  return exportCanvas.toDataURL('image/jpeg', 0.92);
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
  targetCtx.drawImage(img, (w - drawWidth) / 2, (h - drawHeight) / 2, drawWidth, drawHeight);
}

function drawGuideGrid(targetCtx, w, h) {
  targetCtx.save();
  targetCtx.strokeStyle = 'rgba(255,255,255,.35)';
  targetCtx.lineWidth = Math.max(2, w * .0024);
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
  targetCtx.strokeStyle = 'rgba(255,255,255,.22)';
  targetCtx.setLineDash([12, 12]);
  targetCtx.strokeRect(w * .06, h * .06, w * .88, h * .88);
  targetCtx.setLineDash([]);
  targetCtx.strokeStyle = 'rgba(255,255,255,.20)';
  targetCtx.beginPath();
  targetCtx.moveTo(w * .5, 0);
  targetCtx.lineTo(w * .5, h);
  targetCtx.stroke();
  targetCtx.beginPath();
  targetCtx.moveTo(0, h * .5);
  targetCtx.lineTo(w, h * .5);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawEmptyCanvas(targetCtx, w, h) {
  const g = targetCtx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#171717');
  g.addColorStop(.5, '#020202');
  g.addColorStop(1, '#111');
  targetCtx.fillStyle = g;
  targetCtx.fillRect(0, 0, w, h);
  targetCtx.strokeStyle = 'rgba(255,255,255,.18)';
  targetCtx.lineWidth = Math.max(2, w * .002);
  for (let x = -w; x < w * 2; x += w * .12) {
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x + h * .42, h);
    targetCtx.stroke();
  }
}

function drawColorToneOverlay(targetCtx, w, h) {
  const vignette = targetCtx.createRadialGradient(w / 2, h * .42, h * .08, w / 2, h * .48, h * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,.42)');
  targetCtx.fillStyle = vignette;
  targetCtx.fillRect(0, 0, w, h);
}

function drawSoftDepth(targetCtx, w, h) {
  const g = targetCtx.createLinearGradient(0, 0, 0, h * .38);
  g.addColorStop(0, 'rgba(0,0,0,.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  targetCtx.fillStyle = g;
  targetCtx.fillRect(0, 0, w, h * .38);
}

function drawStatusBar(targetCtx, w, h) {
  targetCtx.save();
  const s = w / 1080;

  const topFade = targetCtx.createLinearGradient(0, 0, 0, 140 * s);
  topFade.addColorStop(0, 'rgba(0,0,0,.30)');
  topFade.addColorStop(1, 'rgba(0,0,0,0)');
  targetCtx.fillStyle = topFade;
  targetCtx.fillRect(0, 0, w, 144 * s);

  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.textBaseline = 'middle';
  targetCtx.shadowColor = 'rgba(0,0,0,.42)';
  targetCtx.shadowBlur = 8 * s;
  targetCtx.shadowOffsetY = 2 * s;

  const islandW = 176 * s;
  const islandH = 42 * s;
  const islandX = (w - islandW) / 2;
  const islandY = 34 * s;
  roundedRect(targetCtx, islandX, islandY, islandW, islandH, 22 * s, 'rgba(0,0,0,.86)', true);
  roundedRect(targetCtx, islandX + 24 * s, islandY + 7 * s, islandW - 70 * s, 5 * s, 3 * s, 'rgba(255,255,255,.055)', true);

  const baselineY = islandY + islandH / 2 + 2 * s;

  targetCtx.fillStyle = 'rgba(255,255,255,.98)';
  targetCtx.font = `700 ${Math.round(35 * s)}px "SF Pro Text", "Segoe UI", Arial, sans-serif`;
  targetCtx.textAlign = 'left';
  targetCtx.fillText('9:41', 70 * s, baselineY);

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
    roundedRect(targetCtx, barX, y + (20 - height) * s, barW, height * s, 2.3 * s, 'rgba(255,255,255,.96)', true);
  });
}

function drawWifiGlyph(targetCtx, x, y, s) {
  const centerX = x + 17 * s;
  const centerY = y + 16 * s;
  targetCtx.strokeStyle = 'rgba(255,255,255,.96)';
  targetCtx.lineWidth = Math.max(2.4 * s, 1.8);
  [13, 9, 5].forEach((radius) => {
    targetCtx.beginPath();
    targetCtx.arc(centerX, centerY, radius * s, Math.PI * 1.2, Math.PI * 1.8);
    targetCtx.stroke();
  });
  targetCtx.fillStyle = 'rgba(255,255,255,.96)';
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
  roundedRect(targetCtx, x, y, bodyW, bodyH, 7 * s, 'rgba(255,255,255,.95)', false);
  roundedRect(targetCtx, x + bodyW, y + (bodyH - capH) / 2, capW, capH, 2 * s, 'rgba(255,255,255,.95)', true);
  roundedRect(
    targetCtx,
    x + innerPad,
    y + innerPad,
    (bodyW - innerPad * 2) * clamped,
    bodyH - innerPad * 2,
    4 * s,
    'rgba(255,255,255,.95)',
    true
  );
}
function drawClock(targetCtx, w, h, type, subtle = false) {
  targetCtx.save();
  targetCtx.textAlign = 'center';
  targetCtx.fillStyle = subtle ? 'rgba(255,255,255,.36)' : 'rgba(255,255,255,.94)';
  if (type === 'editorial') {
    targetCtx.font = `${Math.round(w * .20)}px Georgia, serif`;
    targetCtx.fillText('09:41', w / 2, h * .21);
    targetCtx.font = `${Math.round(w * .035)}px Arial`;
    targetCtx.fillText('MONDAY · 24 MAY', w / 2, h * .255);
  } else {
    targetCtx.font = `900 ${Math.round(w * .24)}px Arial Black, Arial`;
    targetCtx.fillText('09', w / 2, h * .19);
    targetCtx.fillText('41', w / 2, h * .32);
    targetCtx.font = `700 ${Math.round(w * .035)}px Arial`;
    targetCtx.fillText('MONDAY 24', w / 2, h * .365);
  }
  targetCtx.restore();
}

function drawHomeScreen(targetCtx, w, h) {
  targetCtx.save();

  const glassPanel = (x, y, width, height, radius, alpha = .18) => {
    roundedRect(targetCtx, x, y, width, height, radius, `rgba(255,255,255,${alpha})`, true);
    const g = targetCtx.createLinearGradient(x, y, x + width, y + height);
    g.addColorStop(0, 'rgba(255,255,255,.18)');
    g.addColorStop(.5, 'rgba(255,255,255,.08)');
    g.addColorStop(1, 'rgba(255,255,255,.035)');
    roundedRect(targetCtx, x + 2, y + 2, width - 4, height - 4, Math.max(8, radius - 2), g, true);
  };

  glassPanel(w * .10, h * .135, w * .80, h * .11, w * .04, .14);
  glassPanel(w * .10, h * .27, w * .38, h * .09, w * .033, .115);
  glassPanel(w * .52, h * .27, w * .38, h * .09, w * .033, .105);

  const icon = w * .112;
  const gapX = w * .082;
  const totalWidth = icon * 4 + gapX * 3;
  const startX = (w - totalWidth) / 2;
  const startY = h * .62;
  const gapY = h * .102;

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = startX + col * (icon + gapX);
      const y = startY + row * gapY;
      roundedRect(targetCtx, x, y, icon, icon, w * .028, 'rgba(255,255,255,.22)', true);
      const glass = targetCtx.createLinearGradient(x, y, x + icon, y + icon);
      glass.addColorStop(0, 'rgba(255,255,255,.28)');
      glass.addColorStop(.42, 'rgba(255,255,255,.13)');
      glass.addColorStop(1, 'rgba(255,255,255,.055)');
      roundedRect(targetCtx, x + 2, y + 2, icon - 4, icon - 4, w * .026, glass, true);
      targetCtx.fillStyle = 'rgba(255,255,255,.10)';
      targetCtx.beginPath();
      targetCtx.arc(x + icon * .62, y + icon * .34, icon * .16, 0, Math.PI * 2);
      targetCtx.fill();
    }
  }

  const dockY = h * .875;
  glassPanel(w * .08, dockY, w * .84, h * .074, h * .038, .17);
  const dockIcon = w * .086;
  const dockGap = w * .075;
  const dockTotal = dockIcon * 4 + dockGap * 3;
  const dockStartX = (w - dockTotal) / 2;
  for (let i = 0; i < 4; i += 1) {
    const x = dockStartX + i * (dockIcon + dockGap);
    const y = dockY + h * .012;
    roundedRect(targetCtx, x, y, dockIcon, dockIcon, w * .024, 'rgba(255,255,255,.22)', true);
    const glass = targetCtx.createLinearGradient(x, y, x + dockIcon, y + dockIcon);
    glass.addColorStop(0, 'rgba(255,255,255,.30)');
    glass.addColorStop(.5, 'rgba(255,255,255,.12)');
    glass.addColorStop(1, 'rgba(255,255,255,.05)');
    roundedRect(targetCtx, x + 1.5, y + 1.5, dockIcon - 3, dockIcon - 3, w * .022, glass, true);
  }

  targetCtx.restore();
}

function roundedRect(targetCtx, x, y, width, height, radius, color, fill = true) {
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
  const status = $('#uploadStatus');
  if (!selectedFileDataUrl || !sourceImage) {
    status.textContent = 'Choose a wallpaper first.';
    return;
  }
  const user = getUser();
  if (!user) {
    requireUser('upload', () => submitWallpaper());
    return;
  }
  $('#submitBtn').disabled = true;
  status.textContent = 'Submitting wallpaper....';
  try {
    const title = $('#wallpaperTitle').value.trim() || selectedFileName || 'Untitled wallpaper';
    const creator = user.creatorName || 'The Void';
    $('#creatorName').value = creator;
    const editedDataUrl = drawEditedWallpaperOnly();
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, creator, dataUrl: editedDataUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    status.textContent = 'Submitted. It will appear in Wallpapers after admin approval.';
    $('#wallpaperFile').value = '';
    $('#wallpaperTitle').value = '';
    $('#creatorName').value = getUser()?.creatorName || '';
    selectedFileDataUrl = '';
    selectedFileName = '';
    selectedImageMeta = null;
    sourceImage = null;
    clearSelectedObjectUrl();
    $('#selectedInfo').classList.add('hidden');
    $('#presetArea').classList.add('hidden');
    $('#previewStage').classList.add('hidden');
  } catch (error) {
    status.textContent = error.message;
    $('#submitBtn').disabled = false;
  }
}

async function loadWallpapers() {
  const grid = $('#wallpapersGrid');
  const empty = $('#wallpapersEmpty');
  grid.innerHTML = '';
  empty.classList.add('hidden');
  try {
    const response = await fetch('/api/wallpapers');
    const data = await response.json();
    approvedWallpapers = data.wallpapers || [];
    renderWallpapers();
  } catch {
    empty.classList.remove('hidden');
    empty.textContent = 'Could not load wallpapers. Make sure the server is running.';
  }
}

function renderWallpapers() {
  const grid = $('#wallpapersGrid');
  const empty = $('#wallpapersEmpty');
  if (!grid || !empty) return;
  const rawSearch = String($('#wallpaperSearch')?.value || '').trim();
  const query = rawSearch.startsWith('@') ? '' : rawSearch.toLowerCase();
  const visibleWallpapers = query
    ? approvedWallpapers.filter((item) => `${item.title || ''} ${item.creator || ''}`.toLowerCase().includes(query))
    : approvedWallpapers;

  grid.innerHTML = '';
  empty.classList.add('hidden');
  if (!visibleWallpapers.length) {
    empty.classList.remove('hidden');
    empty.textContent = approvedWallpapers.length ? 'No wallpapers match your search.' : 'No wallpapers yet. New uploads appear here after review.';
    return;
  }

  grid.innerHTML = visibleWallpapers.map((item) => `
    <article class="wallpaper-card">
      <div class="wallpaper-image-wrap">
        <img class="wallpaper-media" src="${item.mediaUrl}" alt="${escapeHtml(item.title)}" loading="lazy" />
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
          <p>by ${escapeHtml(item.creator || 'The Void')}</p>
        </div>
      </div>
    </article>
  `).join('');

  $$('[data-preview-id]').forEach((button) => {
    button.addEventListener('click', () => openWallpaperPreview(button.dataset.previewId));
  });
  $$('[data-download-id]').forEach((button) => {
    button.addEventListener('click', () => {
      requireUser('download', () => startWallpaperDownload(button.dataset.downloadId));
    });
  });
}

function filenameFromDisposition(header, fallback) {
  const match = String(header || '').match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

async function startWallpaperDownload(id) {
  const item = approvedWallpapers.find((wallpaper) => wallpaper.id === id);
  if (!item) return;
  const button = document.querySelector(`[data-download-id="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;
  try {
    const response = await fetch(`/api/download/${encodeURIComponent(id)}`, { headers: creatorHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Login required to download.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    link.href = url;
    link.download = filenameFromDisposition(response.headers.get('Content-Disposition'), `${safeFileName(item.title)}.${ext}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showResponseToast(error.message || 'Could not download wallpaper.');
  } finally {
    if (button) button.disabled = false;
  }
}

function safeFileName(value) {
  return String(value || 'wallpaper').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'wallpaper';
}

function openWallpaperPreview(id) {
  const item = approvedWallpapers.find((wallpaper) => wallpaper.id === id);
  if (!item) return;
  $('#wallpaperPreviewTitle').textContent = item.title;
  $('#wallpaperPreviewCreator').textContent = `by ${item.creator || 'The Void'}`;
  const modal = $('#wallpaperPreviewModal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const image = new Image();
  image.onload = () => {
    const lockCanvas = $('#approvedLockCanvas');
    const homeCanvas = $('#approvedHomeCanvas');
    drawPreviewToCanvas(lockCanvas, lockCanvas.getContext('2d'), image, 'lock', { drawGrid: false, adjusted: false });
    drawPreviewToCanvas(homeCanvas, homeCanvas.getContext('2d'), image, 'home', { drawGrid: false, adjusted: false });
  };
  image.src = item.mediaUrl;
}

function closeWallpaperPreview() {
  const modal = $('#wallpaperPreviewModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}
