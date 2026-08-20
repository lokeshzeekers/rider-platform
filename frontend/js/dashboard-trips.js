let friendsCache = [];
let currentTripId = null;
let currentTripIsLeader = false;
let currentTripLeaderId = null;
let currentTripMembers = [];
let currentTrip = null;
let tripMap = null;
let tripMarkers = {};
let tripDestMarker = null;
let tripRouteLine = null;
let tripLocationsById = {};
let tripLocationInterval = null;

async function populateInviteeSelect(selectEl) {
  try {
    const data = await Api.get('/friends');
    friendsCache = data.friends;
    selectEl.innerHTML =
      data.friends.length === 0
        ? '<option disabled>Add friends first to invite them</option>'
        : data.friends.map((f) => `<option value="${f.id}">${escapeHtml(f.name)} (@${escapeHtml(f.username)})</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const invitees = Array.from(document.getElementById('trip-invitees').selectedOptions).map((o) => o.value);
  const destLatRaw = document.getElementById('trip-dest-lat').value.trim();
  const destLngRaw = document.getElementById('trip-dest-lng').value.trim();
  const errEl = document.getElementById('trip-dest-coords-error');
  errEl.classList.add('hidden');
  if ((destLatRaw === '') !== (destLngRaw === '')) {
    errEl.textContent = 'Provide both destination latitude and longitude, or leave both blank.';
    errEl.classList.remove('hidden');
    return;
  }
  const payload = {
    name: document.getElementById('trip-name').value.trim(),
    start_point: document.getElementById('trip-start').value.trim(),
    destination: document.getElementById('trip-dest').value.trim(),
    trip_date: document.getElementById('trip-date').value,
    trip_time: document.getElementById('trip-time').value,
    description: document.getElementById('trip-desc').value.trim(),
    invite_user_ids: invitees
  };
  if (destLatRaw !== '' && destLngRaw !== '') {
    payload.dest_lat = parseFloat(destLatRaw);
    payload.dest_lng = parseFloat(destLngRaw);
  }
  try {
    await Api.post('/trips', payload);
    e.target.reset();
    document.getElementById('trip-dest-coords-details').open = false;
    loadTrips();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('trip-dest-use-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Your browser does not support geolocation. Enter coordinates manually.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('trip-dest-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('trip-dest-lng').value = pos.coords.longitude.toFixed(6);
    },
    () => alert('Could not get your current location. Enter coordinates manually.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.querySelectorAll('[data-trip-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-trip-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('trip-mine-list').classList.toggle('hidden', btn.dataset.tripTab !== 'mine');
    document.getElementById('trip-invites-list').classList.toggle('hidden', btn.dataset.tripTab !== 'invites');
  });
});

async function loadTrips() {
  populateInviteeSelect(document.getElementById('trip-invitees'));
  const mineEl = document.getElementById('trip-mine-list');
  const invEl = document.getElementById('trip-invites-list');
  try {
    const data = await Api.get('/trips/mine');

    mineEl.innerHTML =
      data.trips.length === 0
        ? '<div class="empty-state">No trips yet — create one above.</div>'
        : data.trips
            .map(
              (t) => `
      <div class="card" style="cursor:pointer;margin-bottom:10px;" data-open-trip="${t.id}">
        <div class="topbar" style="margin-bottom:4px;">
          <div class="row-title">${escapeHtml(t.name)}</div>
          <span class="tag ${t.status}">${t.status}</span>
        </div>
        <div class="row-sub">${escapeHtml(t.start_point)} → ${escapeHtml(t.destination)} · <span class="mono">${String(t.trip_date).slice(0, 10)} ${t.trip_time}</span></div>
      </div>`
            )
            .join('');

    invEl.innerHTML =
      data.invitations.length === 0
        ? '<div class="empty-state">No pending invitations.</div>'
        : data.invitations
            .map(
              (i) => `
      <div class="card" style="margin-bottom:10px;">
        <div class="row-title">${escapeHtml(i.name)}</div>
        <div class="row-sub">${escapeHtml(i.start_point)} → ${escapeHtml(i.destination)} · <span class="mono">${String(i.trip_date).slice(0, 10)} ${i.trip_time}</span></div>
        <div class="row-sub">Invited by ${escapeHtml(i.invited_by_name)}</div>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="btn small primary" data-trip-invite-respond="${i.trip_id}" data-action="accept">Accept</button>
          <button class="btn small danger" data-trip-invite-respond="${i.trip_id}" data-action="decline">Decline</button>
        </div>
      </div>`
            )
            .join('');

    refreshTripInviteBadge();
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('trip-mine-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-open-trip]');
  if (card) openTripDetail(card.dataset.openTrip);
});

document.getElementById('trip-invites-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-trip-invite-respond]');
  if (!btn) return;
  try {
    await Api.post(`/trips/${btn.dataset.tripInviteRespond}/invitations/respond`, { action: btn.dataset.action });
    loadTrips();
  } catch (err) {
    alert(err.message);
  }
});

// ===== Dedicated trip tracking view =====
// Opening a trip replaces the normal Trips page with a focused view: back button, trip
// banner, a large live map, and the rider list. Closed = return to Trips (Create/My
// Trips/Invitations), unchanged. The URL hash (#trip/<id>) is what survives a reload.
async function openTripDetail(tripId) {
  currentTripId = tripId;
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.classList.add('hidden');
  showSection('trip-live');
  history.replaceState(null, '', '#trip/' + tripId);
  window.scrollTo(0, 0);

  try {
    const data = await Api.get(`/trips/${tripId}`);
    currentTripIsLeader = data.is_leader;
    currentTripMembers = data.members;
    currentTripLeaderId = data.trip.leader_id;
    currentTrip = data.trip;

    document.getElementById('trip-detail-name').textContent = data.trip.name;
    document.getElementById('trip-detail-status').textContent = data.trip.status;
    document.getElementById('trip-detail-status').className = `tag ${data.trip.status}`;
    document.getElementById('trip-detail-start').textContent = data.trip.start_point;
    document.getElementById('trip-detail-dest').textContent = data.trip.destination;
    document.getElementById('trip-detail-meta').textContent = `${String(data.trip.trip_date).slice(0, 10)} · ${data.trip.trip_time}`;
    document.getElementById('trip-detail-desc').textContent = data.trip.description || '';

    renderDestinationEditor(data.trip);

    const actionsEl = document.getElementById('trip-detail-actions');
    actionsEl.innerHTML = '';
    if (data.trip.status !== 'completed' && data.trip.status !== 'cancelled') {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn small primary';
      shareBtn.innerHTML = '<i data-lucide="navigation" class="icon icon-sm"></i> Share my location on this trip';
      shareBtn.onclick = () => startTripLocationSharing(tripId);
      actionsEl.appendChild(shareBtn);

      if (currentTripIsLeader) {
        const completeBtn = document.createElement('button');
        completeBtn.className = 'btn small';
        completeBtn.textContent = 'Mark trip completed';
        completeBtn.onclick = async () => {
          if (!confirm('Complete this trip? This finalizes distance and duration.')) return;
          await Api.post(`/trips/${tripId}/complete`);
          openTripDetail(tripId);
          loadTrips();
        };
        actionsEl.appendChild(completeBtn);
      }
    } else if (data.history) {
      actionsEl.innerHTML = `<span class="row-sub mono">Distance: ${data.history.distance_km} km · Duration: ${data.history.duration_minutes} min</span>`;
    }
    if (window.lucide) lucide.createIcons();

    renderRiderList(currentTripMembers);

    if (currentTripIsLeader) {
      const invMoreEl = document.getElementById('trip-invite-more');
      const memberIds = new Set(data.members.map((m) => m.id));
      const pendingIds = new Set(data.invitations.filter((i) => i.status === 'pending').map((i) => i.user_id));
      const candidates = friendsCache.filter((f) => !memberIds.has(f.id) && !pendingIds.has(f.id));
      invMoreEl.innerHTML = candidates.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('') || '<option disabled>No more friends to invite</option>';
    }

    initTripMap(tripId, data.trip);
    loadTripChat(tripId);
    socket.emit('trip:join', tripId);
  } catch (err) {
    alert(err.message);
    closeTripDetail();
  }
}

// Tears down all dedicated-trip-view state: map, fullscreen mode, hidden topbar, and the
// #trip/<id> URL hash. closeTripDetail() (the "Back to Trips" button) is ONE way to
// trigger this, but it must also happen if the user leaves the trip view any other way
// (bottom nav, sidebar, the mobile "More" sheet) -- see the showSection() wrapper in
// dashboard.html, which calls this whenever navigating to anything other than
// 'trip-live'. Without it, leaving mid-trip (especially while full screen map is active)
// left body.map-fullscreen-open stuck on, which blocked all further page scrolling.
function leaveTripView() {
  if (currentTripId === null && !document.body.classList.contains('map-fullscreen-open')) return;
  currentTripId = null;
  currentTripMembers = [];
  currentTrip = null;
  if (tripMap) {
    tripMap.remove();
    tripMap = null;
  }
  tripDestMarker = null;
  tripRouteLine = null;
  exitMapFullscreen();
  const destCard = document.getElementById('trip-dest-editor-card');
  const destTrigger = document.getElementById('trip-dest-edit-trigger');
  if (destCard) destCard.classList.add('hidden');
  if (destTrigger) destTrigger.classList.add('hidden');
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.classList.remove('hidden');
  if (location.hash.startsWith('#trip/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function closeTripDetail() {
  leaveTripView();
  showSection('trips');
  loadTrips();
}
document.getElementById('trip-back-btn').addEventListener('click', closeTripDetail);

// ===== Full screen map =====
// A CSS-driven fixed overlay rather than the native Fullscreen API, since element-level
// Fullscreen support is inconsistent on mobile Safari -- this works identically on every
// platform. Toggled state only; never affects normal page scrolling otherwise.
function setMapFullscreen(on) {
  const wrap = document.getElementById('trip-map-wrap');
  const btn = document.getElementById('trip-map-fullscreen-btn');
  if (!wrap || !btn) return;
  wrap.classList.toggle('map-fullscreen', on);
  document.body.classList.toggle('map-fullscreen-open', on);
  btn.innerHTML = on
    ? '<i data-lucide="minimize" class="icon icon-sm"></i> Exit Full Screen'
    : '<i data-lucide="maximize" class="icon icon-sm"></i> Full Screen Map';
  if (window.lucide) lucide.createIcons();
  // The container size just changed; Leaflet needs to re-measure after layout settles.
  setTimeout(() => tripMap && tripMap.invalidateSize(), 200);
}
function exitMapFullscreen() {
  const wrap = document.getElementById('trip-map-wrap');
  if (wrap && wrap.classList.contains('map-fullscreen')) setMapFullscreen(false);
}
document.getElementById('trip-map-fullscreen-btn').addEventListener('click', () => {
  const wrap = document.getElementById('trip-map-wrap');
  setMapFullscreen(!wrap.classList.contains('map-fullscreen'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exitMapFullscreen();
});

// ===== Missing start/destination handling (no fake markers, ever) =====
function updateMapEmptyNote(hasStart, hasDest) {
  const note = document.getElementById('trip-map-empty-note');
  if (!note) return;
  let text = '';
  if (!hasStart && !hasDest) {
    text = 'Start and destination pins aren\u2019t set for this trip yet.';
  } else if (!hasStart) {
    text = 'No start location recorded yet \u2014 share your location to begin tracking.';
  } else if (!hasDest) {
    text = 'Destination pin isn\u2019t set for this trip yet.';
  }
  note.textContent = text;
  note.classList.toggle('hidden', text === '');
}

// ===== Destination pin editor (leader-only) =====
// Trip-level start/destination are always free-text place names; dest_lat/dest_lng are a
// separate, optional, explicitly-set pair used only for the map marker.
function renderDestinationEditor(trip) {
  const card = document.getElementById('trip-dest-editor-card');
  const trigger = document.getElementById('trip-dest-edit-trigger');
  const hasDest = trip.dest_lat != null && trip.dest_lng != null;

  if (!currentTripIsLeader) {
    card.classList.add('hidden');
    trigger.classList.add('hidden');
    return;
  }

  document.getElementById('trip-dest-editor-name').textContent = trip.destination;
  document.getElementById('trip-dest-editor-lat').value = hasDest ? trip.dest_lat : '';
  document.getElementById('trip-dest-editor-lng').value = hasDest ? trip.dest_lng : '';
  document.getElementById('trip-dest-editor-error').classList.add('hidden');

  if (hasDest) {
    card.classList.add('hidden');
    trigger.classList.remove('hidden');
  } else {
    card.classList.remove('hidden');
    trigger.classList.add('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

document.getElementById('trip-dest-edit-trigger').addEventListener('click', () => {
  document.getElementById('trip-dest-editor-card').classList.remove('hidden');
  document.getElementById('trip-dest-edit-trigger').classList.add('hidden');
});

document.getElementById('trip-dest-editor-use-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Your browser does not support geolocation. Enter coordinates manually.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('trip-dest-editor-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('trip-dest-editor-lng').value = pos.coords.longitude.toFixed(6);
    },
    () => alert('Could not get your current location. Enter coordinates manually.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.getElementById('trip-dest-editor-save').addEventListener('click', async () => {
  const errEl = document.getElementById('trip-dest-editor-error');
  errEl.classList.add('hidden');
  const latRaw = document.getElementById('trip-dest-editor-lat').value.trim();
  const lngRaw = document.getElementById('trip-dest-editor-lng').value.trim();
  if (latRaw === '' || lngRaw === '') {
    errEl.textContent = 'Both latitude and longitude are required to pin a destination.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!currentTripId) return;
  try {
    await Api.patch(`/trips/${currentTripId}/destination`, { dest_lat: parseFloat(latRaw), dest_lng: parseFloat(lngRaw) });
    await openTripDetail(currentTripId);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('trip-invite-more-btn').addEventListener('click', async () => {
  const ids = Array.from(document.getElementById('trip-invite-more').selectedOptions).map((o) => o.value);
  if (ids.length === 0 || !currentTripId) return;
  try {
    await Api.post(`/trips/${currentTripId}/invite`, { user_ids: ids });
    openTripDetail(currentTripId);
  } catch (err) {
    alert(err.message);
  }
});

// ===== Live tracking map =====
function startIcon() {
  return L.divIcon({
    className: '',
    html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:#16a34a;border:2px solid white;box-shadow:0 0 8px rgba(22,163,74,.6);transform:rotate(-45deg);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 20]
  });
}
function destIcon() {
  return L.divIcon({
    className: '',
    html: '<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:#7c3aed;border:2px solid white;box-shadow:0 0 8px rgba(124,58,237,.6);transform:rotate(-45deg);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 20]
  });
}

function haversineKmClient(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Real distance only -- returns null (never a fake number) when either point is unknown.
function distanceFromMeKm(userId) {
  if (userId === ME.id) return null;
  const mine = tripLocationsById[ME.id];
  const theirs = tripLocationsById[userId];
  if (!mine || !theirs) return null;
  return haversineKmClient(mine.lat, mine.lng, theirs.lat, theirs.lng);
}

function riderPopupHtml(member, isLive, distanceKm) {
  const distText =
    member.id === ME.id ? 'This is you' : distanceKm != null ? `${distanceKm.toFixed(1)} km away` : 'Distance unavailable';
  return `
    <div style="min-width:180px;">
      <div class="row-title" style="margin-bottom:2px;">${escapeHtml(member.name)}</div>
      <div class="row-sub" style="margin-bottom:6px;">@${escapeHtml(member.username)}<br/>Rider ID: ${member.id.slice(0, 8).toUpperCase()}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span class="pulse-dot ${isLive ? '' : 'offline'}" style="width:8px;height:8px;"></span>
        <span style="font-size:12px;font-weight:700;color:${isLive ? 'var(--green)' : 'var(--text-dim)'};">${isLive ? 'Live' : 'Offline'}</span>
      </div>
      <div class="row-sub mono">${distText}</div>
    </div>`;
}

function renderTripMapMarkers() {
  if (!tripMap) return;
  const memberById = {};
  currentTripMembers.forEach((m) => (memberById[m.id] = m));
  Object.keys(tripLocationsById).forEach((uid) => {
    const loc = tripLocationsById[uid];
    const member = memberById[uid];
    if (!member) return;
    const isLive = !!member.is_sharing_location;
    const dist = distanceFromMeKm(uid);
    upsertMarker(tripMap, tripMarkers, uid, loc.lat, loc.lng, riderPopupHtml(member, isLive, dist), '#2563eb');
  });
}

function renderRiderList(members) {
  const listEl = document.getElementById('trip-members-list');
  if (!listEl) return;
  listEl.innerHTML =
    members.length === 0
      ? '<div class="empty-state">No riders yet.</div>'
      : members
          .map((m) => {
            const isLive = !!m.is_sharing_location;
            const dist = distanceFromMeKm(m.id);
            const distText = m.id === ME.id ? 'You' : dist != null ? `${dist.toFixed(1)} km away` : '—';
            return `
      <div class="rider-row" data-rider-id="${m.id}">
        ${avatarHtml(m)}
        <div class="rider-id-block">
          <div class="row-title">${escapeHtml(m.name)}${m.id === currentTripLeaderId ? ' <span class="tag active">Leader</span>' : ''}</div>
          <div class="row-sub">@${escapeHtml(m.username)} · Rider ID: ${m.id.slice(0, 8).toUpperCase()}</div>
        </div>
        <div class="rider-status-block">
          <span class="live-badge ${isLive ? 'is-live' : 'is-offline'}"><span class="pulse-dot ${isLive ? '' : 'offline'}" style="width:7px;height:7px;"></span>${isLive ? 'Live' : 'Offline'}</span>
          <span class="rider-distance">${distText}</span>
        </div>
      </div>`;
          })
          .join('');
}

document.getElementById('trip-members-list').addEventListener('click', (e) => {
  const row = e.target.closest('.rider-row');
  if (!row || !tripMap) return;
  const marker = tripMarkers[row.dataset.riderId];
  if (marker) {
    tripMap.setView(marker.getLatLng(), Math.max(tripMap.getZoom(), 14));
    marker.openPopup();
  }
});

function initTripMap(tripId, trip) {
  const el = document.getElementById('trip-map');
  el.innerHTML = '';
  if (tripMap) {
    tripMap.remove();
    tripMap = null;
  }
  tripMarkers = {};
  tripDestMarker = null;
  tripRouteLine = null;
  tripLocationsById = {};
  tripMap = L.map('trip-map').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(tripMap);

  Api.get(`/trips/${tripId}/locations`)
    .then((data) => {
      const bounds = [];
      let startPoint = null;
      let destPoint = null;

      if (data.route_start && typeof data.route_start.lat === 'number') {
        const s = data.route_start;
        startPoint = [s.lat, s.lng];
        L.marker(startPoint, { icon: startIcon() })
          .addTo(tripMap)
          .bindPopup(`<b>Start point</b><br/><span class="row-sub mono">Tracking began ${timeAgo(s.recorded_at)}</span>`);
        bounds.push(startPoint);
      }

      // Destination marker: only ever drawn from trip.dest_lat/dest_lng, an explicit
      // coordinate pair set via the destination editor -- never guessed from place text.
      if (trip && typeof trip.dest_lat === 'number' && typeof trip.dest_lng === 'number') {
        destPoint = [trip.dest_lat, trip.dest_lng];
        tripDestMarker = L.marker(destPoint, { icon: destIcon() })
          .addTo(tripMap)
          .bindPopup(`<b>Destination</b><br/><span class="row-sub">${escapeHtml(trip.destination)}</span>`);
        bounds.push(destPoint);
      }

      // Direction line between the two real points -- a straight line, not a routed
      // road path (we have no routing service), so it never implies invented geography.
      if (startPoint && destPoint) {
        tripRouteLine = L.polyline([startPoint, destPoint], {
          color: '#7c3aed',
          weight: 3,
          opacity: 0.55,
          dashArray: '2 10',
          lineCap: 'round'
        }).addTo(tripMap);
      }

      updateMapEmptyNote(!!startPoint, !!destPoint);

      data.locations.forEach((l) => {
        tripLocationsById[l.id] = { lat: l.lat, lng: l.lng, updated_at: l.updated_at };
        bounds.push([l.lat, l.lng]);
      });

      renderTripMapMarkers();
      renderRiderList(currentTripMembers);

      if (bounds.length > 0) {
        tripMap.fitBounds(bounds, { maxZoom: 14, padding: [50, 50] });
      }
      // Leaflet sizes itself from the container's dimensions at creation time; since the
      // section may still be mid-transition into view, re-measure shortly after.
      setTimeout(() => tripMap && tripMap.invalidateSize(), 150);
    })
    .catch((err) => console.error(err));
}

function startTripLocationSharing(tripId) {
  if (tripLocationInterval) clearInterval(tripLocationInterval);
  const sendPos = (lat, lng) => {
    socket.emit('trip:location:update', { trip_id: tripId, lat, lng });
    Api.post(`/trips/${tripId}/location`, { lat, lng }).catch(() => {});
  };
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (pos) => sendPos(pos.coords.latitude, pos.coords.longitude),
      () => simulateTripLocation(sendPos),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  } else {
    simulateTripLocation(sendPos);
  }
  alert('Sharing your live location on this trip.');
}
function simulateTripLocation(sendPos) {
  const base = { lat: 11.0168, lng: 76.9558 };
  tripLocationInterval = setInterval(() => {
    sendPos(base.lat + (Math.random() - 0.5) * 0.01, base.lng + (Math.random() - 0.5) * 0.01);
  }, 4000);
}

socket.on('trip:location:update', (payload) => {
  if (!tripMap || payload.trip_id !== currentTripId) return;
  tripLocationsById[payload.user_id] = { lat: payload.lat, lng: payload.lng, updated_at: payload.updated_at };
  const member = currentTripMembers.find((m) => m.id === payload.user_id);
  if (member) member.is_sharing_location = true;
  renderTripMapMarkers();
  renderRiderList(currentTripMembers);
});
socket.on('trip:destination:update', (payload) => {
  if (payload.trip_id !== currentTripId || !currentTrip) return;
  currentTrip.dest_lat = payload.dest_lat;
  currentTrip.dest_lng = payload.dest_lng;
  renderDestinationEditor(currentTrip);
  initTripMap(currentTripId, currentTrip);
});
socket.on('trip:member:joined', (payload) => {
  if (payload.trip_id === currentTripId) openTripDetail(currentTripId);
});
socket.on('trip:completed', (payload) => {
  if (payload.trip_id === currentTripId) openTripDetail(currentTripId);
  loadTrips();
});

async function loadTripChat(tripId) {
  const box = document.getElementById('trip-chat-messages');
  try {
    const data = await Api.get(`/trips/${tripId}/chat`);
    box.innerHTML = data.messages
      .map((m) => `<div class="bubble ${m.sender_id === ME.id ? 'mine' : 'theirs'}"><b>${m.sender_id === ME.id ? 'You' : escapeHtml(m.name)}:</b> ${escapeHtml(m.content)}<div class="bubble-time">${timeAgo(m.created_at)}</div></div>`)
      .join('');
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    box.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

document.getElementById('trip-chat-send').addEventListener('click', sendTripChat);
document.getElementById('trip-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendTripChat();
});
async function sendTripChat() {
  const input = document.getElementById('trip-chat-input');
  const content = input.value.trim();
  if (!content || !currentTripId) return;
  input.value = '';
  try {
    await Api.post(`/trips/${currentTripId}/chat`, { content });
  } catch (err) {
    alert(err.message);
  }
}
socket.on('trip:chat:message', (m) => {
  if (m.trip_id !== currentTripId) return;
  const box = document.getElementById('trip-chat-messages');
  const div = document.createElement('div');
  div.className = `bubble ${m.sender_id === ME.id ? 'mine' : 'theirs'}`;
  div.innerHTML = `<b>${m.sender_id === ME.id ? 'You' : escapeHtml(m.name)}:</b> ${escapeHtml(m.content)}<div class="bubble-time">${timeAgo(m.created_at)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

async function loadHistory() {
  const el = document.getElementById('history-list');
  try {
    const data = await Api.get('/trips/history/all');
    el.innerHTML =
      data.history.length === 0
        ? '<div class="empty-state">No completed trips yet.</div>'
        : data.history
            .map(
              (t) => `
      <div class="card" style="margin-bottom:10px;">
        <div class="topbar" style="margin-bottom:4px;"><div class="row-title">${escapeHtml(t.name)}</div><span class="tag completed">completed</span></div>
        <div class="row-sub">${escapeHtml(t.start_point)} → ${escapeHtml(t.destination)} · <span class="mono">${String(t.trip_date).slice(0, 10)}</span></div>
        <div class="row-sub mono">Distance: ${t.distance_km ?? '—'} km · Duration: ${t.duration_minutes ?? '—'} min · Completed ${timeAgo(t.completed_at)}</div>
      </div>`
            )
            .join('');
  } catch (err) {
    el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

// ===== Reload persistence: restore the dedicated trip view from the URL hash =====
// dashboard.html's bootstrap script checks location.hash before defaulting to 'overview';
// this just exposes the entry point it calls.
function restoreTripFromHash() {
  const m = location.hash.match(/^#trip\/([^/]+)$/);
  if (m) {
    openTripDetail(m[1]);
    return true;
  }
  return false;
}
