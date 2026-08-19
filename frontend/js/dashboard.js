if (!Api.accessToken()) {
  window.location.href = 'index.html';
}
let ME = Api.getUser();
if (ME && ME.role === 'super_admin') {
  window.location.href = 'super-admin.html';
}

// ===== Socket connection (re-created after an access-token refresh, since Socket.IO
// auth happens once at connect time and short-lived tokens will expire mid-session) =====
let socket = connectSocket();
function connectSocket() {
  const s = io(window.APP_CONFIG.SOCKET_URL, { auth: { token: Api.accessToken() } });
  s.on('connect_error', async (err) => {
    console.warn('Socket connect error:', err.message);
    if (err.message.includes('expired') || err.message.includes('Invalid')) {
      try {
        await Api.get('/auth/me'); // triggers Api's own 401 -> refresh flow
        s.auth.token = Api.accessToken();
        s.connect();
      } catch {
        // Api.js will redirect to index.html on unrecoverable refresh failure
      }
    }
  });
  return s;
}

document.getElementById('org-badge').textContent = ME ? `Org: ${Api.getOrgCode()}` : '';

// 'trip-live' is the dedicated single-trip tracking view opened from within Trips.
// It has no sidebar nav-item of its own (it's reached by clicking a trip, not the nav),
// but it's included here so it hides/shows through the exact same mechanism as every
// other section instead of a bolted-on parallel system.
const sections = ['overview', 'map', 'friends', 'requests', 'chats', 'trips', 'history', 'notifications', 'profile', 'trip-live'];
function showSection(name) {
  sections.forEach((s) => {
    document.getElementById(`section-${s}`).classList.toggle('hidden', s !== name);
  });
  document.querySelectorAll('.nav-item[data-section]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });
  document.getElementById('section-heading').textContent = name.charAt(0).toUpperCase() + name.slice(1);

  if (name === 'map') initDashMap();
  if (name === 'friends') loadFriends();
  if (name === 'requests') loadRequests();
  if (name === 'chats') loadChatThreads();
  if (name === 'trips') loadTrips();
  if (name === 'history') loadHistory();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile') loadProfile();
  if (name === 'overview') loadOverview();
}
document.querySelectorAll('.nav-item[data-section]').forEach((btn) => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await Api.post('/auth/logout', { refresh_token: Api.refreshToken() });
  } catch {}
  Api.clearTokens();
  window.location.href = 'index.html';
});

if (ME && (ME.role === 'org_admin')) {
  const link = document.getElementById('org-admin-link');
  link.style.display = '';
  link.addEventListener('click', () => (window.location.href = 'org-admin.html'));
}

// ===== Live location toggle =====
let watchId = null;
let isLive = false;

function setLiveUI(on) {
  isLive = on;
  document.getElementById('live-toggle').classList.toggle('on', on);
  document.getElementById('live-toggle-text').textContent = on ? 'Live — sharing location' : 'Location off';
  document.getElementById('live-toggle-dot').classList.toggle('offline', !on);
  document.getElementById('my-status-dot').classList.toggle('offline', !on);
  // Overview "Your Profile" card shows the same live/offline state -- guarded with
  // null checks since loadOverview() may not have rendered these yet on first load.
  const ovDot = document.getElementById('ov-live-dot');
  const ovText = document.getElementById('ov-live-text');
  if (ovDot) ovDot.classList.toggle('offline', !on);
  if (ovText) ovText.textContent = on ? 'Live' : 'Offline';
}

document.getElementById('live-toggle').addEventListener('click', () => {
  if (isLive) stopLiveLocation();
  else startLiveLocation();
});

function startLiveLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported in this browser.');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      socket.emit('location:update', { lat: latitude, lng: longitude });
      Api.post('/users/me/location', { lat: latitude, lng: longitude, is_live: true }).catch(() => {});
    },
    (err) => {
      console.warn('Geolocation error, falling back to simulated location:', err.message);
      simulateLocation();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
  setLiveUI(true);
}

let simInterval = null;
function simulateLocation() {
  const base = { lat: 11.0168, lng: 76.9558 };
  simInterval = setInterval(() => {
    const lat = base.lat + (Math.random() - 0.5) * 0.01;
    const lng = base.lng + (Math.random() - 0.5) * 0.01;
    socket.emit('location:update', { lat, lng });
    Api.post('/users/me/location', { lat, lng, is_live: true }).catch(() => {});
  }, 4000);
}

function stopLiveLocation() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (simInterval) clearInterval(simInterval);
  watchId = null;
  simInterval = null;
  socket.emit('location:stop');
  Api.post('/users/me/location/stop').catch(() => {});
  setLiveUI(false);
}

socket.on('notification:new', () => {
  refreshNotifBadge();
  if (!document.getElementById('section-notifications').classList.contains('hidden')) loadNotifications();
});

async function refreshNotifBadge() {
  try {
    const data = await Api.get('/notifications');
    const unread = data.notifications.filter((n) => !n.read).length;
    const badge = document.getElementById('badge-notifs');
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);
  } catch {}
}
async function refreshRequestsBadge() {
  try {
    const data = await Api.get('/friends/requests');
    const badge = document.getElementById('badge-requests');
    badge.textContent = data.incoming.length;
    badge.classList.toggle('hidden', data.incoming.length === 0);
  } catch {}
}
async function refreshTripInviteBadge() {
  try {
    const data = await Api.get('/trips/mine');
    const badge = document.getElementById('badge-trip-invites');
    badge.textContent = data.invitations.length;
    badge.classList.toggle('hidden', data.invitations.length === 0);
  } catch {}
}
socket.on('friend:request:incoming', refreshRequestsBadge);
socket.on('trip:invite:incoming', refreshTripInviteBadge);

refreshNotifBadge();
refreshRequestsBadge();
refreshTripInviteBadge();
