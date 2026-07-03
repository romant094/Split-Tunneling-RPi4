const LOGIN_STORAGE_KEY = 'sg_auth';

export function getAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(LOGIN_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setAuth(user, pass) {
  sessionStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify({ user, pass }));
}

export function clearAuth() {
  sessionStorage.removeItem(LOGIN_STORAGE_KEY);
}

export function getAuthHeader() {
  const auth = getAuth();
  if (!auth) return '';
  return 'Basic ' + btoa(auth.user + ':' + auth.pass);
}

export async function apiFetch(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
      ...(options.headers || {}),
    },
  });
  if (resp.status === 401) {
    clearAuth();
    window.location.reload();
  }
  return resp;
}

export async function apiLogout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  clearAuth();
}
