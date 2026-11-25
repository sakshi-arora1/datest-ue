export function parseOrgSite(raw) {
  const normalized = (raw || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  return { org: parts[0], site: parts[1] };
}

export function hasEwEnabled(json) {
  if (!json) return false;
  const flagRows = json.flags?.data;
  if (!Array.isArray(flagRows)) return false;
  return flagRows.some((r) => r.key === 'ew.enabled' && String(r.value).toLowerCase() === 'true');
}

function syncConfigMeta(cfg) {
  const names = Object.keys(cfg).filter(
    (k) => !k.startsWith(':') && cfg[k] !== null && typeof cfg[k] === 'object',
  );
  if (names.length) {
    cfg[':names'] = names;
    cfg[':type'] = 'multi-sheet';
  }
  return cfg;
}

export function buildConfigWithEwEnabled(existingJson) {
  const newRow = { key: 'ew.enabled', value: 'true' };
  const result = { ...(existingJson ?? {}) };
  const existingFlags = Array.isArray(result.flags?.data) ? result.flags.data : [];
  const filtered = existingFlags.filter((r) => r.key !== 'ew.enabled');
  result.flags = { ...(result.flags ?? {}), data: [...filtered, newRow] };
  return syncConfigMeta(result);
}

const SIDEKICK_EDIT_URL = 'https://da.live/canvas#/{{org}}/{{site}}{{pathname}}';

export function hasCorrectSidekickConfig(json) {
  return json?.editUrlPattern === SIDEKICK_EDIT_URL;
}

export function buildUpdatedSidekickConfig(existingJson) {
  if (!existingJson) return { project: 'Experience Workspace Project', editUrlPattern: SIDEKICK_EDIT_URL };
  return { ...existingJson, editUrlPattern: SIDEKICK_EDIT_URL };
}
