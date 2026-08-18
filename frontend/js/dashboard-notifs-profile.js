async function loadNotifications() {
  const el = document.getElementById('notifications-list');
  try {
    const data = await Api.get('/notifications');
    el.innerHTML =
      data.notifications.length === 0
        ? '<div class="empty-state">Nothing yet.</div>'
        : data.notifications
            .map(
              (n) => `
      <div class="row">
        <span class="pulse-dot ${n.read ? 'offline' : ''}" style="width:7px;height:7px;"></span>
        <div>
          <div class="row-title" style="font-weight:${n.read ? '400' : '600'};">${escapeHtml(n.content)}</div>
          <div class="row-sub mono">${timeAgo(n.created_at)}</div>
        </div>
      </div>`
            )
            .join('');
    refreshNotifBadge();
  } catch (err) {
    el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

document.getElementById('mark-all-read').addEventListener('click', async () => {
  await Api.post('/notifications/read-all');
  loadNotifications();
});

// ===== Profile =====
async function loadProfile() {
  try {
    const data = await Api.get('/auth/me');
    document.getElementById('profile-name').value = data.user.name;
    document.getElementById('profile-bio').value = data.user.bio || '';
    document.getElementById('profile-username').value = data.user.username;
    document.getElementById('profile-email').value = data.user.email;
    document.getElementById('profile-phone').value = data.user.phone;
    renderProfilePic(data.user);
  } catch (err) {
    console.error(err);
  }
}

function renderProfilePic(user) {
  const img = document.getElementById('profile-pic-preview');
  const fallback = document.getElementById('profile-pic-fallback');
  if (user.profile_pic_url) {
    img.src = `${window.APP_CONFIG.API_BASE}${user.profile_pic_url.replace('/api', '')}?token=${encodeURIComponent(Api.accessToken())}&_=${Date.now()}`;
    img.style.display = '';
    fallback.style.display = 'none';
  } else {
    img.style.display = 'none';
    fallback.style.display = '';
    fallback.textContent = initials(user.name);
  }
}

document.getElementById('profile-pic-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert('Image must be under 5MB.');
    e.target.value = '';
    return;
  }
  const formData = new FormData();
  formData.append('photo', file);
  try {
    const data = await Api.postForm('/users/me/profile-pic', formData);
    ME.profile_pic_url = data.profile_pic_url;
    Api.setUser(ME);
    renderProfilePic(ME);
  } catch (err) {
    alert(err.message);
  } finally {
    e.target.value = '';
  }
});

document.getElementById('profile-save').addEventListener('click', async () => {
  const saved = document.getElementById('profile-saved');
  try {
    const data = await Api.patch('/users/me/update', {
      name: document.getElementById('profile-name').value.trim(),
      bio: document.getElementById('profile-bio').value.trim()
    });
    ME = { ...ME, ...data.user };
    Api.setUser(ME);
    document.getElementById('ov-name').textContent = ME.name;
    saved.classList.remove('hidden');
    setTimeout(() => saved.classList.add('hidden'), 2000);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('logout-all-btn').addEventListener('click', async () => {
  if (!confirm('Log out on all devices? You will need to log in again here too.')) return;
  try {
    await Api.post('/auth/logout-all');
  } catch {}
  Api.clearTokens();
  window.location.href = 'index.html';
});
