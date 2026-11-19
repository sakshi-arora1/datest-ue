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
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { FORM_SCHEMAS } from './forms.js';
import scanForms from './scan.js';

const NX = 'https://da.live/nx2';
let nexter = null;
let styles = null;

try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await loadStyle(`${NX}/styles/styles.css`);
  [nexter, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

function readLocation(context) {
  const params = new URLSearchParams(window.location.search);
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appIndex = parts.indexOf('app');
  return {
    org: (context?.org || params.get('org') || (appIndex >= 0 ? parts[appIndex + 1] : '') || '').trim(),
    site: (context?.repo || params.get('site') || (appIndex >= 0 ? parts[appIndex + 2] : '') || '').trim(),
    ref: (context?.ref || params.get('ref') || 'main').trim(),
  };
}

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
};

class FormsManagerApp extends LitElement {
  static properties = {
    context: { attribute: false },
    _status: { state: true },
    _error: { state: true },
    _forms: { state: true },
    _scanned: { state: true },
    _total: { state: true },
    _unreadable: { state: true },
    _query: { state: true },
    _kind: { state: true },
  };

  constructor() {
    super();
    this._status = 'idle';
    this._forms = [];
    this._scanned = 0;
    this._total = 0;
    this._unreadable = 0;
    this._query = '';
    this._kind = '';
    this._scanId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, styles].filter(Boolean);
    const { org, site, ref } = readLocation(this.context);
    Object.assign(this, { _org: org, _site: site, _ref: ref });
    if (!org || !site) {
      this._status = 'error';
      this._error = 'Open the Forms Manager from a site: /app/{org}/{site}/tools/apps/formsmanager/formsmanager';
      return;
    }
    this.scan();
  }

  /** Lists every JSON file of the site and keeps the form and form fragment documents. */
  async scan() {
    this._scanId += 1;
    const scanId = this._scanId;
    this._status = 'scanning';
    this._error = '';
    this._forms = [];
    this._scanned = 0;
    this._total = 0;
    this._unreadable = 0;
    const current = () => scanId === this._scanId;
    try {
      await scanForms(this._org, this._site, {
        isCancelled: () => !current(),
        onProgress: ({ scanned, total, unreadable }) => {
          Object.assign(this, { _scanned: scanned, _total: total, _unreadable: unreadable });
        },
        onForm: (form) => {
          this._forms = [...this._forms, form].sort((a, b) => a.path.localeCompare(b.path));
        },
      });
      if (scanId === this._scanId) this._status = 'done';
    } catch (e) {
      if (scanId !== this._scanId) return;
      this._status = 'error';
      this._error = e.message;
    }
  }

  editorUrl(path) {
    const params = new URLSearchParams();
    if (this._ref && this._ref !== 'main') params.set('ref', this._ref);
    params.set('path', path);
    const app = `/app/${encodeURIComponent(this._org)}/${encodeURIComponent(this._site)}/tools/apps/formeditor/formeditor`;
    return `https://da.live${app}?${params}`;
  }

  get visibleForms() {
    const query = this._query.trim().toLowerCase();
    return this._forms.filter((form) => (!this._kind || form.schemaName === this._kind)
      && (!query || form.path.toLowerCase().includes(query)
        || form.title.toLowerCase().includes(query)));
  }

  renderToolbar() {
    const counts = Object.keys(FORM_SCHEMAS)
      .map((schema) => [schema, this._forms.filter((f) => f.schemaName === schema).length]);
    return html`
      <header class="toolbar">
        <div>
          <h1>Forms Manager</h1>
          <p class="subtitle">Form and form fragment documents in <code>${this._org}/${this._site}</code></p>
        </div>
        <div class="controls">
          <label class="visually-hidden" for="search">Search forms</label>
          <input id="search" type="search" placeholder="Search by name or title" .value=${this._query}
            @input=${(e) => { this._query = e.target.value; }}>
          <div class="segmented" role="group" aria-label="Type">
            ${[['', 'All', this._forms.length], ...counts.map(([schema, n]) => [schema, FORM_SCHEMAS[schema] === 'Form' ? 'Forms' : 'Fragments', n])]
    .map(([value, label, n]) => html`<button type="button" class="segment ${this._kind === value ? 'is-selected' : ''}"
              aria-pressed=${this._kind === value} @click=${() => { this._kind = value; }}>${label} <span class="count">${n}</span></button>`)}
          </div>
          <button type="button" class="quiet-btn" ?disabled=${this._status === 'scanning'} @click=${() => this.scan()}>
            ${this._status === 'scanning' ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </header>
    `;
  }

  renderStatus() {
    if (this._status === 'error') return html`<p class="message error" role="alert">${this._error}</p>`;
    const progress = this._status === 'scanning'
      ? `Scanning ${this._scanned} of ${this._total || '…'} JSON files…`
      : `Scanned ${this._total} JSON files.`;
    return html`<p class="status" role="status" aria-live="polite">${progress}
      ${this._unreadable ? html` <span class="warn">${this._unreadable} could not be read.</span>` : nothing}</p>`;
  }

  renderTable() {
    const forms = this.visibleForms;
    if (!forms.length) {
      if (this._status === 'scanning') return nothing;
      return html`<p class="empty">${this._forms.length ? 'No forms match.' : 'No form or form fragment documents found. A form document is a JSON document with "metadata": { "schemaName": "adaptive-form" } (or "adaptive-form-fragment").'}</p>`;
    }
    return html`
      <div class="table-wrap">
        <table>
          <caption class="visually-hidden">Form and form fragment documents</caption>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col" class="num">Fields</th>
              <th scope="col">Modified</th>
              <th scope="col"><span class="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${forms.map((form) => html`
              <tr>
                <th scope="row" class="doc">${form.path}</th>
                <td>${form.title || html`<span class="muted">—</span>`}</td>
                <td><span class="badge ${form.kind === 'Fragment' ? 'is-fragment' : ''}">${form.kind}</span></td>
                <td class="num">${form.fields}</td>
                <td class="muted">${formatDate(form.lastModified)}</td>
                <td class="actions">
                  <a class="action" href=${this.editorUrl(form.path)} target="_top"
                    aria-label="Edit ${form.title || form.path} in the Form Editor">Edit</a>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderToolbar()}
      ${this._status === 'idle' ? nothing : this.renderStatus()}
      ${this.renderTable()}
    `;
  }
}

customElements.define('formsmanager-app', FormsManagerApp);

(async function init() {
  const { context } = await DA_SDK;
  if (document.readyState === 'loading') {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  const cmp = document.createElement('formsmanager-app');
  cmp.context = context;
  document.body.append(cmp);
}());
