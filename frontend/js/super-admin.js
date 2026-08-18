if (!Api.accessToken()) window.location.href = 'index.html';
const ME_SA = Api.getUser();
if (!ME_SA || ME_SA.role !== 'super_admin') {
  alert('Super Admin access required.');
  window.location.href = 'index.html';
}

document.getElementById('sa-logout').addEventListener('click', async () => {
  try { await Api.post('/auth/logout', { refresh_token: Api.refreshToken() }); } catch {}
  Api.clearTokens();
  window.location.href = 'index.html';
});

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ssections = ['summary', 'organizations', 'users', 'plans', 'audit'];
function showSSection(name) {
  ssections.forEach((s) => document.getElementById(`ssection-${s}`).classList.toggle('hidden', s !== name));
  document.querySelectorAll('.nav-item[data-ssection]').forEach((b) => b.classList.toggle('active', b.dataset.ssection === name));
  document.getElementById('ssection-heading').textContent = document.querySelector(`[data-ssection="${name}"]`).textContent.trim();
  if (name === 'summary') loadPlatformSummary();
  if (name === 'organizations') loadOrganizations();
  if (name === 'users') loadPlatformUsers();
  if (name === 'plans') loadPlans();
  if (name === 'audit') loadAuditLog();
}
document.querySelectorAll('.nav-item[data-ssection]').forEach((b) => b.addEventListener('click', () => showSSection(b.dataset.ssection)));

// ===== Summary =====
async function loadPlatformSummary() {
  const d = await Api.get('/super-admin/summary');
  document.getElementById('p-total-orgs').textContent = d.totalOrgs;
  document.getElementById('p-active-orgs').textContent = d.activeOrgs;
  document.getElementById('p-disabled-orgs').textContent = d.disabledOrgs;
  document.getElementById('p-total-users').textContent = d.totalUsers;
  document.getElementById('p-live-riders').textContent = d.liveRiders;
  document.getElementById('p-active-trips').textContent = d.activeTrips;

  const el = document.getElementById('plan-distribution');
  el.innerHTML = d.planDistribution
    .map((p) => `<div class="row"><div class="row-title">${esc(p.name)}</div><div class="row-actions mono">${p.org_count} org(s)</div></div>`)
    .join('') || '<div class="empty-state">No plans configured.</div>';
}

// ===== Organizations =====
document.getElementById('org-create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await Api.post('/super-admin/organizations', {
      name: document.getElementById('new-org-name').value.trim(),
      slug: document.getElementById('new-org-slug').value.trim().toLowerCase()
    });
    e.target.reset();
    loadOrganizations();
  } catch (err) {
    alert(err.message);
  }
});

let orgSearchDebounce = null;
document.getElementById('org-search').addEventListener('input', (e) => {
  clearTimeout(orgSearchDebounce);
  orgSearchDebounce = setTimeout(() => loadOrganizations(e.target.value.trim()), 300);
});

