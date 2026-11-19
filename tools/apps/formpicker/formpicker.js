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
import scanForms from '../formsmanager/scan.js';
import { formLink, toEmbedBlockHtml } from './block.js';

const NX = 'https://da.live/nx2';
// form fragments are included in forms, not embedded in pages
const SCHEMAS = ['adaptive-form'];
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
    site: (context?.repo || context?.site || params.get('site') || (appIndex >= 0 ? parts[appIndex + 2] : '') || '').trim(),
  };
}

class FormPickerApp extends LitElement {
  static properties = {
    context: { attribute: false },
    actions: { attribute: false },
    _status: { state: true },
    _error: { state: true },
    _forms: { state: true },
    _progress: { state: true },
    _query: { state: true },
    _selected: { state: true },
    _message: { state: true },
    _inserting: { state: true },
  };

  constructor() {
    super();
    this._status = 'scanning';
    this._forms = [];
    this._progress = { scanned: 0, total: 0, unreadable: 0 };
    this._query = '';
    this._selected = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, styles].filter(Boolean);
    const { org, site } = readLocation(this.context);
    Object.assign(this, { _org: org, _site: site });
    if (!org || !site) {
      this._status = 'error';
      this._error = 'The organization and site of the document are not known. Open the Form Picker from a document.';
      return;
    }
    this.scan();
  }

  async scan() {
    this._status = 'scanning';
    this._forms = [];
    try {
      await scanForms(this._org, this._site, {
        schemas: SCHEMAS,
        onProgress: (progress) => { this._progress = progress; },
        onForm: (form) => {
          this._forms = [...this._forms, form].sort((a, b) => a.path.localeCompare(b.path));
          if (!this._selected) this._selected = form.path;
        },
      });
      this._status = 'done';
    } catch (e) {
      this._status = 'error';
      this._error = e.message;
    }
  }

  get visibleForms() {
    const query = this._query.trim().toLowerCase();
    return query
      ? this._forms.filter((f) => f.path.toLowerCase().includes(query)
        || f.title.toLowerCase().includes(query))
      : this._forms;
  }

  async insert() {
    if (!this._selected || this._inserting) return;
    if (typeof this.actions?.sendHTML !== 'function') {
      this._message = { type: 'error', text: 'Open the Form Picker from a document to insert the form.' };
      return;
    }
    this._inserting = true;
    try {
      await this.actions.sendHTML(toEmbedBlockHtml(this._selected));
      this._message = { type: 'success', text: 'Form inserted.' };
      this.actions.closeLibrary?.();
    } catch (e) {
      this._message = { type: 'error', text: e?.message || String(e) };
    } finally {
      this._inserting = false;
    }
  }

  handleKey(e) {
    const forms = this.visibleForms;
    if (!forms.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter') {
      this.insert();
      return;
    }
    const index = forms.findIndex((f) => f.path === this._selected);
    const next = Math.max(0, Math.min(forms.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
    this._selected = forms[next].path;
    this.updateComplete.then(() => this.shadowRoot.querySelector('.option.is-selected')?.scrollIntoView({ block: 'nearest' }));
  }

  renderList() {
    const forms = this.visibleForms;
    if (!forms.length) {
      if (this._status === 'scanning') return nothing;
      return html`<p class="empty">${this._forms.length ? 'No forms match.' : 'No forms found. Create one with the Form Editor.'}</p>`;
    }
    return html`<ul class="list" role="listbox" id="forms" aria-label="Forms">
      ${forms.map((form) => html`<li role="option" id="opt-${form.path}" aria-selected=${form.path === this._selected}
        class="option ${form.path === this._selected ? 'is-selected' : ''}"
        @click=${() => { this._selected = form.path; }} @dblclick=${() => { this._selected = form.path; this.insert(); }}>
        <span class="title">${form.title || form.path.split('/').pop()}</span>
        <span class="path">${form.path} · ${form.fields} fields</span>
      </li>`)}
    </ul>`;
  }

  render() {
    if (this._status === 'error') return html`<p class="message error" role="alert">${this._error}</p>`;
    const { scanned, total } = this._progress;
    return html`
      <header>
        <h1>Form Picker</h1>
        <p class="subtitle">Embed a form from <code>${this._org}/${this._site}</code></p>
      </header>
      <label class="visually-hidden" for="search">Search forms</label>
      <input id="search" type="search" placeholder="Search forms" autofocus .value=${this._query}
        role="combobox" aria-controls="forms" aria-expanded="true"
        aria-activedescendant=${this._selected ? `opt-${this._selected}` : nothing}
        @input=${(e) => { this._query = e.target.value; }} @keydown=${this.handleKey}>
      ${this._status === 'scanning' ? html`<p class="status" role="status">Looking for forms… ${scanned} of ${total || '…'} JSON files</p>` : nothing}
      ${this.renderList()}
      <footer>
        ${this._selected ? html`<p class="preview">Inserts an <b>Embed Adaptive Form</b> block linking <code>${formLink(this._selected)}</code></p>` : nothing}
        ${this._message ? html`<p class="message ${this._message.type}" role="status">${this._message.text}</p>` : nothing}
        <button type="button" class="accent-btn" ?disabled=${!this._selected || this._inserting} @click=${this.insert}>
          ${this._inserting ? 'Inserting…' : 'Insert form'}
        </button>
      </footer>
    `;
  }
}

customElements.define('formpicker-app', FormPickerApp);

(async function init() {
  const { context, actions } = await DA_SDK;
  if (document.readyState === 'loading') {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }
  const cmp = document.createElement('formpicker-app');
  cmp.context = context;
  cmp.actions = actions;
  document.body.append(cmp);
}());
