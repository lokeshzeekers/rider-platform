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
let tripGeoWatchId = null;
let mapFollowMe = false;
let suppressFollowCancel = false;
let navMode = false;
let tripRouteSteps = [];
let navCurrentStepIndex = 0;

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
    renderStartEditor(data.trip);

    const actionsEl = document.getElementById('trip-detail-actions');
    actionsEl.innerHTML = '';
    if (data.trip.status !== 'completed' && data.trip.status !== 'cancelled') {
      if (data.trip.status === 'upcoming') {
        if (currentTripIsLeader) {
          const startBtn = document.createElement('button');
          startBtn.className = 'btn small primary';
          startBtn.innerHTML = '<i data-lucide="play" class="icon icon-sm"></i> Start Trip';
          startBtn.onclick = async () => {
            startBtn.disabled = true;
            try {
              await Api.post(`/trips/${tripId}/start`);
              openTripDetail(tripId);
              loadTrips();
            } catch (err) {
              startBtn.disabled = false;
              alert(err.message);
            }
          };
          actionsEl.appendChild(startBtn);
        } else {
          const waitingNote = document.createElement('span');
          waitingNote.className = 'row-sub';
          waitingNote.style.alignSelf = 'center';
          waitingNote.textContent = 'Waiting for the trip leader to start the trip.';
          actionsEl.appendChild(waitingNote);
        }
      }

      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn small primary';
      shareBtn.innerHTML = '<i data-lucide="navigation" class="icon icon-sm"></i> Share my location on this trip';
      shareBtn.onclick = () => startTripLocationSharing(tripId);
      actionsEl.appendChild(shareBtn);

      const myMembership = data.members.find((m) => m.id === ME.id);
      const reachedBtn = document.createElement('button');
      if (myMembership && myMembership.reached_at) {
        reachedBtn.className = 'btn small ghost';
        reachedBtn.disabled = true;
        reachedBtn.innerHTML = '<i data-lucide="flag" class="icon icon-sm"></i> You\u2019ve reached the destination';
      } else {
        reachedBtn.className = 'btn small';
        reachedBtn.innerHTML = '<i data-lucide="flag" class="icon icon-sm"></i> Mark as reached';
        reachedBtn.onclick = async () => {
          reachedBtn.disabled = true;
          try {
            await Api.post(`/trips/${tripId}/reached`);
            openTripDetail(tripId);
          } catch (err) {
            reachedBtn.disabled = false;
            alert(err.message);
          }
        };
      }
      actionsEl.appendChild(reachedBtn);

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
  navMode = false;
  tripRouteSteps = [];
  const navBanner = document.getElementById('trip-nav-banner');
  if (navBanner) navBanner.classList.add('hidden');
  exitMapFullscreen();
  const destCard = document.getElementById('trip-dest-editor-card');
  const destTrigger = document.getElementById('trip-dest-edit-trigger');
  if (destCard) destCard.classList.add('hidden');
  if (destTrigger) destTrigger.classList.add('hidden');
  const startCard = document.getElementById('trip-start-editor-card');
  const startTrigger = document.getElementById('trip-start-edit-trigger');
  if (startCard) startCard.classList.add('hidden');
  if (startTrigger) startTrigger.classList.add('hidden');
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
    ? '<i data-lucide="minimize" class="icon icon-sm"></i> <span class="btn-label">Exit Full Screen</span>'
    : '<i data-lucide="maximize" class="icon icon-sm"></i> <span class="btn-label">Full Screen Map</span>';
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

// ===== Need to Stop =====
document.getElementById('trip-need-stop-btn').addEventListener('click', async () => {
  if (!currentTripId) return;
  if (!confirm('Alert the rest of the group that you need to stop the ride?')) return;
  const btn = document.getElementById('trip-need-stop-btn');
  btn.disabled = true;
  try {
    await Api.post(`/trips/${currentTripId}/need-stop`);
    alert('Alert sent to the group.');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ===== Missing start/destination handling (no fake markers, ever) =====
function updateMapEmptyNote(hasStart, hasDest, routeFallback) {
  const note = document.getElementById('trip-map-empty-note');
  if (!note) return;
  let text = '';
  if (!hasStart && !hasDest) {
    text = 'Start and destination pins aren\u2019t set for this trip yet.';
  } else if (!hasStart) {
    text = 'No start location recorded yet \u2014 share your location to begin tracking.';
  } else if (!hasDest) {
    text = 'Destination pin isn\u2019t set for this trip yet.';
  } else if (routeFallback) {
    text = 'Showing a straight line between start and destination \u2014 live road routing is temporarily unavailable.';
  }
  note.textContent = text;
  note.classList.toggle('hidden', text === '');
}

// ===== Real road route (OSRM public routing server) =====
// router.project-osrm.org is OSRM's free public demo instance: no API key required, but
// it's explicitly documented by the OSRM project as a demo service, not an SLA-backed
// production endpoint -- it can be slow, rate-limited, or briefly unavailable. That's why
// this always has a graceful fallback to the straight direction line rather than failing
// visibly. For guaranteed uptime at real production volume, a self-hosted OSRM instance
// or a paid provider (Mapbox/Google Directions) would be the next step.
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

async function fetchRoadRoute(startPoint, destPoint) {
  const url = `${OSRM_BASE}/${startPoint[1]},${startPoint[0]};${destPoint[1]},${destPoint[0]}?overview=full&geometries=geojson&steps=true`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
    const route = data.routes[0];
    const latlngs = route.geometry.coordinates.map((c) => [c[1], c[0]]);
    const steps = (route.legs && route.legs[0] ? route.legs[0].steps : []) || [];
    return { latlngs, steps, distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
  } catch (err) {
    clearTimeout(timeout);
    console.warn('Road route unavailable, falling back to straight line:', err.message);
    return null;
  }
}

function maneuverText(step) {
  const name = step.name && step.name.trim() ? step.name.trim() : 'the road';
  const m = step.maneuver || {};
  const mod = m.modifier || '';
  switch (m.type) {
    case 'depart':
      return step.name ? `Head out on ${name}` : 'Head out';
    case 'arrive':
      return 'Arrive at the destination';
    case 'turn':
    case 'end of road':
      return mod === 'straight' ? `Continue straight onto ${name}` : `Turn ${mod || ''} onto ${name}`.replace('  ', ' ');
    case 'roundabout':
    case 'rotary':
      return `At the roundabout, take the exit onto ${name}`;
    case 'merge':
      return `Merge onto ${name}`;
    case 'fork':
      return `Keep ${mod || 'straight'} at the fork onto ${name}`;
    default:
      return `Continue onto ${name}`;
  }
}

function renderDirections(routeResult) {
  const card = document.getElementById('trip-directions-card');
  const list = document.getElementById('trip-directions-list');
  const summary = document.getElementById('trip-directions-summary');
  tripRouteSteps = routeResult && routeResult.steps ? routeResult.steps : [];
  navCurrentStepIndex = 0;
  if (!card || !list || !summary) return;
  if (!routeResult || !routeResult.steps || routeResult.steps.length === 0) {
    card.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  summary.textContent = `${routeResult.distanceKm.toFixed(1)} km \u00B7 ~${Math.round(routeResult.durationMin)} min by road`;
  list.innerHTML = routeResult.steps
    .map((step) => {
      const distText = step.distance >= 1000 ? `${(step.distance / 1000).toFixed(1)} km` : `${Math.round(step.distance)} m`;
      return `<li style="margin-bottom:6px;"><span class="row-title" style="font-weight:500;">${escapeHtml(maneuverText(step))}</span> <span class="row-sub">(${distText})</span></li>`;
    })
    .join('');
  card.classList.remove('hidden');
}

// ===== Focused navigation mode: your route, your marker only =====
// "Start Navigation" hides every other rider's marker (start/destination/route stay),
// turns on follow-me, and shows a live banner tracking your progress through the real
// OSRM steps by proximity -- this is a lightweight, distance-to-next-maneuver estimate,
// not true map-matched road-snapped navigation, so treat the "arrived" trigger distance
// as approximate rather than precise.
function setNavMode(on) {
  navMode = on;
  navCurrentStepIndex = 0;
  const btn = document.getElementById('trip-nav-toggle-btn');
  if (btn) {
    btn.innerHTML = on
      ? '<i data-lucide="x" class="icon icon-sm"></i> <span class="btn-label">Exit Navigation</span>'
      : '<i data-lucide="navigation-2" class="icon icon-sm"></i> <span class="btn-label">Start Navigation</span>';
    btn.classList.toggle('primary', !on);
    btn.classList.toggle('ghost', on);
  }
  if (window.lucide) lucide.createIcons();
  if (on && tripMap && tripLocationsById[ME.id]) {
    setMapFollowMe(true);
    suppressFollowCancel = true;
    tripMap.setView([tripLocationsById[ME.id].lat, tripLocationsById[ME.id].lng], 16, { animate: true });
    setTimeout(() => {
      suppressFollowCancel = false;
    }, 500);
  }
  renderTripMapMarkers();
}
document.getElementById('trip-nav-toggle-btn').addEventListener('click', () => setNavMode(!navMode));

function updateNavigationBanner() {
  const banner = document.getElementById('trip-nav-banner');
  if (!banner) return;
  const mine = tripLocationsById[ME.id];
  if (!navMode || tripRouteSteps.length === 0 || !mine) {
    banner.classList.add('hidden');
    return;
  }
  // Advance to the next step once we're close enough to the current one's maneuver
  // point -- proximity-based, never moves backward.
  while (navCurrentStepIndex < tripRouteSteps.length - 1) {
    const loc = tripRouteSteps[navCurrentStepIndex].maneuver && tripRouteSteps[navCurrentStepIndex].maneuver.location;
    if (!loc) break;
    const meters = haversineKmClient(mine.lat, mine.lng, loc[1], loc[0]) * 1000;
    if (meters < 40) {
      navCurrentStepIndex++;
    } else {
      break;
    }
  }
  const step = tripRouteSteps[navCurrentStepIndex];
  const loc = step.maneuver && step.maneuver.location;
  let distText = '';
  if (loc) {
    const meters = haversineKmClient(mine.lat, mine.lng, loc[1], loc[0]) * 1000;
    distText = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
  }
  banner.innerHTML = `<span>${escapeHtml(maneuverText(step))}</span>${distText ? `<span class="nav-banner-dist">${distText}</span>` : ''}`;
  banner.classList.remove('hidden');
}

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
  renderDirections(null);
  setMapFollowMe(false);
  setNavMode(false);
  document.getElementById('trip-my-location-readout').classList.add('hidden');
  tripMap = L.map('trip-map').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(tripMap);
  // Manually panning/zooming means the rider wants to look elsewhere -- stop
  // auto-recentering on them until they tap "Recenter to Me" again. dragstart only fires
  // for real user drag (never programmatic pan), so it's always safe to listen to
  // directly. zoomstart fires for BOTH user zoom AND our own programmatic setView calls
  // (e.g. the recenter button's own zoom-in) -- suppressFollowCancel guards specifically
  // against that self-triggered case so enabling follow mode can't immediately cancel
  // itself.
  tripMap.on('dragstart', () => setMapFollowMe(false));
  tripMap.on('zoomstart', () => {
    if (!suppressFollowCancel) setMapFollowMe(false);
  });

  Api.get(`/trips/${tripId}/locations`)
    .then(async (data) => {
      const bounds = [];
      let startPoint = null;
      let destPoint = null;

      // Prefer the leader-pinned start point (as accurate/intentional as the destination
      // pin); fall back to the earliest real GPS fix recorded for the trip, distinctly
      // labeled, only when no pin has been set.
      if (trip && typeof trip.start_lat === 'number' && typeof trip.start_lng === 'number') {
        startPoint = [trip.start_lat, trip.start_lng];
        L.marker(startPoint, { icon: startIcon() })
          .addTo(tripMap)
          .bindPopup(`<b>Start point</b><br/><span class="row-sub">${escapeHtml(trip.start_point)}</span>`);
        bounds.push(startPoint);
      } else if (data.route_start && typeof data.route_start.lat === 'number') {
        const s = data.route_start;
        startPoint = [s.lat, s.lng];
        L.marker(startPoint, { icon: startIcon() })
          .addTo(tripMap)
          .bindPopup(`<b>Tracking began here</b><br/><span class="row-sub mono">${timeAgo(s.recorded_at)}</span><br/><span class="row-sub">No start pin set \u2014 this is the first live location recorded.</span>`);
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

      // Real road route between the two points, when both exist. Falls back to a
      // straight direction line if the routing service is unreachable/slow -- the
      // fallback is still built from the same two real coordinates, never invented ones.
      let routeFallback = false;
      if (startPoint && destPoint) {
        const routeResult = await fetchRoadRoute(startPoint, destPoint);
        if (routeResult) {
          tripRouteLine = L.polyline(routeResult.latlngs, { color: '#7c3aed', weight: 4, opacity: 0.75 }).addTo(tripMap);
          routeResult.latlngs.forEach((p) => bounds.push(p));
          renderDirections(routeResult);
        } else {
          routeFallback = true;
          tripRouteLine = L.polyline([startPoint, destPoint], {
            color: '#7c3aed',
            weight: 3,
            opacity: 0.55,
            dashArray: '2 10',
            lineCap: 'round'
          }).addTo(tripMap);
          renderDirections(null);
        }
      } else {
        renderDirections(null);
      }

      updateMapEmptyNote(!!startPoint, !!destPoint, routeFallback);

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

// ===== Start point pin editor (leader-only) -- mirrors the destination editor exactly.
// "Use my current location" makes sense HERE (you're presumably about to depart from
// where you're standing), unlike at trip-creation time where you aren't at either point
// yet -- that's why the create-trip form only offers manual entry.
function renderStartEditor(trip) {
  const card = document.getElementById('trip-start-editor-card');
  const trigger = document.getElementById('trip-start-edit-trigger');
  const hasStart = trip.start_lat != null && trip.start_lng != null;

  if (!currentTripIsLeader) {
    card.classList.add('hidden');
    trigger.classList.add('hidden');
    return;
  }

  document.getElementById('trip-start-editor-name').textContent = trip.start_point;
  document.getElementById('trip-start-editor-lat').value = hasStart ? trip.start_lat : '';
  document.getElementById('trip-start-editor-lng').value = hasStart ? trip.start_lng : '';
  document.getElementById('trip-start-editor-error').classList.add('hidden');

  if (hasStart) {
    card.classList.add('hidden');
    trigger.classList.remove('hidden');
  } else {
    card.classList.remove('hidden');
    trigger.classList.add('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

document.getElementById('trip-start-edit-trigger').addEventListener('click', () => {
  document.getElementById('trip-start-editor-card').classList.remove('hidden');
  document.getElementById('trip-start-edit-trigger').classList.add('hidden');
});

document.getElementById('trip-start-editor-use-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Your browser does not support geolocation. Enter coordinates manually.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('trip-start-editor-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('trip-start-editor-lng').value = pos.coords.longitude.toFixed(6);
    },
    () => alert('Could not get your current location. Enter coordinates manually.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.getElementById('trip-start-editor-save').addEventListener('click', async () => {
  const errEl = document.getElementById('trip-start-editor-error');
  errEl.classList.add('hidden');
  const latRaw = document.getElementById('trip-start-editor-lat').value.trim();
  const lngRaw = document.getElementById('trip-start-editor-lng').value.trim();
  if (latRaw === '' || lngRaw === '') {
    errEl.textContent = 'Both latitude and longitude are required to pin a start point.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!currentTripId) return;
  try {
    await Api.patch(`/trips/${currentTripId}/start-point`, { start_lat: parseFloat(latRaw), start_lng: parseFloat(lngRaw) });
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

// Your own rider marker uses your real profile photo (falls back to your initials on a
// plain colored circle if you don't have one set, or if the image fails to load) --
// distinguishes "you" from other riders' plain colored dots at a glance.
function avatarMarkerIcon(user) {
  const path = user.profile_pic_url ? user.profile_pic_url.replace('/api', '') : null;
  const src = path ? `${window.APP_CONFIG.API_BASE}${path}?token=${encodeURIComponent(Api.accessToken())}` : null;
  const fallback = `<div style="width:100%;height:100%;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;font-family:'Poppins',sans-serif;">${escapeHtml(initials(user.name))}</div>`;
  const inner = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />${fallback.replace('style="width', 'style="display:none;width')}`
    : fallback;
  return L.divIcon({
    className: '',
    html: `<div style="width:38px;height:38px;border-radius:50%;border:3px solid #2563eb;box-shadow:0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.35);overflow:hidden;background:#fff;">${inner}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
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
    if (navMode && uid !== ME.id) {
      // Focused navigation mode: hide every other rider's marker (start/destination/
      // route stay visible) so the map shows only your own route.
      if (tripMarkers[uid]) {
        tripMap.removeLayer(tripMarkers[uid]);
        delete tripMarkers[uid];
      }
      return;
    }
    const loc = tripLocationsById[uid];
    const member = memberById[uid];
    if (!member) return;
    const isLive = !!member.is_sharing_location;
    const dist = distanceFromMeKm(uid);
    const icon = uid === ME.id ? avatarMarkerIcon(ME) : undefined;
    upsertMarker(tripMap, tripMarkers, uid, loc.lat, loc.lng, riderPopupHtml(member, isLive, dist), '#2563eb', icon);
  });
  updateMyLocationReadout();
  updateNavigationBanner();
  if (mapFollowMe && tripLocationsById[ME.id]) {
    const mine = tripLocationsById[ME.id];
    tripMap.panTo([mine.lat, mine.lng], { animate: true });
  }
}

// ===== Recenter to me / Follow me =====
// Shows exactly where the rider's own live coordinates are (proves updates are really
// arriving), and a button to jump the map back to them instead of hunting by hand.
function updateMyLocationReadout() {
  const el = document.getElementById('trip-my-location-readout');
  if (!el) return;
  const mine = tripLocationsById[ME.id];
  if (!mine) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = `You: <span class="mono">${mine.lat.toFixed(5)}, ${mine.lng.toFixed(5)}</span> \u00B7 updated ${timeAgo(mine.updated_at)}`;
  el.classList.remove('hidden');
}

function setMapFollowMe(on) {
  mapFollowMe = on;
  const btn = document.getElementById('trip-locate-btn');
  if (btn) btn.classList.toggle('following', on);
}

document.getElementById('trip-locate-btn').addEventListener('click', () => {
  const mine = tripLocationsById[ME.id];
  if (mine && tripMap) {
    setMapFollowMe(true);
    suppressFollowCancel = true;
    // Force a re-measure first: if the map container's on-screen size changed since
    // Leaflet last checked (e.g. right after switching into this view, or toggling full
    // screen), setView's centering math can be based on a stale size and appear to do
    // nothing.
    tripMap.invalidateSize();
    tripMap.setView([mine.lat, mine.lng], Math.max(tripMap.getZoom(), 15), { animate: true });
    setTimeout(() => {
      suppressFollowCancel = false;
    }, 500);
    return;
  }
  // Not sharing yet on this trip -- a one-off position read to recenter, without
  // committing to continuous sharing (that's a separate, explicit action).
  if (!navigator.geolocation) {
    alert('Your browser does not support geolocation.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (!tripMap) return;
      tripMap.setView([pos.coords.latitude, pos.coords.longitude], 15, { animate: true });
    },
    () => alert('Could not get your current location. Share your location on this trip to be tracked live.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

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
            const statusBadge = m.reached_at
              ? '<span class="live-badge" style="color:var(--green);"><i data-lucide="flag" class="icon icon-sm"></i>Reached</span>'
              : `<span class="live-badge ${isLive ? 'is-live' : 'is-offline'}"><span class="pulse-dot ${isLive ? '' : 'offline'}" style="width:7px;height:7px;"></span>${isLive ? 'Live' : 'Offline'}</span>`;
            return `
      <div class="rider-row" data-rider-id="${m.id}">
        ${avatarHtml(m)}
        <div class="rider-id-block">
          <div class="row-title">${escapeHtml(m.name)}${m.id === currentTripLeaderId ? ' <span class="tag active">Leader</span>' : ''}</div>
          <div class="row-sub">@${escapeHtml(m.username)} · Rider ID: ${m.id.slice(0, 8).toUpperCase()}</div>
        </div>
        <div class="rider-status-block">
          ${statusBadge}
          <span class="rider-distance">${distText}</span>
        </div>
      </div>`;
          })
          .join('');
  if (window.lucide) lucide.createIcons();
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

function startTripLocationSharing(tripId) {
  if (tripLocationInterval) clearInterval(tripLocationInterval);
  if (tripGeoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(tripGeoWatchId);
    tripGeoWatchId = null;
  }
  const sendPos = (lat, lng) => {
    socket.emit('trip:location:update', { trip_id: tripId, lat, lng });
    Api.post(`/trips/${tripId}/location`, { lat, lng }).catch(() => {});
  };
  if (navigator.geolocation) {
    tripGeoWatchId = navigator.geolocation.watchPosition(
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
socket.on('trip:member:reached', (payload) => {
  if (payload.trip_id !== currentTripId) return;
  const member = currentTripMembers.find((m) => m.id === payload.user_id);
  if (member) member.reached_at = payload.reached_at;
  renderRiderList(currentTripMembers);
});
socket.on('trip:need-stop', (payload) => {
  if (payload.trip_id !== currentTripId || payload.user_id === ME.id) return;
  alert(`\u26A0\uFE0F ${payload.name} needs to stop the ride.`);
});
socket.on('trip:destination:update', (payload) => {
  if (payload.trip_id !== currentTripId || !currentTrip) return;
  currentTrip.dest_lat = payload.dest_lat;
  currentTrip.dest_lng = payload.dest_lng;
  renderDestinationEditor(currentTrip);
  initTripMap(currentTripId, currentTrip);
});
socket.on('trip:start-point:update', (payload) => {
  if (payload.trip_id !== currentTripId || !currentTrip) return;
  currentTrip.start_lat = payload.start_lat;
  currentTrip.start_lng = payload.start_lng;
  renderStartEditor(currentTrip);
  initTripMap(currentTripId, currentTrip);
});
socket.on('trip:member:joined', (payload) => {
  if (payload.trip_id === currentTripId) openTripDetail(currentTripId);
});
socket.on('trip:completed', (payload) => {
  if (payload.trip_id === currentTripId) openTripDetail(currentTripId);
  loadTrips();
});
socket.on('trip:started', (payload) => {
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