async function loadOrganizations(q = '') {
  const el = document.getElementById('organizations-list');
  const d = await Api.get(`/super-admin/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  el.innerHTML =
    d.organizations.length === 0
      ? '<div class="empty-state">No organizations yet — create one above.</div>'
      : d.organizations
          .map(
            (o) => `
    <div class="card" style="cursor:pointer;margin-bottom:8px;" data-open-org="${o.id}">
      <div class="topbar" style="margin-bottom:4px;">
        <div class="row-title">${esc(o.name)}</div>
        <span class="tag ${o.status === 'active' ? 'completed' : 'cancelled'}">${o.status}</span>
      </div>
      <div class="row-sub mono">${esc(o.slug)} · ${o.user_count} user(s)</div>
    </div>`
          )
          .join('');
}

document.getElementById('organizations-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-open-org]');
  if (card) openOrgDetail(card.dataset.openOrg);
});

let currentOrgId = null;
async function openOrgDetail(orgId) {
  currentOrgId = orgId;
  const panel = document.getElementById('org-detail');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth' });

  const d = await Api.get(`/super-admin/organizations/${orgId}`);
  document.getElementById('org-detail-name').textContent = d.organization.name;
  document.getElementById('org-detail-status').textContent = d.organization.status;
  document.getElementById('org-detail-status').className = `tag ${d.organization.status === 'active' ? 'completed' : 'cancelled'}`;
  document.getElementById('org-detail-code').textContent = d.organization.slug;
  document.getElementById('org-detail-users').textContent = d.stats.userCount;
  document.getElementById('org-detail-trips').textContent = d.stats.tripCount;
  document.getElementById('org-detail-live').textContent = d.stats.liveRiders;

  const toggleBtn = document.getElementById('org-detail-toggle');
  toggleBtn.textContent = d.organization.status === 'active' ? 'Deactivate organization' : 'Activate organization';
  toggleBtn.className = `btn small ${d.organization.status === 'active' ? 'danger' : 'primary'}`;
  toggleBtn.onclick = async () => {
    const action = d.organization.status === 'active' ? 'deactivate' : 'activate';
    if (action === 'deactivate' && !confirm(`Deactivate ${d.organization.name}? All its members will be locked out immediately.`)) return;
    await Api.post(`/super-admin/organizations/${orgId}/${action}`);
    openOrgDetail(orgId);
    loadOrganizations();
  };

  document.getElementById('org-detail-admins').innerHTML =
    d.admins.length === 0
      ? '<div class="empty-state">No org admins yet — create one below.</div>'
      : d.admins
          .map(
            (a) => `<div class="row"><div class="avatar">${esc((a.name || '?')[0])}</div><div><div class="row-title">${esc(a.name)}</div><div class="row-sub">@${esc(a.username)} · ${esc(a.email)}</div></div><span class="tag ${a.status === 'active' ? 'completed' : 'cancelled'}" style="margin-left:auto;">${a.status}</span></div>`
          )
          .join('');
}

document.getElementById('create-admin-btn').addEventListener('click', async () => {
  if (!currentOrgId) return;
  try {
    await Api.post(`/super-admin/organizations/${currentOrgId}/admins`, {
      username: document.getElementById('new-admin-username').value.trim(),
      name: document.getElementById('new-admin-name').value.trim(),
      email: document.getElementById('new-admin-email').value.trim(),
      phone: document.getElementById('new-admin-phone').value.trim(),
      password: document.getElementById('new-admin-password').value
    });
    ['new-admin-username', 'new-admin-name', 'new-admin-email', 'new-admin-phone', 'new-admin-password'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    openOrgDetail(currentOrgId);
    alert('Organization admin created. Share the org code and temporary password with them directly.');
  } catch (err) {
    alert(err.message);
  }
});

// ===== Platform-wide users =====
let platformUserSearchDebounce = null;
document.getElementById('platform-user-search').addEventListener('input', (e) => {
  clearTimeout(platformUserSearchDebounce);
  platformUserSearchDebounce = setTimeout(() => loadPlatformUsers(e.target.value.trim()), 300);
});

async function loadPlatformUsers(q = '') {
  const el = document.getElementById('platform-users-list');
  const d = await Api.get(`/super-admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
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
          <div class="row-title">${esc(u.name)} <span class="tag ${u.status === 'active' ? 'completed' : 'cancelled'}">${u.status}</span></div>
          <div class="row-sub">@${esc(u.username)} · ${esc(u.email)} · ${u.role}</div>
          <div class="row-sub mono">${u.org_name ? `${esc(u.org_name)} (${esc(u.org_slug)})` : 'Platform account'}</div>
        </div>
        <div class="row-actions">
          ${u.status === 'active' ? `<button class="btn small danger" data-disable="${u.id}">Disable</button>` : `<button class="btn small primary" data-enable="${u.id}">Enable</button>`}
        </div>
      </div>
    </div>`
          )
          .join('');
}
document.getElementById('platform-users-list').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.disable) await Api.post(`/super-admin/users/${t.dataset.disable}/disable`);
    else if (t.dataset.enable) await Api.post(`/super-admin/users/${t.dataset.enable}/enable`);
    else return;
    loadPlatformUsers(document.getElementById('platform-user-search').value.trim());
  } catch (err) {
    alert(err.message);
  }
});

// ===== Plans (dormant) =====
async function loadPlans() {
  const el = document.getElementById('plans-list');
  const d = await Api.get('/super-admin/plans');
  el.innerHTML = d.plans
    .map(
      (p) => `
    <div class="card" style="margin-bottom:8px;">
      <div class="topbar" style="margin-bottom:4px;">
        <div class="row-title">${esc(p.name)} <span class="row-sub mono">(${esc(p.code)})</span></div>
        <span class="tag ${p.is_active ? 'completed' : 'cancelled'}">${p.is_active ? 'active' : 'inactive'}</span>
      </div>
      <div class="row-sub">${esc(p.description)}</div>
      <div class="row-sub mono">₹${(p.price_cents / 100).toFixed(2)} / ${esc(p.billing_interval)}</div>
    </div>`
    )
    .join('');
}

// ===== Audit log =====
async function loadAuditLog() {
  const el = document.getElementById('audit-list');
  const d = await Api.get('/super-admin/audit-logs');
  el.innerHTML =
    d.logs.length === 0
      ? '<div class="empty-state">No administrative actions recorded yet.</div>'
      : d.logs
          .map(
            (l) => `
    <div class="row">
      <div>
        <div class="row-title">${esc(l.action)} <span class="row-sub">${esc(l.target_type || '')} ${esc(l.target_id || '')}</span></div>
        <div class="row-sub mono">by ${esc(l.actor_role)} · ${timeAgo(l.created_at)}</div>
      </div>
    </div>`
          )
          .join('');
}

showSSection('summary');
