function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso.includes('Z') ? iso : iso + 'Z').getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function avatarHtml(user, sizeClass = '') {
  if (user.profile_pic_url) {
    const path = user.profile_pic_url.replace('/api', '');
    const src = `${window.APP_CONFIG.API_BASE}${path}?token=${encodeURIComponent(Api.accessToken())}`;
    return `<img src="${src}" class="avatar ${sizeClass}" style="object-fit:cover;" onerror="this.outerHTML='<div class=&quot;avatar ${sizeClass}&quot;>${initials(user.name)}</div>'" />`;
  }
  return `<div class="avatar ${sizeClass}">${initials(user.name)}</div>`;
}

async function loadOverview() {
  document.getElementById('ov-name').textContent = ME.name;
  document.getElementById('ov-username').textContent = '@' + ME.username;
  document.getElementById('ov-avatar').textContent = initials(ME.name);

  try {
    const [friends, trips, nearby, notifs] = await Promise.all([
      Api.get('/friends'),
      Api.get('/trips/mine'),
      Api.get('/users/nearby/active'),
      Api.get('/notifications')
    ]);
    document.getElementById('ov-friends').textContent = friends.friends.length;
    document.getElementById('ov-trips').textContent = trips.trips.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
    document.getElementById('ov-nearby').textContent = nearby.results.length;

    const notifsEl = document.getElementById('ov-notifs');
    const recent = notifs.notifications.slice(0, 5);
    notifsEl.innerHTML =
      recent.length === 0
        ? '<div class="empty-state">No notifications yet.</div>'
        : recent
            .map(
              (n) =>
                `<div class="row"><div>${n.read ? '' : '<span class="pulse-dot" style="width:6px;height:6px;"></span> '}${escapeHtml(n.content)}<div class="row-sub mono">${timeAgo(n.created_at)}</div></div></div>`
            )
            .join('');
  } catch (err) {
    console.error(err);
  }
}

// ===== Live dashboard map (friends' live locations) =====
let dashMap = null;
let dashMarkers = {};

function initDashMap() {
  if (!dashMap) {
    dashMap = L.map('dash-map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(dashMap);
  }
  loadFriendsLocations();
}

function riderIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 8px ${color};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}
function upsertMarker(map, store, key, lat, lng, label, color) {
  if (store[key]) {
    store[key].setLatLng([lat, lng]);
  } else {
    store[key] = L.marker([lat, lng], { icon: riderIcon(color) }).addTo(map).bindPopup(label);
  }
  store[key].setPopupContent(label);
}

async function loadFriendsLocations() {
  try {
    const data = await Api.get('/users/me/friends-locations');
    const live = data.results.filter((r) => r.is_live && r.lat != null);
    if (live.length > 0) {
      const bounds = [];
      live.forEach((r) => {
        upsertMarker(dashMap, dashMarkers, r.id, r.lat, r.lng, `<b>${escapeHtml(r.name)}</b><br/>@${escapeHtml(r.username)}<br/><span class="mono">${timeAgo(r.updated_at)}</span>`, '#00e5c7');
        bounds.push([r.lat, r.lng]);
      });
      dashMap.fitBounds(bounds, { maxZoom: 12, padding: [40, 40] });
    }
  } catch (err) {
    console.error(err);
  }
}

socket.on('location:friend:update', (payload) => {
  if (!dashMap) return;
  upsertMarker(dashMap, dashMarkers, payload.user_id, payload.lat, payload.lng, `<b>${escapeHtml(payload.name)}</b><br/>@${escapeHtml(payload.username)}<br/><span class="mono">live now</span>`, '#00e5c7');
});
socket.on('location:friend:offline', (payload) => {
  if (dashMarkers[payload.user_id] && dashMap) {
    dashMap.removeLayer(dashMarkers[payload.user_id]);
    delete dashMarkers[payload.user_id];
  }
});
