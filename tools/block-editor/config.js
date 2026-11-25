export const ADMIN_URLS = {
  stage: 'https://stage-admin.da.live',
  prod: 'https://admin.da.live',
};

export function validateBase(value, fallback) {
  const url = new URL(value || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash) throw new Error('Asset bases must be HTTP(S) URLs without credentials, query, or hash.');
  return url.href.replace(/\/$/, '');
}

export function getConfig(search = window.location.search, hostname = window.location.hostname) {
  const params = new URLSearchParams(search);
  const config = {
    live: validateBase(params.get('live'), 'https://da.live'),
    ref: params.get('ref') || 'main',
    admin: validateBase(params.get('admin'), isLocalHost(hostname) ? ADMIN_URLS.stage : ADMIN_URLS.prod),
  };
  if (params.has('library')) config.library = validateBase(params.get('library'));
  return config;
}

export const config = typeof window === 'undefined' ? null : getConfig();
export function isLocalHost(hostname = window.location.hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

export function setAdminEnvironment(admin, location = window.location) {
  const url = new URL(location.href);
  if (!isLocalHost(url.hostname) || !Object.values(ADMIN_URLS).includes(admin)) {
    throw new Error('Admin environment selection requires a local host and a stage or prod admin URL.');
  }
  url.searchParams.set('admin', admin);
  location.assign(url.href);
}
