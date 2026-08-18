let friendsCache = [];
let currentTripId = null;
let currentTripIsLeader = false;
let tripMap = null;
let tripMarkers = {};
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
  const payload = {
    name: document.getElementById('trip-name').value.trim(),
    start_point: document.getElementById('trip-start').value.trim(),
    destination: document.getElementById('trip-dest').value.trim(),
    trip_date: document.getElementById('trip-date').value,
    trip_time: document.getElementById('trip-time').value,
    description: document.getElementById('trip-desc').value.trim(),
    invite_user_ids: invitees
  };
  try {
    await Api.post('/trips', payload);
    e.target.reset();
    loadTrips();
  } catch (err) {
    alert(err.message);
  }
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

async function openTripDetail(tripId) {
  currentTripId = tripId;
  const panel = document.getElementById('trip-detail');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    const data = await Api.get(`/trips/${tripId}`);
    currentTripIsLeader = data.is_leader;

    document.getElementById('trip-detail-name').textContent = data.trip.name;
    document.getElementById('trip-detail-status').textContent = data.trip.status;
    document.getElementById('trip-detail-status').className = `tag ${data.trip.status}`;
    document.getElementById('trip-detail-meta').textContent = `${data.trip.start_point} → ${data.trip.destination} · ${String(data.trip.trip_date).slice(0, 10)} ${data.trip.trip_time}`;
    document.getElementById('trip-detail-desc').textContent = data.trip.description || '';

    const actionsEl = document.getElementById('trip-detail-actions');
    actionsEl.innerHTML = '';
    if (data.trip.status !== 'completed' && data.trip.status !== 'cancelled') {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn small primary';
      shareBtn.textContent = 'Share my location on this trip';
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

    document.getElementById('trip-members-list').innerHTML = data.members
      .map(
        (m) => `
      <div class="row">
        ${avatarHtml(m)}
        <div><div class="row-title">${escapeHtml(m.name)} ${m.id === data.trip.leader_id ? '<span class="tag active">Leader</span>' : ''}</div><div class="row-sub">@${escapeHtml(m.username)}</div></div>
        <div class="row-actions"><span class="pulse-dot ${m.is_sharing_location ? '' : 'offline'}"></span></div>
      </div>`
      )
      .join('');

    if (currentTripIsLeader) {
      const invMoreEl = document.getElementById('trip-invite-more');
      const memberIds = new Set(data.members.map((m) => m.id));
      const pendingIds = new Set(data.invitations.filter((i) => i.status === 'pending').map((i) => i.user_id));
      const candidates = friendsCache.filter((f) => !memberIds.has(f.id) && !pendingIds.has(f.id));
      invMoreEl.innerHTML = candidates.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('') || '<option disabled>No more friends to invite</option>';
    }

    initTripMap(tripId, data.members);
    loadTripChat(tripId);
    socket.emit('trip:join', tripId);
  } catch (err) {
    alert(err.message);
  }
}

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

function initTripMap(tripId) {
  const el = document.getElementById('trip-map');
  el.innerHTML = '';
  tripMarkers = {};
  tripMap = L.map('trip-map').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(tripMap);

  Api.get(`/trips/${tripId}/locations`).then((data) => {
    if (data.locations.length === 0) return;
    const bounds = [];
    data.locations.forEach((l) => {
      upsertMarker(tripMap, tripMarkers, l.id, l.lat, l.lng, `<b>${escapeHtml(l.name)}</b>`, '#ffb020');
      bounds.push([l.lat, l.lng]);
    });
    tripMap.fitBounds(bounds, { maxZoom: 13, padding: [40, 40] });
  });
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
  upsertMarker(tripMap, tripMarkers, payload.user_id, payload.lat, payload.lng, `<b>${escapeHtml(payload.name || 'Rider')}</b>`, '#ffb020');
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
