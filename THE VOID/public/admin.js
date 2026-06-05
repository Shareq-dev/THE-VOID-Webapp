const $ = (selector) => document.querySelector(selector);
const adminSections = {
  approval: "#approvalSection",
  existing: "#existingWallpapersSection",
  users: "#userIdsSection",
};
function randomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return (
    [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") ||
    `${Date.now()}-${Math.random()}`
  );
}
function getAdminBrowserKey() {
  let key = localStorage.getItem("adminBrowserKey");
  if (!key) {
    key = randomId();
    localStorage.setItem("adminBrowserKey", key);
  }
  return key;
}
function showAdminHome() {
  $("#adminHome")?.classList.remove("hidden");
  Object.values(adminSections).forEach((selector) => {
    $(selector)?.classList.add("hidden");
  });
}
function openAdminSection(sectionName) {
  const target = adminSections[sectionName];
  if (!target) return;
  $("#adminHome")?.classList.add("hidden");
  Object.values(adminSections).forEach((selector) => {
    $(selector)?.classList.add("hidden");
  });
  $(target)?.classList.remove("hidden");
  if (sectionName === "approval")
    loadQueue().catch((error) => showResponseToast(error.message));
  if (sectionName === "existing")
    loadExisting().catch((error) => showResponseToast(error.message));
  if (sectionName === "users")
    loadUsers().catch((error) => showResponseToast(error.message));
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
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
$("#loginBtn").addEventListener("click", login);
$("#adminPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  showLoggedOut();
});
$("#refreshExisting")?.addEventListener("click", () => {
  if (!$("#queuePanel").classList.contains("hidden")) refreshAll();
});
$("#refreshUsers")?.addEventListener("click", () => {
  if (!$("#queuePanel").classList.contains("hidden")) loadUsers();
});
$("#searchUsersBtn")?.addEventListener("click", () => loadUsers());
$("#userSearch")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadUsers();
});
$("#cleanupLocksBtn")?.addEventListener("click", cleanupStaleLocks);
document.querySelectorAll("[data-admin-section]").forEach((card) => {
  card.addEventListener("click", () =>
    openAdminSection(card.dataset.adminSection),
  );
});
document.querySelectorAll("[data-back-home]").forEach((button) => {
  button.addEventListener("click", showAdminHome);
});
function showLoggedOut() {
  $("#queuePanel").classList.add("hidden");
  $("#loginPanel").classList.remove("hidden");
  showAdminHome();
}
function showLoggedIn() {
  $("#loginPanel").classList.add("hidden");
  $("#queuePanel").classList.remove("hidden");
  showAdminHome();
}
async function login() {
  const status = $("#loginStatus");
  status.textContent = "Checking...";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: $("#adminPassword").value,
        browserKey: getAdminBrowserKey(),
      }),
    });
    status.textContent = "";
    showLoggedIn();
    await refreshAll();
  } catch (error) {
    status.textContent = error.message;
  }
}
async function refreshAll() {
  try {
    await Promise.all([loadQueue(), loadExisting(), loadUsers()]);
  } catch (error) {
    showLoggedOut();
    $("#loginStatus").textContent = error.message;
  }
}
async function loadQueue() {
  const grid = $("#queueGrid");
  const empty = $("#queueEmpty");
  grid.innerHTML = "";
  empty.classList.add("hidden");
  const data = await api("/api/admin/pending");
  if (!data.pending.length) {
    empty.classList.remove("hidden");
    return;
  }
  grid.innerHTML = data.pending
    .map(
      (item) => `
    <article class="queue-item" data-queue-id="${item.id}">
      <a class="queue-image-link" href="${item.mediaUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open full size wallpaper ${escapeHtml(item.title)}"><img class="queue-image" src="${item.mediaUrl}" alt="${escapeHtml(item.title)}" /></a>
      <div class="queue-body">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="status-text">by ${escapeHtml(item.creator || "The Void")} - Submitted ${new Date(item.createdAt).toLocaleString()}</p>
        </div>

        <div class="admin-edit-grid">
          <label class="field-label admin-edit-label">
            Username / Creator
            <input class="admin-edit-input" data-edit="creator" data-id="${item.id}" type="text" maxlength="60" value="${escapeAttr(item.creator || "The Void")}" placeholder="e.g. Shareq" />
          </label>
          <label class="field-label admin-edit-label">
            Wallpaper name
            <input class="admin-edit-input" data-edit="title" data-id="${item.id}" type="text" maxlength="80" value="${escapeAttr(item.title)}" placeholder="e.g. Black Moon" />
          </label>
        </div>

        <div class="queue-actions">
          <button class="save-details-btn" data-action="save" data-id="${item.id}">Save details</button>
          <a class="ghost-btn admin-action-link" href="${item.mediaUrl}" download>Download</a>
          <button class="primary-btn" data-action="approve" data-id="${item.id}">Approve</button>
          <button class="reject-btn" data-action="reject" data-id="${item.id}">Reject</button>
        </div>
      </div>
    </article>
  `,
    )
    .join("");
  grid.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.action === "save") {
          await saveWallpaperDetails(button.dataset.id);
          button.textContent = "Saved";
          setTimeout(() => {
            button.textContent = "Save details";
            button.disabled = false;
          }, 900);
          return;
        }
        if (button.dataset.action === "approve") {
          await saveWallpaperDetails(button.dataset.id);
        }
        await api(
          `/api/admin/wallpapers/${button.dataset.id}/${button.dataset.action}`,
          { method: "POST" },
        );
        await refreshAll();
      } catch (error) {
        showResponseToast(error.message);
        button.disabled = false;
      }
    });
  });
}
async function loadExisting() {
  const grid = $("#existingGrid");
  const empty = $("#existingEmpty");
  grid.innerHTML = "";
  empty.classList.add("hidden");
  const data = await api("/api/wallpapers");
  const wallpapers = Array.isArray(data.wallpapers) ? data.wallpapers : [];
  if (!wallpapers.length) {
    empty.classList.remove("hidden");
    return;
  }
  grid.innerHTML = wallpapers
    .map(
      (item) => `
    <article class="queue-item" data-existing-id="${item.id}">
      <a class="queue-image-link" href="${item.mediaUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open full size wallpaper ${escapeHtml(item.title)}"><img class="queue-image" src="${item.mediaUrl}" alt="${escapeHtml(item.title)}" /></a>
      <div class="queue-body">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="status-text">by ${escapeHtml(item.creator || "The Void")}</p>
        </div>
        <div class="admin-edit-grid">
          <label class="field-label admin-edit-label">
            Username / Creator
            <input class="admin-edit-input" data-edit="creator" data-id="${item.id}" type="text" maxlength="60" value="${escapeAttr(item.creator || "The Void")}" placeholder="e.g. Shareq" />
          </label>
          <label class="field-label admin-edit-label">
            Wallpaper name
            <input class="admin-edit-input" data-edit="title" data-id="${item.id}" type="text" maxlength="80" value="${escapeAttr(item.title)}" placeholder="e.g. Black Moon" />
          </label>
        </div>
        <div class="existing-actions">
          <button class="save-details-btn" data-action="save-existing" data-id="${item.id}">Save details</button>
          <a class="ghost-btn admin-action-link" href="${item.mediaUrl}" download>Download</a>
          <button class="reject-btn" data-action="delete-existing" data-id="${item.id}">Delete</button>
        </div>
      </div>
    </article>
  `,
    )
    .join("");
  grid
    .querySelectorAll('button[data-action="save-existing"]')
    .forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await saveWallpaperDetails(button.dataset.id);
          button.textContent = "Saved";
          setTimeout(() => {
            button.textContent = "Save details";
            button.disabled = false;
          }, 900);
        } catch (error) {
          showResponseToast(error.message);
          button.disabled = false;
        }
      });
    });
  grid
    .querySelectorAll('button[data-action="delete-existing"]')
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const ok = confirm(
          "Delete this wallpaper from the app? It will be counted as Rejected on the creator profile.",
        );
        if (!ok) return;
        button.disabled = true;
        try {
          await api(`/api/admin/wallpapers/${button.dataset.id}/delete`, {
            method: "POST",
          });
          await refreshAll();
        } catch (error) {
          showResponseToast(error.message);
          button.disabled = false;
        }
      });
    });
}
async function loadUsers() {
  const grid = $("#userGrid");
  const empty = $("#userEmpty");
  const status = $("#userStatus");
  if (!grid || !empty) return;
  grid.innerHTML = "";
  empty.classList.add("hidden");
  if (status) status.textContent = "";
  const query = $("#userSearch")?.value.trim() || "";
  const data = await api(
    `/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  );
  const users = Array.isArray(data.users) ? data.users : [];
  if (!users.length) {
    empty.classList.remove("hidden");
    return;
  }
  grid.innerHTML = users
    .map(
      (user) => `
    <article class="queue-item admin-user-item" data-user-id="${escapeAttr(user.creatorId)}">
      <div class="admin-user-avatar">${user.profilePicUrl ? `<img src="${escapeAttr(user.profilePicUrl)}" alt="@${escapeAttr(user.username)} profile picture" />` : `<span>@</span>`}</div>
      <div class="queue-body">
        <div>
          <h3>@${escapeHtml(user.username || "unknown")}</h3>
          <p class="status-text">Created ${user.createdAt ? new Date(user.createdAt).toLocaleString() : "unknown"}${user.lastLoginAt ? ` - Last login ${new Date(user.lastLoginAt).toLocaleString()}` : ""}</p>
          <p class="status-text">Wallpapers: ${Number(user.wallpaperCount || 0)} total - ${Number(user.approvedCount || 0)} approved - ${Number(user.pendingCount || 0)} pending - ${Number(user.rejectedCount || 0)} rejected</p>
          <p class="status-text">Upload limit: ${escapeHtml(user.uploadLimitText || (user.unlimitedUploads ? "Unlimited uploads" : "4 uploads / 24h"))}</p>
          <p class="status-text">Signup lock: ${user.hasSignupIpLock || user.hasBrowserLock ? "active for this profile" : "none stored"}</p>
        </div>
        <div class="existing-actions admin-user-actions">
          <button class="${user.unlimitedUploads ? "ghost-btn" : "primary-btn"}" data-action="toggle-upload-limit" data-id="${escapeAttr(user.creatorId)}" data-username="${escapeAttr(user.username || "")}" data-unlimited="${user.unlimitedUploads ? "true" : "false"}">${user.unlimitedUploads ? "Use normal upload limit" : "Remove upload limit"}</button>
          <button class="reject-btn" data-action="delete-user" data-id="${escapeAttr(user.creatorId)}" data-username="${escapeAttr(user.username || "")}">Delete ID completely</button>
        </div>
      </div>
    </article>
  `,
    )
    .join("");
  grid
    .querySelectorAll('button[data-action="toggle-upload-limit"]')
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const username = button.dataset.username || "this user";
        const makeUnlimited = button.dataset.unlimited !== "true";
        const ok = confirm(
          makeUnlimited
            ? `Remove the 24-hour upload limit for @${username}?`
            : `Put @${username} back on the normal upload limit?`,
        );
        if (!ok) return;
        button.disabled = true;
        try {
          const result = await api(
            `/api/admin/users/${encodeURIComponent(button.dataset.id)}/upload-limit`,
            {
              method: "POST",
              body: JSON.stringify({ unlimited: makeUnlimited }),
            },
          );
          showResponseToast(result.message || "Upload limit updated.");
          await loadUsers();
        } catch (error) {
          showResponseToast(error.message);
          button.disabled = false;
        }
      });
    });
  grid
    .querySelectorAll('button[data-action="delete-user"]')
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const username = button.dataset.username || "this user";
        const ok = confirm(
          `Delete @${username} completely? This removes the profile, all their wallpapers, profile picture, active login lock, and this profile's IP/browser signup lock. This cannot be undone.`,
        );
        if (!ok) return;
        button.disabled = true;
        try {
          const result = await api(
            `/api/admin/users/${encodeURIComponent(button.dataset.id)}/delete`,
            { method: "POST" },
          );
          showResponseToast(result.message || `Deleted @${username}.`);
          await Promise.all([loadUsers(), loadExisting(), loadQueue()]);
        } catch (error) {
          showResponseToast(error.message);
          button.disabled = false;
        }
      });
    });
}
async function cleanupStaleLocks() {
  const button = $("#cleanupLocksBtn");
  const status = $("#userStatus");
  const ok = confirm(
    "Clean only stale/orphaned locks? Active users will keep their IP/device locks.",
  );
  if (!ok) return;
  if (button) button.disabled = true;
  if (status) status.textContent = "Cleaning stale locks...";
  try {
    const result = await api("/api/admin/users/cleanup-stale-locks", {
      method: "POST",
    });
    if (status)
      status.textContent = `${result.message || "Cleaned stale locks."} Malformed signup rows cleared: ${result.clearedMalformedSignupRows || 0}. Orphaned active sessions cleared: ${result.clearedOrphanedActiveSessions || 0}.`;
    await loadUsers();
  } catch (error) {
    if (status) status.textContent = error.message;
    else showResponseToast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}
async function saveWallpaperDetails(id) {
  const titleInput = document.querySelector(
    `[data-edit="title"][data-id="${id}"]`,
  );
  const creatorInput = document.querySelector(
    `[data-edit="creator"][data-id="${id}"]`,
  );
  const title = titleInput?.value.trim() || "";
  const creator = creatorInput?.value.trim() || "";
  if (!title) throw new Error("Wallpaper name is required.");
  if (!creator) throw new Error("Username is required.");
  return api(`/api/admin/wallpapers/${id}/update`, {
    method: "POST",
    body: JSON.stringify({ title, creator }),
  });
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
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

(async () => {
  try {
    await loadQueue();
    showLoggedIn();
    await Promise.all([loadExisting(), loadUsers()]);
  } catch {
    showLoggedOut();
  }
})();
