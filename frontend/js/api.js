const Api = (() => {
  const BASE = window.APP_CONFIG.API_BASE;
  let refreshInFlight = null;

  function accessToken() {
    return localStorage.getItem('rp_access_token');
  }
  function refreshToken() {
    return localStorage.getItem('rp_refresh_token');
  }
  function setTokens({ access_token, refresh_token }) {
    if (access_token) localStorage.setItem('rp_access_token', access_token);
    if (refresh_token) localStorage.setItem('rp_refresh_token', refresh_token);
  }
  function clearTokens() {
    localStorage.removeItem('rp_access_token');
    localStorage.removeItem('rp_refresh_token');
    localStorage.removeItem('rp_user');
    localStorage.removeItem('rp_org_code');
  }
  function setUser(u) {
    localStorage.setItem('rp_user', JSON.stringify(u));
  }
  function getUser() {
    const raw = localStorage.getItem('rp_user');
    return raw ? JSON.parse(raw) : null;
  }
  function setOrgCode(code) {
    localStorage.setItem('rp_org_code', code);
  }
  function getOrgCode() {
    return localStorage.getItem('rp_org_code') || '';
  }

  // Attempts to refresh the access token exactly once even if several requests 401
  // simultaneously -- they all await the same in-flight refresh promise.
  async function tryRefresh() {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const rt = refreshToken();
        if (!rt) throw new Error('No refresh token');
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt })
        });
        if (!res.ok) throw new Error('Refresh failed');
        const data = await res.json();
        setTokens(data);
        return data;
      })().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function request(method, path, body, { isRetry = false, formData = null } = {}) {
    const headers = {};
    const t = accessToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    if (!formData) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 401 && !isRetry && refreshToken()) {
      try {
        await tryRefresh();
        return request(method, path, body, { isRetry: true, formData });
      } catch {
        clearTokens();
        window.location.href = 'index.html';
        throw new Error('Session expired. Please log in again.');
      }
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    postForm: (path, formData) => request('POST', path, undefined, { formData }),
    accessToken,
    refreshToken,
    setTokens,
    clearTokens,
    setUser,
    getUser,
    setOrgCode,
    getOrgCode
  };
})();
