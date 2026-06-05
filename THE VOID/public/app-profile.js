function renderProfileContent(modal, data, ownProfile) {
  const user = data.user || {};
  const username = user.creatorName || user.username || "void";
  const counts = data.counts || {
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
  };
  const uploads = Array.isArray(data.uploads) ? data.uploads : [];
  const body = modal.querySelector("#profileBody");
  const editingUploads = Boolean(data.editingUploads);
  const visibleUploads = ownProfile
    ? uploads.slice(0, 12)
    : uploads.filter((item) => item.status === "approved").slice(0, 12);
  body.className = "profile-body";
  body.innerHTML = `
    <div class="profile-topline">
      <label class="profile-avatar ${ownProfile ? "profile-avatar-editable" : ""}" title="${ownProfile ? "Change profile picture" : `@${escapeHtml(username)}`}">
        ${profileAvatarMarkup(user)}
        ${ownProfile ? '<input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" hidden /><span class="profile-avatar-camera" aria-hidden="true">+</span>' : ""}
      </label>
      <div class="profile-identity">
        <p class="eyebrow">Creator Profile</p>
        <h2 id="profileTitle">@${escapeHtml(username)}</h2>
        <p class="profile-muted profile-joined-date">${formatJoinDate(user.createdAt)}</p>
      </div>
    </div>

    <div id="profileStats" class="profile-stats instagram-stats">
      <span><strong>${counts.approved || 0}</strong>Posts</span>
      <span><strong>${counts.total || 0}</strong>${ownProfile ? "Uploads" : "Shared"}</span>
      <span><strong>${counts.pending || 0}</strong>Pending</span>
      <span><strong>${counts.rejected || 0}</strong>Rejected</span>
    </div>

    ${ownProfile ? `<div class="profile-action-row"><button id="profileEditToggle" class="ghost-btn profile-edit-btn" type="button">${editingUploads ? "Done" : "Edit uploads"}</button><p id="avatarStatus" class="status-text profile-white-status">${escapeHtml(data.avatarMessage || "")}</p></div>` : ""}

    <div class="profile-gallery-head">
      <span></span><strong>${ownProfile ? "Your wallpapers" : "Wallpaper posts"}</strong><span></span>
    </div>
    <div id="profileUploads" class="profile-post-grid">
      ${visibleUploads.length ? visibleUploads.map((item) => profileUploadCard(item, ownProfile, editingUploads)).join("") : `<p class="profile-muted profile-empty-wide">${ownProfile ? "No uploads yet." : "No approved wallpapers yet."}</p>`}
    </div>

    ${ownProfile ? `<form id="passwordForm" class="password-form instagram-password-form"><p class="eyebrow">Security</p><label class="field-label">Current password<input id="currentPassword" type="password" autocomplete="current-password" /></label><label class="field-label">New password<input id="newPassword" type="password" minlength="4" autocomplete="new-password" /></label><button class="primary-btn" type="submit">Change password</button><p id="passwordStatus" class="status-text profile-white-status"></p></form><form id="deleteProfileForm" class="password-form profile-danger-form"><p class="eyebrow">Delete profile</p><label class="field-label">Enter password to delete profile<input id="deleteProfilePassword" type="password" autocomplete="current-password" /></label><button id="deleteProfileBtn" class="ghost-btn profile-delete-btn" type="submit">Delete profile</button><p id="deleteProfileStatus" class="status-text profile-white-status"></p></form>` : ""}
  `;
  $$(".profile-post-card[data-preview-id]").forEach((button) => {
    button.addEventListener("click", () =>
      openWallpaperPreview(button.dataset.previewId),
    );
  });
  if (ownProfile) attachOwnProfileActions(modal, data);
}
function profileUploadCard(item, ownProfile, editingUploads = false) {
  const status = item.status || "pending";
  const title = item.title || "Untitled wallpaper";
  const cardImageUrl = item.thumbUrl || item.mediaUrl;
  const hasPreview = Boolean(item.mediaUrl && status === "approved");
  if (ownProfile && editingUploads) {
    const previewMarkup = hasPreview
      ? `<img src="${escapeHtml(cardImageUrl)}" data-full-src="${escapeHtml(item.mediaUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />`
      : `<span>${escapeHtml(status)}</span>`;
    return `
      <article class="profile-post-card profile-post-edit-card ${hasPreview ? "" : "profile-post-edit-placeholder"}" data-edit-wallpaper-id="${escapeHtml(item.id)}">
        ${previewMarkup}
        <em>${escapeHtml(status)}</em>
        <div class="profile-post-edit-panel">
          <label class="field-label">Wallpaper name<input data-wallpaper-title-input type="text" maxlength="80" value="${escapeHtml(title)}" /></label>
          <button class="primary-btn" type="button" data-save-wallpaper-title>Save</button>
          <button class="ghost-btn profile-delete-btn" type="button" data-delete-wallpaper>Delete</button>
          <p class="status-text profile-white-status" data-wallpaper-edit-status></p>
        </div>
      </article>
    `;
  }
  return `
    <button class="profile-post-card ${hasPreview ? "" : "profile-post-placeholder"}" type="button" ${hasPreview ? `data-preview-id="${escapeHtml(item.id)}"` : "disabled"}>
      ${hasPreview ? `<img src="${escapeHtml(cardImageUrl)}" data-full-src="${escapeHtml(item.mediaUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />` : `<span>${escapeHtml(status)}</span>`}
      <small>${escapeHtml(title)}</small>
      ${ownProfile ? `<em>${escapeHtml(status)}</em>` : ""}
    </button>
  `;
}
function recountUploads(uploads) {
  return uploads.reduce(
    (counts, item) => {
      const status = item.status || "pending";
      counts.total += 1;
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    },
    { total: 0, approved: 0, pending: 0, rejected: 0 },
  );
}
function attachOwnProfileActions(modal, profileData) {
  const avatarInput = modal.querySelector("#avatarInput");
  const avatarStatus = modal.querySelector("#avatarStatus");
  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      avatarStatus.textContent = "Use PNG, JPG, or WEBP.";
      avatarInput.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      avatarStatus.textContent = "Profile picture must be under 5 MB.";
      avatarInput.value = "";
      return;
    }
    avatarStatus.textContent = "Uploading profile picture...";
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await apiJson("/api/profile/avatar", {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      setUser(result.user);
      profileData.user = result.user;
      profileData.avatarMessage = result.message || "Profile picture updated.";
      renderProfileContent(modal, profileData, true);
    } catch (error) {
      avatarStatus.textContent =
        error.message || "Could not update profile picture.";
    } finally {
      avatarInput.value = "";
    }
  });
  modal.querySelector("#profileEditToggle")?.addEventListener("click", () => {
    profileData.editingUploads = !profileData.editingUploads;
    renderProfileContent(modal, profileData, true);
  });
  modal.querySelectorAll("[data-edit-wallpaper-id]").forEach((card) => {
    const id = card.dataset.editWallpaperId;
    const status = card.querySelector("[data-wallpaper-edit-status]");
    const titleInput = card.querySelector("[data-wallpaper-title-input]");
    const saveButton = card.querySelector("[data-save-wallpaper-title]");
    const deleteButton = card.querySelector("[data-delete-wallpaper]");
    saveButton?.addEventListener("click", async () => {
      const title = String(titleInput?.value || "").trim();
      if (!title) {
        status.textContent = "Wallpaper name is required.";
        return;
      }
      saveButton.disabled = true;
      status.textContent = "Saving...";
      try {
        const result = await apiJson(
          `/api/profile/wallpapers/${encodeURIComponent(id)}/update`,
          { method: "POST", body: JSON.stringify({ title }) },
        );
        const upload = profileData.uploads.find((item) => item.id === id);
        if (upload) upload.title = result.wallpaper?.title || title;
        status.textContent = result.message || "Wallpaper updated.";
        await loadWallpapers();
      } catch (error) {
        status.textContent = error.message || "Could not update wallpaper.";
      } finally {
        saveButton.disabled = false;
      }
    });
    deleteButton?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Delete this uploaded wallpaper from your profile? This cannot be undone.",
      );
      if (!confirmed) return;
      deleteButton.disabled = true;
      status.textContent = "Deleting...";
      try {
        const result = await apiJson(
          `/api/profile/wallpapers/${encodeURIComponent(id)}/delete`,
          { method: "POST" },
        );
        profileData.uploads = profileData.uploads.filter(
          (item) => item.id !== id,
        );
        profileData.counts = recountUploads(profileData.uploads);
        profileData.avatarMessage = result.message || "Wallpaper deleted.";
        await loadWallpapers();
        renderProfileContent(modal, profileData, true);
      } catch (error) {
        status.textContent = error.message || "Could not delete wallpaper.";
        deleteButton.disabled = false;
      }
    });
  });
  const form = modal.querySelector("#passwordForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = modal.querySelector("#passwordStatus");
    status.textContent = "Updating...";
    try {
      const data = await apiJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: modal.querySelector("#currentPassword").value,
          newPassword: modal.querySelector("#newPassword").value,
        }),
      });
      status.textContent = data.message || "Password updated.";
      form.reset();
    } catch (error) {
      status.textContent = error.message || "Could not update password.";
    }
  });
  const deleteForm = modal.querySelector("#deleteProfileForm");
  deleteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = modal.querySelector("#deleteProfileStatus");
    const button = modal.querySelector("#deleteProfileBtn");
    const passwordInput = modal.querySelector("#deleteProfilePassword");
    const password = passwordInput?.value || "";
    if (!password) {
      status.textContent = "Enter your password to delete profile.";
      return;
    }
    const confirmed = window.confirm(
      "Delete your profile and all wallpapers uploaded by this account? This cannot be undone.",
    );
    if (!confirmed) return;
    status.textContent = "Deleting profile...";
    if (button) button.disabled = true;
    try {
      const data = await apiJson("/api/profile/delete", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      clearUser();
      removeModal(modal);
      await loadWallpapers();
      const uploadStatus = $("#uploadStatus");
      if (uploadStatus)
        uploadStatus.textContent = data.message || "Profile deleted.";
    } catch (error) {
      status.textContent = error.message || "Could not delete profile.";
      if (button) button.disabled = false;
    }
  });
}
async function logoutUser() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
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
  if (typeof setupHeroPerformanceGuard === "function")
    setupHeroPerformanceGuard();
  loadWallpapers();
  syncPreviewControls();
}
