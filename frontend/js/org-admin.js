if (!Api.accessToken()) window.location.href = 'index.html';
const ME_ADMIN = Api.getUser();
if (!ME_ADMIN || (ME_ADMIN.role !== 'org_admin' && ME_ADMIN.role !== 'super_admin')) {
  alert('Organization admin access required.');
  window.location.href = 'dashboard.html';
}
document.getElementById('org-admin-badge').textContent = `Org: ${Api.getOrgCode()}`;

document.getElementById('back-to-app').addEventListener('click', () => (window.location.href = 'dashboard.html'));
document.getElementById('admin-logout').addEventListener('click', async () => {
  try { await Api.post('/auth/logout', { refresh_token: Api.refreshToken() }); } catch {}
  Api.clearTokens();
  window.location.href = 'index.html';
});

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const asections = ['summary', 'users', 'trips', 'riders'];
function showASection(name) {
  asections.forEach((s) => document.getElementById(`asection-${s}`).classList.toggle('hidden', s !== name));
  document.querySelectorAll('.nav-item[data-asection]').forEach((b) => b.classList.toggle('active', b.dataset.asection === name));
  document.getElementById('asection-heading').textContent = name.charAt(0).toUpperCase() + name.slice(1);
  if (name === 'summary') loadSummary();
  if (name === 'users') loadUsers();
  if (name === 'trips') loadAdminTrips();
  if (name === 'riders') loadActiveRiders();
}
document.querySelectorAll('.nav-item[data-asection]').forEach((b) => b.addEventListener('click', () => showASection(b.dataset.asection)));

async function loadSummary() {
  const d = await Api.get('/org-admin/summary');
  document.getElementById('s-total-users').textContent = d.totalUsers;
  document.getElementById('s-active-users').textContent = d.activeUsers;
  document.getElementById('s-disabled-users').textContent = d.disabledUsers;
  document.getElementById('s-live-riders').textContent = d.liveRiders;
  document.getElementById('s-active-trips').textContent = d.activeTrips;
  document.getElementById('s-completed-trips').textContent = d.completedTrips;
}

let userSearchDebounce = null;
document.getElementById('user-search').addEventListener('input', (e) => {
  clearTimeout(userSearchDebounce);
  userSearchDebounce = setTimeout(() => loadUsers(e.target.value.trim()), 300);
});

async function loadUsers(q = '') {
  const el = document.getElementById('users-list');
  const d = await Api.get(`/org-admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  el.innerHTML =
    d.users.length === 0
      ? '<div class="empty-state">No users found.</div>'
      : d.users
          .map(
            (u) => `
    <div class="card" style="margin-bottom:8px;">
      <div class="row">
        <div class="avatar">${esc((u.name || '?')[0])}</div>
        <div>
          <div class="row-title">${esc(u.name)} ${u.role === 'org_admin' ? '<span class="tag active">Org Admin</span>' : ''} <span class="tag ${u.status === 'active' ? 'completed' : 'cancelled'}">${u.status}</span></div>
          <div class="row-sub">@${esc(u.username)} · ${esc(u.email)} · <span class="mono">${esc(u.phone)}</span></div>
        </div>
      </div>
      <div class="route-divider"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${u.status === 'active' ? `<button class="btn small danger" data-disable="${u.id}">Disable account</button>` : `<button class="btn small primary" data-enable="${u.id}">Enable account</button>`}
        <button class="btn small ghost" data-reset-pass="${u.id}">Reset password</button>
        <button class="btn small ghost" data-change-username="${u.id}" data-current="${esc(u.username)}">Change username</button>
        <button class="btn small danger" data-delete-user="${u.id}">Delete account</button>
      </div>
    </div>`
          )
          .join('');
}

document.getElementById('users-list').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.disable) await Api.post(`/org-admin/users/${t.dataset.disable}/disable`);
    else if (t.dataset.enable) await Api.post(`/org-admin/users/${t.dataset.enable}/enable`);
    else if (t.dataset.resetPass) {
      const pw = prompt('Enter a new password for this user (min 8 characters). Relay it to them directly -- it is never sent by SMS or email:');
      if (!pw) return;
      await Api.post(`/org-admin/users/${t.dataset.resetPass}/reset-password`, { new_password: pw });
      alert('Password reset. Relay it to the rider directly.');
      return;
    } else if (t.dataset.changeUsername) {
      const nu = prompt(`New username for @${t.dataset.current}:`, t.dataset.current);
      if (!nu || nu === t.dataset.current) return;
      await Api.post(`/org-admin/users/${t.dataset.changeUsername}/change-username`, { new_username: nu });
    } else if (t.dataset.deleteUser) {
      if (!confirm('Permanently delete this account? This cannot be undone.')) return;
      await Api.delete(`/org-admin/users/${t.dataset.deleteUser}`);
    } else return;
    loadUsers(document.getElementById('user-search').value.trim());
  } catch (err) {
    alert(err.message);
  }
});

async function loadAdminTrips() {
  const el = document.getElementById('trips-list');
  const d = await Api.get('/org-admin/trips');
  el.innerHTML =
    d.trips.length === 0
      ? '<div class="empty-state">No trips yet.</div>'
      : d.trips
          .map(
            (t) => `
    <div class="card" style="margin-bottom:8px;">
      <div class="topbar" style="margin-bottom:4px;">
        <div class="row-title">${esc(t.name)}</div>
        <span class="tag ${t.status}">${t.status}</span>
      </div>
      <div class="row-sub">${esc(t.start_point)} → ${esc(t.destination)} · <span class="mono">${String(t.trip_date).slice(0, 10)} ${t.trip_time}</span></div>
      <div class="row-sub">Leader: @${esc(t.leader_username)} · ${t.member_count} member(s)</div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        ${t.status !== 'cancelled' ? `<button class="btn small danger" data-cancel-trip="${t.id}">Cancel trip</button>` : ''}
        <button class="btn small danger" data-delete-trip="${t.id}">Delete trip</button>
      </div>
    </div>`
          )
          .join('');
}
document.getElementById('trips-list').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.cancelTrip) await Api.post(`/org-admin/trips/${t.dataset.cancelTrip}/cancel`);
    else if (t.dataset.deleteTrip) {
      if (!confirm('Permanently delete this trip?')) return;
      await Api.delete(`/org-admin/trips/${t.dataset.deleteTrip}`);
    } else return;
    loadAdminTrips();
  } catch (err) {
    alert(err.message);
  }
});

let adminMap = null;
async function loadActiveRiders() {
  const d = await Api.get('/org-admin/riders/active');
  const listEl = document.getElementById('riders-list');
  listEl.innerHTML =
    d.riders.length === 0
      ? '<div class="empty-state">No riders are currently live.</div>'
      : d.riders
          .map(
            (r) => `<div class="row"><span class="pulse-dot"></span><div><div class="row-title">${esc(r.name)}</div><div class="row-sub mono">@${esc(r.username)} · ${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}</div></div></div>`
          )
          .join('');

  if (!adminMap) {
    adminMap = L.map('admin-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(adminMap);
  }
  adminMap.eachLayer((layer) => {
    if (layer instanceof L.Marker) adminMap.removeLayer(layer);
  });
  const bounds = [];
  d.riders.forEach((r) => {
    if (r.lat == null) return;
    L.marker([r.lat, r.lng]).addTo(adminMap).bindPopup(`<b>${esc(r.name)}</b><br/>@${esc(r.username)}`);
    bounds.push([r.lat, r.lng]);
  });
  if (bounds.length) adminMap.fitBounds(bounds, { maxZoom: 10, padding: [40, 40] });
}

showASection('summary');
