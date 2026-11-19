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

/** Normalizes a document path to `/folder/name.html`. */
export function toDocPath(path) {
  const clean = `/${String(path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return /\.html$/i.test(clean) ? clean : `${clean}.html`;
}

/** Returns `{ html, canWrite }`, `null` when the document does not exist. */
export async function getDocument(org, site, path) {
  const resp = await daFetch(`${sourceUrl(org, site, path)}?nocache=${Date.now()}`, { cache: 'no-store' });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Unable to load ${path} (HTTP ${resp.status}).`);
  const html = await resp.text();
  const { permissions } = resp;
  const canWrite = Array.isArray(permissions) ? permissions.includes('write') : true;
  return { html, canWrite };
}

export async function saveDocument(org, site, path, html) {
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  const resp = await daFetch(sourceUrl(org, site, path), { method: 'POST', body });
  if (!resp.ok) throw new Error(`Unable to save ${path} (HTTP ${resp.status}).`);
}

/** Lists HTML documents under `path`, recursively. */
export async function listDocuments(org, site, path = '/') {
  const resp = await daFetch(`${DA_ADMIN}/list/${encodeURIComponent(org)}/${encodeURIComponent(site)}${encodePath(path)}`);
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Unable to list ${path} (HTTP ${resp.status}).`);
  const items = await resp.json();
  if (!Array.isArray(items)) return [];
  const docs = items
    .filter((item) => typeof item.ext === 'string' && item.ext.replace(/^\./, '').toLowerCase() === 'html')
    .map((item) => `${path}${item.name}.html`);
  const nested = await Promise.all(items.filter((item) => !item.ext)
    .map((folder) => listDocuments(org, site, `${path}${folder.name}/`)));
  return [...docs, ...nested.flat()].sort();
}
