const SESSION_CACHE_KEY = 'brand-visibility:spacecat-session:v1';
const EXPIRY_LEEWAY_MS = 30_000;

function sessionTokenExpiry(sessionToken) {
  try {
    const [, encodedPayload] = sessionToken.split('.');
    if (!encodedPayload) return null;
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const { exp } = JSON.parse(atob(padded));
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fingerprint(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function defaultSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function removeCachedSession(storage) {
  try {
    storage?.removeItem(SESSION_CACHE_KEY);
  } catch {
    // Storage can be disabled or unavailable in a privacy-restricted iframe.
  }
}

function readCachedSession(storage, apiBase, accessTokenHash, now) {
  if (!storage) return null;
  try {
    const cached = JSON.parse(storage.getItem(SESSION_CACHE_KEY));
    if (cached?.apiBase !== apiBase || cached?.accessTokenHash !== accessTokenHash) return null;

    const expiresAt = sessionTokenExpiry(cached.sessionToken);
    if (!expiresAt || expiresAt <= now() + EXPIRY_LEEWAY_MS) {
      removeCachedSession(storage);
      return null;
    }
    return cached.sessionToken;
  } catch {
    removeCachedSession(storage);
    return null;
  }
}

function cacheSession(storage, record) {
  if (!storage) return;
  try {
    storage.setItem(SESSION_CACHE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be disabled or unavailable in a privacy-restricted iframe.
  }
}

/**
 * Exchanges an IMS access token for a SpaceCat session token. The returned JWT
 * is cached for the current browser tab and reused until shortly before expiry.
 */
export async function getSpacecatSessionToken(apiBase, accessToken, {
  fetchImpl = fetch,
  storage = defaultSessionStorage(),
  now = Date.now,
} = {}) {
  if (!accessToken) throw new Error('No Experience Workspace access token is available');

  const normalizedApiBase = apiBase.replace(/\/$/, '');
  const accessTokenHash = await fingerprint(accessToken);
  const cached = readCachedSession(storage, normalizedApiBase, accessTokenHash, now);
  if (cached) return cached;

  const response = await fetchImpl(`${normalizedApiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  if (!response.ok) throw new Error(`Session token exchange failed (HTTP ${response.status})`);

  const { sessionToken } = await response.json();
  if (typeof sessionToken !== 'string' || !sessionToken) {
    throw new Error('Session token exchange returned no session token');
  }

  const expiresAt = sessionTokenExpiry(sessionToken);
  if (expiresAt && expiresAt > now() + EXPIRY_LEEWAY_MS) {
    cacheSession(storage, {
      apiBase: normalizedApiBase,
      accessTokenHash,
      sessionToken,
      expiresAt,
    });
  }
  return sessionToken;
}

export { sessionTokenExpiry };
