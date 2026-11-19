/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable import/no-unresolved */

const { getDaAdmin } = await import('https://da.live/nx/public/utils/constants.js');
const DA_ADMIN = getDaAdmin();

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

const encodePath = (path) => path.split('/').map((s) => encodeURIComponent(s)).join('/');

export function sourceUrl(org, site, path) {
  return `${DA_ADMIN}/source/${encodeURIComponent(org)}/${encodeURIComponent(site)}${encodePath(path)}`;
}

/** Returns `{ text, canWrite }`, `null` when the source file does not exist. */
export async function getSource(org, site, path) {
  const resp = await daFetch(`${sourceUrl(org, site, path)}?nocache=${Date.now()}`, { cache: 'no-store' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Unable to load ${path} (HTTP ${resp.status}).`);
  const text = await resp.text();
  const { permissions } = resp;
  const canWrite = Array.isArray(permissions) ? permissions.includes('write') : true;
  return { text, canWrite };
}

/** Stores a source file (for example a Structured Content document as `text/html`). */
export async function saveSource(org, site, path, text, type = 'text/html') {
  const body = new FormData();
  body.append('data', new Blob([text], { type }));
  const resp = await daFetch(sourceUrl(org, site, path), { method: 'POST', body });
  if (!resp.ok) throw new Error(`Unable to save ${path} (HTTP ${resp.status}).`);
}

/**
 * Lists the files with extension `ext` under `path`, recursively, as `{ path, lastModified }`
 * (paths with their extension). Hidden folders (such as `/.da`, which holds DA configuration)
 * are skipped.
 */
export async function listFiles(org, site, ext, path = '/') {
  const resp = await daFetch(`${DA_ADMIN}/list/${encodeURIComponent(org)}/${encodeURIComponent(site)}${encodePath(path)}`);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Unable to list ${path} (HTTP ${resp.status}).`);
  const items = await resp.json();
  if (!Array.isArray(items)) return [];
  const files = items
    .filter((item) => typeof item.ext === 'string' && item.ext.replace(/^\./, '').toLowerCase() === ext)
    .map((item) => ({ path: `${path}${item.name}.${ext}`, lastModified: item.lastModified }));
  const nested = await Promise.all(items
    .filter((item) => !item.ext && !String(item.name).startsWith('.'))
    .map((folder) => listFiles(org, site, ext, `${path}${folder.name}/`)));
  return [...files, ...nested.flat()].sort((a, b) => a.path.localeCompare(b.path));
}
