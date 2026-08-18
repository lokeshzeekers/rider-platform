// Point this at wherever the backend is running.
// In production (behind Nginx at track.zeekerstech.com) these should be same-origin paths,
// e.g. API_BASE: '/api', SOCKET_URL: window.location.origin.
window.APP_CONFIG = {
  API_BASE: 'http://localhost:4000/api',
  SOCKET_URL: 'http://localhost:4000'
};
