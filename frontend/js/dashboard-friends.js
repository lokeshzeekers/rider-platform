let searchDebounce = null;
document.getElementById('friend-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  searchDebounce = setTimeout(() => runFriendSearch(q), 300);
});

async function runFriendSearch(q) {
  const el = document.getElementById('friend-search-results');
  if (!q) {
    el.innerHTML = '';
    return;
  }
  try {
    const data = await Api.get(`/users/search?q=${encodeURIComponent(q)}`);
    el.innerHTML =
      data.results.length === 0
        ? '<div class="empty-state">No riders found in your organization.</div>'
        : data.results
            .map(
              (u) => `
      <div class="row">
        ${avatarHtml(u)}
        <div>
          <div class="row-title">${escapeHtml(u.name)}</div>
          <div class="row-sub">@${escapeHtml(u.username)}</div>
        </div>
        <div class="row-actions">
          ${u.is_friend ? '<span class="tag completed">Friends</span>' : `<button class="btn small primary" data-add-friend="${u.id}">Add friend</button>`}
        </div>
      </div>`
            )
            .join('');
  } catch (err) {
    el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

document.getElementById('friend-search-results').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-add-friend]');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await Api.post('/friends/requests', { receiver_id: btn.dataset.addFriend });
    btn.textContent = 'Request sent';
  } catch (err) {
    btn.textContent = err.message;
    btn.disabled = false;
  }
});

async function loadFriends() {
  const el = document.getElementById('friends-list');
  try {
    const data = await Api.get('/friends');
    el.innerHTML =
      data.friends.length === 0
        ? '<div class="empty-state">No friends yet — search above to connect.</div>'
        : data.friends
            .map(
              (f) => `
      <div class="row">
        ${avatarHtml(f)}
        <div>
          <div class="row-title">${escapeHtml(f.name)}</div>
          <div class="row-sub">@${escapeHtml(f.username)} · <span class="mono">${escapeHtml(f.phone || '')}</span></div>
        </div>
        <div class="row-actions">
          <button class="btn small" data-open-chat="${f.id}" data-name="${escapeHtml(f.name)}">Message</button>
          <button class="btn small danger" data-remove-friend="${f.id}">Remove</button>
        </div>
      </div>`
            )
            .join('');
  } catch (err) {
    el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

document.getElementById('friends-list').addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('[data-remove-friend]');
  const chatBtn = e.target.closest('[data-open-chat]');
  if (removeBtn) {
    if (!confirm('Remove this friend?')) return;
    await Api.delete(`/friends/${removeBtn.dataset.removeFriend}`);
    loadFriends();
  }
  if (chatBtn) {
    showSection('chats');
    openChatWith(chatBtn.dataset.openChat, chatBtn.dataset.name);
  }
});

async function loadRequests() {
  try {
    const data = await Api.get('/friends/requests');
    const inEl = document.getElementById('incoming-requests');
    const outEl = document.getElementById('outgoing-requests');

    inEl.innerHTML =
      data.incoming.length === 0
        ? '<div class="empty-state">Nothing pending.</div>'
        : data.incoming
            .map(
              (r) => `
      <div class="row">
        ${avatarHtml(r)}
        <div><div class="row-title">${escapeHtml(r.name)}</div><div class="row-sub">@${escapeHtml(r.username)}</div></div>
        <div class="row-actions">
          <button class="btn small primary" data-respond="${r.id}" data-action="accept">Accept</button>
          <button class="btn small danger" data-respond="${r.id}" data-action="reject">Decline</button>
        </div>
      </div>`
            )
            .join('');

    outEl.innerHTML =
      data.outgoing.length === 0
        ? '<div class="empty-state">Nothing sent.</div>'
        : data.outgoing
            .map(
              (r) => `
      <div class="row">
        ${avatarHtml(r)}
        <div><div class="row-title">${escapeHtml(r.name)}</div><div class="row-sub">@${escapeHtml(r.username)}</div></div>
        <div class="row-actions"><span class="tag upcoming">Pending</span></div>
      </div>`
            )
            .join('');

    refreshRequestsBadge();
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('incoming-requests').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-respond]');
  if (!btn) return;
  btn.closest('.row').style.opacity = '0.5';
  try {
    await Api.post(`/friends/requests/${btn.dataset.respond}/respond`, { action: btn.dataset.action });
    loadRequests();
  } catch (err) {
    alert(err.message);
  }
});
