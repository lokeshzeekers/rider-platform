(function () {
  if (Api.accessToken()) {
    const user = Api.getUser();
    window.location.href = user && user.role === 'super_admin' ? 'super-admin.html' : 'dashboard.html';
    return;
  }

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const recoveryPanel = document.getElementById('recovery-panel');
  const superAdminForm = document.getElementById('super-admin-form');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');

  function hideAll() {
    [loginForm, registerForm, recoveryPanel, superAdminForm].forEach((el) => el.classList.add('hidden'));
  }
  function showLogin() {
    hideAll();
    loginForm.classList.remove('hidden');
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    const savedOrg = Api.getOrgCode();
    if (savedOrg) document.getElementById('login-orgcode').value = savedOrg;
  }
  function showRegister() {
    hideAll();
    registerForm.classList.remove('hidden');
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
  }

  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);

  document.getElementById('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    hideAll();
    recoveryPanel.classList.remove('hidden');
  });
  document.getElementById('back-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
  });
  document.getElementById('super-admin-link').addEventListener('click', (e) => {
    e.preventDefault();
    hideAll();
    superAdminForm.classList.remove('hidden');
  });
  document.getElementById('back-from-sa').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    try {
      const org_code = document.getElementById('login-orgcode').value.trim().toLowerCase();
      const identifier = document.getElementById('login-identifier').value.trim();
      const password = document.getElementById('login-password').value;
      const data = await Api.post('/auth/login', { org_code, identifier, password });
      Api.setTokens(data);
      Api.setUser(data.user);
      Api.setOrgCode(org_code);
      window.location.href = 'dashboard.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  superAdminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('sa-error');
    errorEl.classList.add('hidden');
    try {
      const identifier = document.getElementById('sa-identifier').value.trim();
      const password = document.getElementById('sa-password').value;
      const data = await Api.post('/auth/super-admin/login', { identifier, password });
      Api.setTokens(data);
      Api.setUser(data.user);
      window.location.href = 'super-admin.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    errorEl.classList.add('hidden');
    try {
      const org_code = document.getElementById('reg-orgcode').value.trim().toLowerCase();
      const payload = {
        org_code,
        name: document.getElementById('reg-name').value.trim(),
        username: document.getElementById('reg-username').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        phone: document.getElementById('reg-phone').value.trim(),
        password: document.getElementById('reg-password').value
      };
      const data = await Api.post('/auth/register', payload);
      Api.setTokens(data);
      Api.setUser(data.user);
      Api.setOrgCode(org_code);
      window.location.href = 'dashboard.html';
    } catch (err) {
      errorEl.textContent = err.details ? err.details.map((d) => d.message).join(' · ') : err.message;
      errorEl.classList.remove('hidden');
    }
  });

  // --- Recovery ---
  const recTabUser = document.getElementById('rec-tab-user');
  const recTabPass = document.getElementById('rec-tab-pass');
  const recUserPanel = document.getElementById('rec-user-panel');
  const recPassPanel = document.getElementById('rec-pass-panel');

  recTabUser.addEventListener('click', () => {
    recTabUser.classList.add('active'); recTabPass.classList.remove('active');
    recUserPanel.classList.remove('hidden'); recPassPanel.classList.add('hidden');
  });
  recTabPass.addEventListener('click', () => {
    recTabPass.classList.add('active'); recTabUser.classList.remove('active');
    recPassPanel.classList.remove('hidden'); recUserPanel.classList.add('hidden');
  });

  document.getElementById('rec-user-submit').addEventListener('click', async () => {
    const org_code = document.getElementById('rec-orgcode').value.trim().toLowerCase();
    const val = document.getElementById('rec-email').value.trim();
    const result = document.getElementById('rec-user-result');
    try {
      const data = await Api.post('/auth/forgot-username', { org_code, email_or_phone: val });
      result.textContent = data.message;
      result.classList.remove('hidden');
    } catch (err) {
      result.textContent = err.message;
      result.classList.remove('hidden');
    }
  });

  document.getElementById('rec-pass-submit').addEventListener('click', async () => {
    const org_code = document.getElementById('rec-orgcode').value.trim().toLowerCase();
    const identifier = document.getElementById('rec-identifier').value.trim();
    const result = document.getElementById('rec-pass-result');
    try {
      const data = await Api.post('/auth/forgot-password', { org_code, identifier });
      result.textContent = data.message;
      result.classList.remove('hidden');
    } catch (err) {
      result.textContent = err.message;
      result.classList.remove('hidden');
    }
  });
})();
