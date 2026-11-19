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
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */

/*
 * <form-editor>: the standalone Form Editor. It depends on no host: documents are read and
 * written through a FormStorage, and an optional Assistant takes prompts (editor/contract.js).
 * Hosts register their implementations with the registry, or pass them to mountFormEditor().
 * `lit` is a bare import, mapped by the host page with an import map.
 */
import { LitElement, html, nothing } from 'lit';
import loadCatalog from './catalog.js';
import {
  parseFormDocument, buildFormDocument, newFormDocument, newFormPath, toDocPath, encodeDefinition,
  getPath, setPath, getItem, isContainer, samePath, isAncestor, insertItem, removeItem,
  moveItem, duplicateItem, createItem, evaluateCondition, itemLabel,
} from './crispr.js';
import { icon } from './icons.js';
import { fromDataRef } from './property-form.js';
import { registry as defaultRegistry, FormStorage, Assistant } from './contract.js';

// default folder of new forms named without a path
const FORMS_FOLDER = '/forms/';
const HISTORY_LIMIT = 100;
const COWORKER_KEY = 'formeditor:coworker';
const VIEWS = [['preview', 'Preview'], ['layout', 'Layout'], ['content', 'Content'], ['split', 'Split']];

let styles = null;
try {
  const resp = await fetch(new URL('./form-editor.css', import.meta.url));
  styles = new CSSStyleSheet();
  await styles.replace(await resp.text());
} catch (e) {
  console.warn('Failed to load the Form Editor styles:', e);
}

const stripHtml = (text) => (typeof text === 'string' ? text.replace(/<[^>]+>/g, '').trim() : '');

export class FormEditor extends LitElement {
  static properties = {
    // a FormStorage and an optional Assistant (editor/contract.js); resolved from the registry
    // when not set
    storage: { attribute: false },
    assistant: { attribute: false },
    // { catalogUrl, previewUrl (false: no Preview view), path, syncUrl, registry }
    options: { attribute: false },
    _status: { state: true },
    _error: { state: true },
    _path: { state: true },
    _form: { state: true },
    _canWrite: { state: true },
    _selected: { state: true },
    _view: { state: true },
    _tab: { state: true },
    _editing: { state: true },
    _panelTab: { state: true },
    _coworkerOpen: { state: true },
    _toolsOpen: { state: true },
    _paletteQuery: { state: true },
    _drag: { state: true },
    _drop: { state: true },
    _outlineDrop: { state: true },
    _inserter: { state: true },
    _inserterQuery: { state: true },
    _inserterActive: { state: true },
    _formJsonDraft: { state: true },
    _formJsonError: { state: true },
    _saving: { state: true },
    _notice: { state: true },
    _conflict: { state: true },
    _fieldErrors: { state: true },
    _jsonDraft: { state: true },
    _jsonError: { state: true },
    _docs: { state: true },
    _docsLoading: { state: true },
    _pickerPath: { state: true },
    _newName: { state: true },
    _chatText: { state: true },
    _historyVersion: { state: true },
  };

  constructor() {
    super();
    this._status = 'loading';
    this._view = 'layout';
    this._panelTab = 'inspector';
    this._toolsOpen = true;
    try {
      this._coworkerOpen = localStorage.getItem(COWORKER_KEY) !== 'closed';
    } catch {
      this._coworkerOpen = true;
    }
    this._tab = 0;
    this._paletteQuery = '';
    this._fieldErrors = {};
    this._history = [];
    this._future = [];
    this._historyVersion = 0;
    this._docs = [];
    this._pickerPath = '';
    this._newName = '';
    this._chatText = '';
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this._onKeydown = (e) => this.handleShortcut(e);
    this._onPreviewMessage = (e) => this.handlePreviewMessage(e);
    window.addEventListener('message', this._onPreviewMessage);
    this._onBeforeUnload = (e) => {
      if (this.dirty) e.preventDefault();
    };
    window.addEventListener('keydown', this._onKeydown);
    window.addEventListener('beforeunload', this._onBeforeUnload);
    this.init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeydown);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    window.removeEventListener('message', this._onPreviewMessage);
    this._unsubscribeTurns?.();
  }

  get registry() {
    return this.options?.registry || defaultRegistry;
  }

  get previewUrl() {
    const url = this.options?.previewUrl;
    if (url === false) return null;
    return String(url || new URL('./preview.html', import.meta.url));
  }

  get assistantName() {
    return this.assistant?.describe?.().name || 'Assistant';
  }

  get storageLabel() {
    return this.storage?.describe().label || '';
  }

  async init() {
    try {
      this.storage ??= await this.registry.require(FormStorage);
      this.assistant ??= await this.registry.resolve(Assistant);
    } catch (e) {
      this._status = 'error';
      this._error = `The Form Editor cannot start: ${e.message}`;
      return;
    }
    this.setupChat();
    try {
      this._catalog = await loadCatalog(this.options?.catalogUrl);
    } catch (e) {
      this._status = 'error';
      this._error = `The form component catalog could not be loaded: ${e.message}`;
      return;
    }
    const path = this.options?.path ?? (this.syncUrl ? new URLSearchParams(window.location.search).get('path') : '');
    if (path?.trim()) await this.openDocument(path.trim());
    else this.showPicker();
  }

  // ---- Assistant (for example DA's Coworker) ----

  get chatAvailable() {
    return !!this.assistant;
  }

  setupChat() {
    if (!this.chatAvailable) return;
    try {
      this._unsubscribeTurns = this.assistant.onTurnCompleted((detail) => {
        if (detail?.status === 'completed') this.syncFromSource({ reason: 'coworker' });
      });
    } catch (e) {
      console.warn('[formeditor] assistant turn notifications unavailable:', e);
    }
  }

  openChat() {
    this.assistant?.open?.();
  }

  describeSelection() {
    const path = this._selected;
    if (!path) return 'No item is selected.';
    if (!path.length) return 'The form itself (its root properties) is selected.';
    const item = getItem(this._form, path);
    const jsonPath = path.map((i) => `items[${i}]`).join('.');
    return `The selected item is "${itemLabel(item)}" (name "${item?.name}", fieldType "${item?.fieldType}") at JSON path ${jsonPath}.`;
  }

  async askCoworker(e) {
    e?.preventDefault();
    const text = this._chatText.trim();
    if (!text || !this.chatAvailable) return;
    if (this.dirty) {
      const saved = await this.save();
      if (!saved) return;
    }
    const doc = `${this.storageLabel}${this._path}`;
    const prompt = [
      text,
      '',
      `Context: I am editing the Adaptive Form stored in the JSON document ${doc}.`,
      'It is a Structured Content document: { "metadata": { "schemaName": "adaptive-form" }, "data": <Crispr form JSON> }. Change only "data", keep the document valid JSON, and keep properties you do not change.',
      this.describeSelection(),
    ].join('\n');
    this.assistant.ask(prompt);
    this._chatText = '';
  }

  // ---- Documents ----

  get syncUrl() {
    return this.options?.syncUrl !== false;
  }

  updateUrl() {
    if (!this.syncUrl) return;
    try {
      const url = new URL(window.location.href);
      if (this._path) url.searchParams.set('path', this._path.replace(/\.json$/i, ''));
      else url.searchParams.delete('path');
      url.searchParams.delete('block');
      window.history.replaceState(null, '', url);
    } catch (e) {
      console.warn('[formeditor] updateUrl failed:', e);
    }
  }

  async showPicker() {
    // eslint-disable-next-line no-alert
    if (this.dirty && !window.confirm('Discard unsaved changes?')) return;
    this._status = 'picker';
    this._path = '';
    this._form = null;
    this.updateUrl();
    this._docsLoading = true;
    this._docs = [];
    this._pickerScan = (this._pickerScan || 0) + 1;
    const scan = this._pickerScan;
    try {
      // every form and form fragment document of the site, in any folder
      await this.storage.list({
        isCancelled: () => scan !== this._pickerScan || this._status !== 'picker',
        onForm: (form) => {
          this._docs = [...this._docs, form].sort((a, b) => a.path.localeCompare(b.path));
        },
      });
    } catch (e) {
      this._notice = { type: 'error', text: e.message };
    }
    if (scan === this._pickerScan) this._docsLoading = false;
  }

  async openDocument(path) {
    const docPath = toDocPath(path);
    this._status = 'loading';
    this._notice = null;
    this._conflict = null;
    try {
      const doc = await this.storage.read(docPath);
      if (!doc) throw new Error(`${docPath} does not exist.`);
      this._path = docPath;
      this._canWrite = doc.canWrite !== false;
      this.loadSource(doc.document);
      this._history = [];
      this._future = [];
      this._historyVersion += 1;
      this._selected = [];
      this.updateUrl();
    } catch (e) {
      this._status = 'error';
      this._error = e.message;
    }
  }

  loadSource(json) {
    const { document, definition } = parseFormDocument(json);
    this._document = document;
    this._form = definition;
    this._savedJson = encodeDefinition(definition);
    this._formJsonDraft = undefined;
    this._formJsonError = '';
    this._status = 'ready';
  }

  async createDocument(e) {
    e?.preventDefault();
    const { path, title } = newFormPath(this._newName);
    if (!path) {
      this._notice = { type: 'error', text: 'Enter a name or a path for the new form.' };
      return;
    }
    try {
      if (await this.storage.read(path)) {
        this._notice = { type: 'error', text: `${path} already exists.` };
        return;
      }
      const { data, ...document } = newFormDocument({ title });
      await this.storage.write(path, buildFormDocument(document, data));
      this._newName = '';
      await this.openDocument(path);
    } catch (err) {
      this._notice = { type: 'error', text: err.message };
    }
  }

  get dirty() {
    if (!this._form) return false;
    return encodeDefinition(this._form) !== this._savedJson;
  }

  /**
   * Saves the form into the latest version of the document, so that changes made to its
   * metadata meanwhile are kept. A concurrent change of the form itself is a conflict.
   */
  async save({ force = false } = {}) {
    if (!this.dirty || this._saving || !this._canWrite) return !this.dirty;
    if (Object.keys(this._fieldErrors).length) {
      this._notice = { type: 'error', text: 'Fix the invalid properties before saving.' };
      return false;
    }
    this._saving = true;
    this._notice = null;
    try {
      const latest = await this.storage.read(this._path);
      if (!latest) throw new Error(`${this._path} no longer exists.`);
      const remote = parseFormDocument(latest.document);
      if (!force && encodeDefinition(remote.definition) !== this._savedJson) {
        this._conflict = { json: latest.document };
        return false;
      }
      await this.storage.write(this._path, buildFormDocument(remote.document, this._form));
      this._document = remote.document;
      this._savedJson = encodeDefinition(this._form);
      this._conflict = null;
      this._notice = { type: 'success', text: 'Saved.' };
      return true;
    } catch (e) {
      this._notice = { type: 'error', text: e.message };
      return false;
    } finally {
      this._saving = false;
    }
  }

  /** Reloads the form when the stored version changed (after a coworker turn). */
  async syncFromSource({ reason } = {}) {
    if (this._status !== 'ready' || !this._path) return;
    try {
      const latest = await this.storage.read(this._path);
      if (!latest) return;
      const remote = parseFormDocument(latest.document);
      if (encodeDefinition(remote.definition) === this._savedJson) return;
      if (this.dirty) {
        this._conflict = { json: latest.document, reason };
        return;
      }
      this.applyRemote(latest.document);
      this._notice = {
        type: 'info',
        text: reason === 'coworker' ? `${this.assistantName} changed the form; the editor shows the stored version (Undo reverts it locally).` : 'The form was reloaded.',
      };
    } catch (e) {
      console.warn('[formeditor] sync failed:', e);
    }
  }

  applyRemote(json) {
    const previous = this._form && structuredClone(this._form);
    const selected = this._selected;
    this.loadSource(json);
    if (previous && this._form) {
      this._history = [...this._history, previous].slice(-HISTORY_LIMIT);
      this._future = [];
      this._historyVersion += 1;
    }
    this._selected = selected && this._form && getItem(this._form, selected) ? selected : [];
    this._conflict = null;
    // the preview renders a definition once: show the changed form
    if (this._view === 'preview') this.updateComplete.then(() => this.reloadPreview());
  }

  resolveConflict(choice) {
    const { json } = this._conflict || {};
    if (choice === 'reload' && json) this.applyRemote(json);
    else if (choice === 'overwrite') this.save({ force: true });
    else this._conflict = null;
  }

  // ---- Edits (every change goes through mutate: undo history) ----

  mutate(change, select) {
    if (!this._canWrite) return;
    const next = structuredClone(this._form);
    let result;
    try {
      result = change(next);
    } catch (e) {
      this._notice = { type: 'error', text: e.message };
      return;
    }
    this._history = [...this._history, this._form].slice(-HISTORY_LIMIT);
    this._future = [];
    this._historyVersion += 1;
    this._form = next;
    // edits made outside the JSON view replace a pending JSON draft
    if (!this._applyingJson) {
      this._formJsonDraft = undefined;
      this._formJsonError = '';
    }
    if (select !== undefined) this._selected = typeof select === 'function' ? select(result) : select;
    this._notice = null;
  }

  undo() {
    if (!this._history.length) return;
    this._future = [this._form, ...this._future];
    this._form = this._history[this._history.length - 1];
    this._history = this._history.slice(0, -1);
    this.afterHistoryStep();
  }

  redo() {
    if (!this._future.length) return;
    this._history = [...this._history, this._form];
    [this._form] = this._future;
    this._future = this._future.slice(1);
    this.afterHistoryStep();
  }

  afterHistoryStep() {
    this._editing = null;
    this._inserter = null;
    this._historyVersion += 1;
    this._fieldErrors = {};
    this._jsonDraft = undefined;
    this._formJsonDraft = undefined;
    this._formJsonError = '';
    if (this._selected && !getItem(this._form, this._selected)) this._selected = [];
    // the preview renders a definition once: show the undone/redone form
    if (this._view === 'preview') this.updateComplete.then(() => this.reloadPreview());
  }

  targetForInsert() {
    const sel = this._selected;
    if (!sel || !sel.length) return { parent: [], index: undefined };
    const item = getItem(this._form, sel);
    if (isContainer(item)) {
      return { parent: sel, index: undefined };
    }
    return { parent: sel.slice(0, -1), index: sel[sel.length - 1] + 1 };
  }

  addComponent(componentId, parent, index) {
    const target = parent ? { parent, index } : this.targetForInsert();
    this.mutate((form) => {
      const item = createItem(form, componentId, this._catalog);
      return insertItem(form, target.parent, target.index, item);
    }, (path) => path);
    this._tab = 0;
  }

  removeSelected(path = this._selected) {
    if (!path?.length) return;
    this.mutate((form) => removeItem(form, path), []);
  }

  duplicate(path = this._selected) {
    if (!path?.length) return;
    this.mutate((form) => {
      const copy = duplicateItem(form, getItem(form, path));
      return insertItem(form, path.slice(0, -1), path[path.length - 1] + 1, copy);
    }, (newPath) => newPath);
  }

  moveBy(path, delta) {
    const parent = path.slice(0, -1);
    const index = path[path.length - 1];
    const siblings = getItem(this._form, parent)?.items || [];
    const to = index + delta;
    if (to < 0 || to >= siblings.length) return;
    this.mutate((form) => moveItem(form, path, parent, delta > 0 ? to + 1 : to), (p) => p);
  }

  setProperty(target, name, value) {
    this.mutate((form) => {
      const obj = target.length ? getItem(form, target) : form;
      setPath(obj, name, value);
    });
  }

  // ---- Layout view: drag and drop ----

  startDrag(e, drag) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = drag.kind === 'new' ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', drag.kind === 'new' ? drag.componentId : drag.path.join('.'));
    // changing the DOM in dragstart cancels the drag in some browsers
    setTimeout(() => { this._drag = drag; });
  }

  endDrag() {
    this._drag = null;
    this._drop = null;
    this._outlineDrop = null;
  }

  canDropInto(parent) {
    const drag = this._drag;
    if (!drag) return false;
    return drag.kind !== 'move' || !(samePath(drag.path, parent) || isAncestor(drag.path, parent));
  }

  handleDrop(e, parent, index) {
    e.preventDefault();
    e.stopPropagation();
    const drag = this._drag;
    this.endDrag();
    if (!drag || !this._canWrite) return;
    if (drag.kind === 'new') this.addComponent(drag.componentId, parent, index);
    else if (!samePath(drag.path, parent) && !isAncestor(drag.path, parent)) {
      this.mutate((form) => moveItem(form, drag.path, parent, index), (p) => p);
    }
  }

  renderDropSlot(parent, index, { empty = false } = {}) {
    if (!this._drag || !this.canDropInto(parent)) {
      return this.renderInsertGap(parent, index, { empty });
    }
    const active = this._drop && samePath(this._drop.parent, parent) && this._drop.index === index;
    return html`<div
      class="drop-slot ${active ? 'is-active' : ''} ${empty ? 'is-empty' : ''}"
      @dragover=${(e) => { e.preventDefault(); e.stopPropagation(); if (!active) this._drop = { parent, index }; }}
      @drop=${(e) => this.handleDrop(e, parent, index)}
    >${empty ? 'Drop blocks here' : nothing}</div>`;
  }

  // ---- Layout view: inserting blocks between items ("+" gaps and "/") ----

  openInserter(parent, index) {
    if (!this._canWrite) return;
    this._inserter = { parent, index };
    this._inserterQuery = '';
    this._inserterActive = 0;
    this.updateComplete.then(() => this.shadowRoot.querySelector('.inserter input')?.focus());
  }

  closeInserter({ refocus = false } = {}) {
    if (!this._inserter) return;
    this._inserter = null;
    if (refocus) this.updateComplete.then(() => this.shadowRoot.querySelector('.card.is-selected .card-title, .form-head')?.focus());
  }

  get inserterMatches() {
    const q = (this._inserterQuery || '').trim().toLowerCase();
    return this._catalog.components
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q));
  }

  insertFromMenu(componentId) {
    const { parent, index } = this._inserter;
    this._inserter = null;
    this.addComponent(componentId, parent, index);
  }

  handleInserterKey(e) {
    const matches = this.inserterMatches;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeInserter({ refocus: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this._inserterActive = Math.max(0, Math.min(matches.length - 1, this._inserterActive + step));
      this.updateComplete.then(() => this.shadowRoot.querySelector('.inserter-option.is-active')?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const choice = matches[this._inserterActive];
      if (choice) this.insertFromMenu(choice.id);
    }
  }

  renderInserter() {
    const matches = this.inserterMatches;
    const active = Math.min(this._inserterActive, matches.length - 1);
    return html`<div class="inserter" @click=${(e) => e.stopPropagation()}
      @focusout=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) this.closeInserter(); }}>
      <input type="search" placeholder="Search blocks" aria-label="Search blocks to insert"
        role="combobox" aria-expanded="true" aria-controls="inserter-list"
        aria-activedescendant=${matches.length ? `inserter-${matches[active].id}` : nothing}
        .value=${this._inserterQuery}
        @input=${(e) => { this._inserterQuery = e.target.value; this._inserterActive = 0; }}
        @keydown=${this.handleInserterKey}>
      <ul class="inserter-list" id="inserter-list" role="listbox" aria-label="Blocks">
        ${matches.map((c, i) => html`<li id="inserter-${c.id}" role="option" aria-selected=${i === active}
          class="inserter-option ${i === active ? 'is-active' : ''}"
          @mousedown=${(e) => e.preventDefault()}
          @mouseenter=${() => { this._inserterActive = i; }}
          @click=${() => this.insertFromMenu(c.id)}>
          <span class="palette-glyph" aria-hidden="true">${c.title.slice(0, 2)}</span>${c.title}
        </li>`)}
        ${matches.length ? nothing : html`<li class="empty-note">No blocks match</li>`}
      </ul>
    </div>`;
  }

  renderInsertGap(parent, index, { empty = false } = {}) {
    const open = this._inserter && samePath(this._inserter.parent, parent)
      && this._inserter.index === index;
    if (open) return this.renderInserter();
    if (!this._canWrite) return empty ? html`<p class="container-empty">Empty</p>` : nothing;
    const where = parent.length ? itemLabel(getItem(this._form, parent)) : 'the form';
    if (empty) {
      return html`<button type="button" class="container-empty insert-empty"
        @click=${(e) => { e.stopPropagation(); this.openInserter(parent, index); }}>${icon('plus', 14)} Add a block, or drop one here</button>`;
    }
    return html`<div class="insert-gap">
      <button type="button" class="insert-btn" aria-label="Insert a block here in ${where}" title="Insert a block here"
        @click=${(e) => { e.stopPropagation(); this.openInserter(parent, index); }}>${icon('plus', 14)}</button>
    </div>`;
  }

  select(path) {
    if (!samePath(path, this._selected)) {
      this._tab = 0;
      this._jsonDraft = undefined;
      this._jsonError = '';
      this._fieldErrors = {};
    }
    this._selected = path;
  }

  setView(view) {
    this._view = view;
  }

  // ---- Content view: the form's JSON ----

  handleFormJsonInput(e) {
    this._formJsonDraft = e.target.value;
    clearTimeout(this._formJsonTimer);
    this._formJsonTimer = setTimeout(() => this.applyFormJson(), 500);
  }

  applyFormJson() {
    const text = this._formJsonDraft;
    if (text === undefined) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The form definition must be a JSON object.');
      }
    } catch (err) {
      this._formJsonError = err.message;
      return;
    }
    this._formJsonError = '';
    if (encodeDefinition(parsed) === encodeDefinition(this._form)) return;
    const selected = this._selected;
    this._applyingJson = true;
    this.mutate((form) => {
      Object.keys(form).forEach((key) => delete form[key]);
      Object.assign(form, parsed);
    }, () => (selected && (!selected.length || getItem(parsed, selected)) ? selected : []));
    this._applyingJson = false;
  }

  handleFormJsonBlur() {
    clearTimeout(this._formJsonTimer);
    this.applyFormJson();
    // valid text is reformatted from the model once the author leaves the editor
    if (!this._formJsonError) this._formJsonDraft = undefined;
  }

  renderContentView() {
    const text = this._formJsonDraft ?? JSON.stringify(this._form, null, 2);
    return html`
      <div class="json-view">
        <div class="json-status ${this._formJsonError ? 'is-error' : ''}" role="status">
          ${this._formJsonError ? `Invalid JSON — not applied: ${this._formJsonError}` : 'Crispr JSON of the form (the data of its Structured Content document). Valid edits apply as you type.'}
        </div>
        <label class="visually-hidden" for="form-json">Form JSON</label>
        <textarea id="form-json" class="code json-editor" spellcheck="false" .value=${text}
          ?readonly=${!this._canWrite}
          @input=${this.handleFormJsonInput} @blur=${this.handleFormJsonBlur}
          @keydown=${(e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end');
      this.handleFormJsonInput(e);
    }
  }}></textarea>
      </div>
    `;
  }

  handleShortcut(e) {
    if (this._status !== 'ready') return;
    const mod = e.metaKey || e.ctrlKey;
    const inField = e.composedPath().some((el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save();
    } else if (mod && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
    } else if (mod && e.key.toLowerCase() === 'y' && !inField) {
      e.preventDefault();
      this.redo();
    } else if (e.key === '/' && !mod && !inField && this._selected && this._view !== 'preview'
      && this._view !== 'content' && !this._inserter) {
      // "/" opens the block menu after the selected item (at the end of the form for the form)
      e.preventDefault();
      const sel = this._selected;
      if (!sel.length) this.openInserter([], (this._form.items || []).length);
      else this.openInserter(sel.slice(0, -1), sel[sel.length - 1] + 1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && this._selected?.length) {
      e.preventDefault();
      this.removeSelected();
    }
  }

  // ---- Render: header ----

  renderHeader() {
    const ready = this._status === 'ready';
    const saveLabel = this._saving ? 'Saving…' : 'Save';
    let state = '';
    if (ready && !this._canWrite) state = 'Read-only';
    else if (ready) state = this.dirty ? 'Unsaved changes' : 'All changes saved';
    return html`
      <header class="bar">
        <div class="group group-start">
          ${this.chatAvailable ? html`
            <button type="button" class="coworker-btn ${this._coworkerOpen ? 'is-active' : ''}" aria-label=${this.assistantName}
              aria-pressed=${this._coworkerOpen} aria-controls="coworker-panel" title=${`${this._coworkerOpen ? 'Hide' : 'Show'} ${this.assistantName}`}
              ?disabled=${this._status !== 'ready'} @click=${this.toggleCoworker}>${icon('coworker')}</button>
          ` : nothing}
          ${ready && this._canWrite ? html`
            <button type="button" class="icon-btn" aria-label="Undo" title="Undo" ?disabled=${!this._history.length} @click=${this.undo}>${icon('undo')}</button>
            <button type="button" class="icon-btn" aria-label="Redo" title="Redo" ?disabled=${!this._future.length} @click=${this.redo}>${icon('redo')}</button>
          ` : nothing}
          ${ready && !this._canWrite ? html`<span class="icon-btn read-only" role="img" aria-label="Read-only — you don't have write access" title="Read-only">${icon('lock')}</span>` : nothing}
          <button type="button" class="doc-link" @click=${this.showPicker} title="Open another form">
            <span class="doc-app">Form Editor</span>
            ${this._path ? html`<span class="doc-path">${this._path.replace(/\.json$/i, '')}</span>` : nothing}
          </button>
        </div>
        <div class="group group-center">
          ${ready ? html`
            <div class="segmented" role="group" aria-label="Editor view">
              ${VIEWS.filter(([id]) => id !== 'preview' || this.previewUrl).map(([id, label]) => html`
                <button type="button" class="segment ${this._view === id ? 'is-selected' : ''}" aria-pressed=${this._view === id} @click=${() => this.setView(id)}>${label}</button>
              `)}
            </div>
          ` : nothing}
        </div>
        <div class="group group-end">
          ${state ? html`<span class="save-state ${this.dirty ? 'is-dirty' : ''}" role="status">${state}</span>` : nothing}
          ${ready && this._canWrite ? html`
            <button type="button" class="accent-btn" ?disabled=${!this.dirty || this._saving} @click=${() => this.save()}>${saveLabel}</button>
          ` : nothing}
          ${ready && !this._toolsOpen && this._view !== 'preview' ? html`
            <button type="button" class="icon-btn" aria-label="Show panel" title="Show Blocks, Outline and Block Inspector" @click=${() => { this._toolsOpen = true; }}>${icon('splitRight')}</button>
          ` : nothing}
        </div>
      </header>
    `;
  }

  renderNotices() {
    return html`
      ${this._conflict ? html`
        <div class="notice warning" role="alert">
          <span>${this._conflict.reason === 'coworker' ? `${this.assistantName} changed this form while you have unsaved changes.` : 'This form was changed by someone else since you opened it.'}</span>
          <span class="notice-actions">
            <button type="button" class="quiet-btn" @click=${() => this.resolveConflict('reload')}>Load their version</button>
            <button type="button" class="quiet-btn" @click=${() => this.resolveConflict('overwrite')}>Keep mine and save</button>
            <button type="button" class="icon-btn" aria-label="Dismiss" @click=${() => this.resolveConflict('dismiss')}>${icon('close', 16)}</button>
          </span>
        </div>
      ` : nothing}
      ${this._notice ? html`
        <div class="notice ${this._notice.type}" role=${this._notice.type === 'error' ? 'alert' : 'status'}>
          <span>${this._notice.text}</span>
          <button type="button" class="icon-btn" aria-label="Dismiss" @click=${() => { this._notice = null; }}>${icon('close', 16)}</button>
        </div>
      ` : nothing}
    `;
  }

  // ---- Render: left panel (components, outline, coworker) ----

  renderPalette() {
    return html`<div class="panel-body">${this.renderPaletteItems()}</div>`;
  }

  renderPaletteItems() {
    const q = this._paletteQuery.toLowerCase();
    const components = this._catalog.components
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q));
    return html`
      <input class="search" type="search" placeholder="Search blocks" aria-label="Search blocks"
        .value=${this._paletteQuery} @input=${(e) => { this._paletteQuery = e.target.value; }}>
      <ul class="palette" aria-label="Form blocks">
        ${components.map((c) => html`
          <li>
            <button type="button" class="palette-item" draggable=${this._canWrite ? 'true' : 'false'}
              ?disabled=${!this._canWrite}
              title="Add ${c.title} (or drag it onto the canvas)"
              @click=${() => this.addComponent(c.id)}
              @dragstart=${(e) => this.startDrag(e, { kind: 'new', componentId: c.id })}
              @dragend=${this.endDrag}
            >
              <span class="palette-glyph" aria-hidden="true">${c.title.slice(0, 2)}</span>
              <span>${c.title}</span>
              ${icon('plus', 14)}
            </button>
          </li>
        `)}
        ${components.length ? nothing : html`<li class="empty-note">No blocks match</li>`}
      </ul>
    `;
  }

  /** Where a drag over an Outline row would drop: before, after, or inside (containers). */
  outlineDropAt(e, path, item) {
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    const container = !path.length || isContainer(item);
    let target;
    if (!path.length || (container && y > 0.25 && y < 0.75)) {
      target = { mode: 'inside', parent: path, index: (item?.items || []).length };
    } else {
      const index = path[path.length - 1] + (y >= 0.5 ? 1 : 0);
      target = { mode: y >= 0.5 ? 'after' : 'before', parent: path.slice(0, -1), index };
    }
    return this.canDropInto(target.parent) ? target : null;
  }

  handleOutlineDragOver(e, path, item) {
    if (!this._drag) return;
    const target = this.outlineDropAt(e, path, item);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const key = `${path.join('.')}:${target.mode}`;
    if (this._outlineDrop?.key !== key) this._outlineDrop = { ...target, key, path };
  }

  handleOutlineDrop(e) {
    const target = this._outlineDrop;
    this._outlineDrop = null;
    if (target) this.handleDrop(e, target.parent, target.index);
  }

  handleOutlineKey(e, path) {
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || !path.length) return;
    e.preventDefault();
    const index = path[path.length - 1];
    const count = getItem(this._form, path.slice(0, -1))?.items?.length || 0;
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= count) return;
    this.moveBy(path, e.key === 'ArrowUp' ? -1 : 1);
    const moved = [...path.slice(0, -1), to].join('.');
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector(`.outline-item[data-path="${moved}"]`)?.focus();
    });
  }

  renderOutlineRow(item, path, { root = false } = {}) {
    const selected = samePath(path, this._selected);
    const drop = this._outlineDrop && samePath(this._outlineDrop.path, path) ? this._outlineDrop.mode : '';
    const writable = this._canWrite && !root;
    return html`<button type="button" class="outline-item ${root ? 'is-root' : ''} ${selected ? 'is-selected' : ''} ${drop ? `drop-${drop}` : ''}"
      data-path=${path.join('.')}
      draggable=${writable ? 'true' : 'false'}
      title=${writable ? 'Drag to move, or Alt+↑/↓' : nothing}
      @click=${() => this.select(path)}
      @keydown=${(e) => this.handleOutlineKey(e, path)}
      @dragstart=${(e) => { if (writable) this.startDrag(e, { kind: 'move', path }); }}
      @dragend=${this.endDrag}
      @dragover=${(e) => this.handleOutlineDragOver(e, path, item)}
      @dragleave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget) && drop) this._outlineDrop = null; }}
      @drop=${this.handleOutlineDrop}
    >
      ${writable ? html`<span class="drag-handle" aria-hidden="true">${icon('drag', 14)}</span>` : nothing}
      <span class="outline-type">${root ? 'Form' : (this._catalog.resolve(item)?.title || item?.fieldType || '?')}</span>
      <span class="outline-label">${root ? (stripHtml(item.title) || 'Form settings') : itemLabel(item)}</span>
    </button>`;
  }

  renderOutlineItems(node, path) {
    const items = node?.items || [];
    if (!items.length) return nothing;
    return html`<ul role="group">
      ${items.map((item, index) => {
    const itemPath = [...path, index];
    return html`<li role="treeitem" aria-selected=${samePath(itemPath, this._selected)} aria-expanded=${Array.isArray(item?.items) ? 'true' : nothing}>
          ${this.renderOutlineRow(item, itemPath)}
          ${this.renderOutlineItems(item, itemPath)}
        </li>`;
  })}
    </ul>`;
  }

  renderOutline() {
    return html`
      <div class="panel-body outline" role="tree" aria-label="Form outline">
        ${this.renderOutlineRow(this._form, [], { root: true })}
        ${this.renderOutlineItems(this._form, [])}
      </div>
    `;
  }

  toggleCoworker() {
    this._coworkerOpen = !this._coworkerOpen;
    try {
      localStorage.setItem(COWORKER_KEY, this._coworkerOpen ? 'open' : 'closed');
    } catch {
      // storage unavailable: the choice only lasts for this session
    }
  }

  get coworkerShown() {
    return this.chatAvailable && this._coworkerOpen;
  }

  renderCoworker() {
    if (!this.coworkerShown) return nothing;
    return html`
      <aside class="panel panel-left" id="coworker-panel" aria-label=${this.assistantName}>
        <div class="coworker-head">
          <button type="button" class="icon-btn" aria-label=${`Close ${this.assistantName}`} title="Close" @click=${this.toggleCoworker}>${icon('close')}</button>
        </div>
        <div class="coworker-welcome">
          <h2>${this.assistantName}</h2>
          <p>What should we change in this form?</p>
        </div>
        <form class="coworker" @submit=${this.askCoworker}>
          <div class="prompt-box">
            <label class="visually-hidden" for="coworker-input">Ask ${this.assistantName}</label>
            <textarea id="coworker-input" rows="3" placeholder=${`Ask ${this.assistantName}, e.g. add an email field after the name`}
              .value=${this._chatText} @input=${(e) => { this._chatText = e.target.value; }}
              @keydown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) this.askCoworker(e); }}></textarea>
            <div class="prompt-actions">
              <span class="hint">${this.dirty ? 'Saves your changes first' : 'Sent with the selected item'}</span>
              <button type="submit" class="send-btn" aria-label="Send" title="Send" ?disabled=${!this._chatText.trim() || this._saving}>${icon('up', 16)}</button>
            </div>
          </div>
          <p class="hint">Responses are generated using AI and may be inaccurate.
            <button type="button" class="link-btn" @click=${this.openChat}>Open the conversation</button></p>
        </form>
      </aside>
    `;
  }

  renderSidePanel() {
    const tabs = [['components', 'Blocks'], ['outline', 'Outline'], ['inspector', 'Block Inspector']];
    let body = this.renderInspector();
    if (this._panelTab === 'components') body = this.renderPalette();
    else if (this._panelTab === 'outline') body = this.renderOutline();
    return html`
      <aside class="panel panel-right" aria-label="Blocks, Outline and Block Inspector">
        <div class="panel-head">
          <div class="panel-tabs" role="tablist">
            ${tabs.map(([id, label]) => html`
              <button type="button" role="tab" class="pill-tab ${this._panelTab === id ? 'is-selected' : ''}" aria-selected=${this._panelTab === id} @click=${() => { this._panelTab = id; }}>${label}</button>
            `)}
          </div>
          <button type="button" class="icon-btn" aria-label="Hide panel" title="Hide panel" @click=${() => { this._toolsOpen = false; }}>${icon('splitRight')}</button>
        </div>
        <div class="panel-content">${body}</div>
      </aside>
    `;
  }

  /** Selects an item from the canvas and shows its properties. */
  inspect(path) {
    this.select(path);
    this._panelTab = 'inspector';
  }

  // ---- Render: canvas ----

  renderFieldMock(item, component) {
    const type = item?.fieldType || '';
    const options = (item?.enumNames || item?.enum || []).slice(0, 4)
      .map((o) => stripHtml(String(o)));
    const placeholder = item?.placeholder || '';
    if (['form-submit-button', 'form-reset-button'].includes(component?.id) || type === 'button') {
      return html`<span class="mock-button">${itemLabel(item)}</span>`;
    }
    switch (type) {
      case 'plain-text':
        return html`<p class="mock-text">${stripHtml(item.value) || 'Text'}</p>`;
      case 'checkbox':
        return html`<span class="mock-choice"><span class="mock-box" aria-hidden="true"></span>${itemLabel(item)}</span>`;
      case 'radio-group':
      case 'checkbox-group':
        return html`<span class="mock-options">${options.map((o) => html`<span class="mock-choice"><span class="mock-box ${type === 'radio-group' ? 'is-round' : ''}" aria-hidden="true"></span>${o}</span>`)}</span>`;
      case 'drop-down':
        return html`<span class="mock-input is-select">${placeholder || options[0] || 'Select'}</span>`;
      case 'multiline-input':
      case 'text-area':
        return html`<span class="mock-input is-multiline">${placeholder}</span>`;
      case 'image':
        return html`<span class="mock-input is-image">Image</span>`;
      default:
        return html`<span class="mock-input">${placeholder}</span>`;
    }
  }

  renderCard(item, path) {
    const component = this._catalog.resolve(item);
    const selected = samePath(path, this._selected);
    const container = isContainer(item);
    const dragging = this._drag?.kind === 'move' && samePath(this._drag.path, path);
    const hidden = item?.visible === false;
    return html`
      <div class="card ${selected ? 'is-selected' : ''} ${container ? 'is-container' : ''} ${dragging ? 'is-dragging' : ''} ${hidden ? 'is-hidden' : ''}"
        draggable=${this._canWrite && !samePath(path, this._editing) ? 'true' : 'false'}
        @dragstart=${(e) => this.startDrag(e, { kind: 'move', path })}
        @dragend=${this.endDrag}
        @click=${(e) => { e.stopPropagation(); this.inspect(path); }}
      >
        <div class="card-head">
          ${this._canWrite ? html`<span class="drag-handle" aria-hidden="true">${icon('drag', 16)}</span>` : nothing}
          ${samePath(path, this._editing) ? this.renderTextEditor(item, path) : html`<button type="button" class="card-title" aria-pressed=${selected}
            @click=${(e) => { e.stopPropagation(); this.inspect(path); }}
            @dblclick=${(e) => { e.stopPropagation(); this.startEdit(path); }}>
            <span class="card-type">${component?.title || item?.fieldType || 'Unknown'}</span>
            ${container || item?.fieldType !== 'plain-text' ? html`<span class="card-label">${itemLabel(item)}${item?.required ? html`<span class="required" aria-label="required">*</span>` : nothing}</span>` : nothing}
            ${hidden ? html`<span class="badge">Hidden</span>` : nothing}
          </button>`}
          ${selected && this._canWrite ? this.renderItemActions(path) : nothing}
        </div>
        ${container ? html`
          <div class="card-children">${this.renderItems(item, path)}</div>
        ` : html`<div class="card-body">${this.renderFieldMock(item, component)}</div>`}
      </div>
    `;
  }

  /** The JSON property holding an item's visible text: its title, or the text of a Text item. */
  textProperty(item) {
    return item?.fieldType === 'plain-text'
      ? { name: 'value', label: 'Text', multiline: true }
      : { name: 'label.value', label: 'Title', multiline: false };
  }

  startEdit(path) {
    if (!this._canWrite) return;
    this.select(path);
    this._editing = path;
    this.updateComplete.then(() => {
      const field = this.shadowRoot.querySelector('.card-edit');
      field?.focus();
      field?.select();
    });
  }

  finishEdit(path, field, commit) {
    if (!samePath(path, this._editing)) return;
    this._editing = null;
    if (!commit) return;
    const { name } = this.textProperty(getItem(this._form, path));
    const value = field.value.trim();
    if (value !== (getPath(getItem(this._form, path), name) ?? '')) this.setProperty(path, name, value);
  }

  renderTextEditor(item, path) {
    const { name, label, multiline } = this.textProperty(item);
    const value = getPath(item, name) ?? '';
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEdit(path, e.target, false);
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.finishEdit(path, e.target, true);
      }
    };
    const common = {
      click: (e) => e.stopPropagation(),
      blur: (e) => this.finishEdit(path, e.target, true),
    };
    return multiline
      ? html`<textarea class="card-edit" rows="3" aria-label=${label} .value=${value}
          @click=${common.click} @blur=${common.blur} @keydown=${onKey}></textarea>`
      : html`<input class="card-edit" type="text" aria-label=${label} .value=${value}
          @click=${common.click} @blur=${common.blur} @keydown=${onKey}>`;
  }

  renderItems(node, path) {
    const items = node?.items || [];
    if (!items.length) return this.renderDropSlot(path, 0, { empty: true });
    return html`
      ${items.map((item, index) => html`
        ${this.renderDropSlot(path, index)}
        ${this.renderCard(item, [...path, index])}
      `)}
      ${this.renderDropSlot(path, items.length)}
    `;
  }

  renderLayoutView() {
    const rootSelected = samePath([], this._selected);
    return html`
      <div class="canvas-scroll" @click=${() => this.inspect([])}>
        <div class="canvas-doc form-card ${rootSelected ? 'is-selected' : ''}"
          @click=${(e) => { e.stopPropagation(); this.inspect([]); }}>
          <div class="card-head">
            <button type="button" class="card-title form-head" aria-pressed=${rootSelected}
              @click=${(e) => { e.stopPropagation(); this.inspect([]); }}>
              <span class="card-type">Form</span>
              <span class="form-title">${stripHtml(this._form.title) || 'Untitled form'}</span>
            </button>
          </div>
          <div class="form-items" @dragover=${(e) => { if (this._drag) e.preventDefault(); }}
            @drop=${(e) => this.handleDrop(e, [], (this._form.items || []).length)}>
            ${this.renderItems(this._form, [])}
          </div>
        </div>
      </div>
    `;
  }

  // ---- Preview view: the form as visitors get it (preview.html) ----

  handlePreviewMessage({ data, origin, source }) {
    const frame = this.shadowRoot?.querySelector('iframe.preview-frame');
    const previewOrigin = new URL(this.previewUrl, window.location.href).origin;
    if (origin !== previewOrigin || !frame || source !== frame.contentWindow) return;
    if (data?.source === 'formeditor-preview' && data.type === 'ready' && this._form) {
      frame.contentWindow.postMessage({ type: 'render', definition: this._form }, previewOrigin);
    }
  }

  renderPreviewView() {
    return html`<div class="preview-view">
      <div class="json-status" role="status">Preview of the current form, unsaved changes included. Rules run; submitting is disabled.
        <button type="button" class="quiet-btn small" @click=${this.reloadPreview}>Reload</button>
      </div>
      <iframe class="preview-frame" title="Form preview" src=${this.previewUrl}></iframe>
    </div>`;
  }

  reloadPreview() {
    this.shadowRoot?.querySelector('iframe.preview-frame')?.contentWindow?.location.reload();
  }

  renderCanvas() {
    if (this._view === 'preview') {
      return html`<section class="canvas view-preview" aria-label="Form preview">${this.renderPreviewView()}</section>`;
    }
    return html`
      <section class="canvas view-${this._view}" aria-label="Form canvas">
        ${this._view !== 'content' ? html`<div class="canvas-pane pane-layout">${this.renderLayoutView()}</div>` : nothing}
        ${this._view !== 'layout' ? html`<div class="canvas-pane pane-content">${this.renderContentView()}</div>` : nothing}
      </section>
    `;
  }

  // ---- Render: inspector ----

  // A property sheet is the Crispr form stored with the component (component-property-forms.json):
  // panels are tabs, fields are bound to the item's properties with dataRef.

  commitField(target, field, raw, original) {
    const key = fromDataRef(field.dataRef);
    const label = field.label?.value || key;
    const errors = { ...this._fieldErrors };
    delete errors[key];
    let value = raw;
    if (typeof value === 'string' && !field.properties?.['fe:richText']) value = value.trim();
    if (field.required && (value === '' || value === undefined || (Array.isArray(value) && !value.length))) {
      errors[key] = `${label} is required.`;
    } else if (field.pattern && typeof value === 'string' && value
      && !new RegExp(field.pattern).test(value)) {
      errors[key] = field.constraintMessages?.pattern || `${label} is not valid.`;
    }
    this._fieldErrors = errors;
    if (errors[key]) return;
    if (field.fieldType === 'number-input' && value !== '' && value !== undefined) {
      value = field.type === 'number' ? Number(value) : String(value);
    }
    if (Array.isArray(value) && Array.isArray(original)) {
      // keep non-string enum values (numbers, booleans) when their text did not change
      value = value.map((v, i) => (String(original[i]) === v ? original[i] : v));
    }
    const current = getPath(target.length ? getItem(this._form, target) : this._form, key);
    if (JSON.stringify(current) === JSON.stringify(value === '' ? undefined : value)) return;
    this.setProperty(target, key, value);
  }

  renderField(target, obj, field) {
    const key = fromDataRef(field.dataRef);
    const id = `f-${field.name}`;
    const value = getPath(obj, key);
    const error = this._fieldErrors[key];
    const disabled = !this._canWrite;
    const text = field.label?.value || key;
    const label = html`<label class="field-label" for=${id}>${text}${field.required ? html`<span class="required" aria-hidden="true">*</span>` : nothing}</label>`;
    const describedBy = error ? `${id}-error` : nothing;
    const commit = (raw) => this.commitField(target, field, raw, value);
    const options = (field.enum || [])
      .map((v, i) => ({ value: v, name: field.enumNames?.[i] ?? String(v) }));
    let control;
    switch (field.fieldType) {
      case 'checkbox': {
        // unchecking stores false only when the default is true, otherwise removes the key
        const unchecked = field.default === true ? false : undefined;
        const checked = value === undefined ? field.default === true : value === true;
        return html`<div class="field field-boolean">
          <label class="switch">
            <input id=${id} type="checkbox" .checked=${checked} ?disabled=${disabled}
              @change=${(e) => commit(e.target.checked ? true : unchecked)}>
            <span>${text}</span>
          </label>
          ${field.description ? html`<p class="help">${field.description}</p>` : nothing}
        </div>`;
      }
      case 'drop-down':
      case 'radio-group':
        control = html`<select id=${id} ?disabled=${disabled} aria-describedby=${describedBy} @change=${(e) => commit(e.target.value)}>
          <option value="" ?selected=${value === undefined || value === ''}>—</option>
          ${options.map((o) => html`<option value=${o.value} ?selected=${String(value) === String(o.value)}>${o.name}</option>`)}
          ${value !== undefined && value !== '' && !options.some((o) => String(o.value) === String(value)) ? html`<option value=${value} selected>${value}</option>` : nothing}
        </select>`;
        break;
      case 'checkbox-group': {
        const values = [value ?? []].flat().map(String);
        control = html`<select id=${id} multiple size=${Math.min(6, Math.max(3, options.length))} ?disabled=${disabled} aria-describedby=${describedBy}
          @change=${(e) => commit([...e.target.selectedOptions].map((o) => o.value))}>
          ${options.map((o) => html`<option value=${o.value} ?selected=${values.includes(String(o.value))}>${o.name}</option>`)}
        </select>`;
        break;
      }
      case 'number-input':
        control = html`<input id=${id} type="number" .value=${value ?? ''} ?disabled=${disabled} aria-describedby=${describedBy} @change=${(e) => commit(e.target.value)}>`;
        break;
      case 'date-input':
        control = html`<input id=${id} type="date" .value=${value ?? ''} ?disabled=${disabled} aria-describedby=${describedBy} @change=${(e) => commit(e.target.value)}>`;
        break;
      case 'multiline-input':
        if (field.type === 'string[]' || Array.isArray(value)) {
          control = html`<textarea id=${id} rows="4" .value=${[value ?? []].flat().join('\n')} ?disabled=${disabled}
            aria-describedby=${describedBy} placeholder="One value per line"
            @change=${(e) => commit(e.target.value.split('\n').map((v) => v.trim()).filter(Boolean))}></textarea>`;
        } else {
          control = html`<textarea id=${id} rows="4" .value=${value ?? ''} ?disabled=${disabled} aria-describedby=${describedBy} @change=${(e) => commit(e.target.value)}></textarea>`;
        }
        break;
      default:
        control = html`<input id=${id} type="text" .value=${value === undefined || value === null ? '' : String(value)}
          placeholder=${field.placeholder || nothing} ?disabled=${disabled} aria-describedby=${describedBy}
          aria-invalid=${error ? 'true' : 'false'} @change=${(e) => commit(e.target.value)}>`;
    }
    return html`<div class="field ${error ? 'has-error' : ''}">
      ${label}
      ${control}
      ${error ? html`<p class="field-error" id="${id}-error">${error}</p>` : nothing}
      ${field.description ? html`<p class="help">${field.description}</p>` : nothing}
    </div>`;
  }

  renderJsonEditor(target, obj) {
    const text = this._jsonDraft ?? JSON.stringify(obj, null, 2);
    const apply = () => {
      try {
        const parsed = JSON.parse(this._jsonDraft ?? text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The JSON must be an object.');
        this.mutate((form) => {
          if (!target.length) {
            Object.keys(form).forEach((k) => delete form[k]);
            Object.assign(form, parsed);
          } else {
            getItem(form, target.slice(0, -1)).items[target[target.length - 1]] = parsed;
          }
        });
        this._jsonDraft = undefined;
        this._jsonError = '';
      } catch (e) {
        this._jsonError = e.message;
      }
    };
    return html`<div class="field json-field">
      <label class="field-label" for="json-editor">JSON of ${target.length ? 'this item' : 'the whole form'}</label>
      <textarea id="json-editor" class="code" rows="18" spellcheck="false" .value=${text} ?disabled=${!this._canWrite}
        @input=${(e) => { this._jsonDraft = e.target.value; this._jsonError = ''; }}></textarea>
      ${this._jsonError ? html`<p class="field-error" role="alert">${this._jsonError}</p>` : nothing}
      ${this._canWrite ? html`<div class="json-actions">
        <button type="button" class="quiet-btn" ?disabled=${this._jsonDraft === undefined} @click=${() => { this._jsonDraft = undefined; this._jsonError = ''; }}>Reset</button>
        <button type="button" class="accent-btn" ?disabled=${this._jsonDraft === undefined} @click=${apply}>Apply</button>
      </div>` : nothing}
    </div>`;
  }

  renderItemActions(path) {
    const index = path[path.length - 1];
    const count = getItem(this._form, path.slice(0, -1))?.items?.length || 0;
    return html`<span class="card-actions" role="toolbar" aria-label="Item actions">
      <button type="button" class="icon-btn" aria-label="Edit text" title="Edit text" @click=${(e) => { e.stopPropagation(); this.startEdit(path); }}>${icon('edit', 16)}</button>
      <button type="button" class="icon-btn" aria-label="Move up" title="Move up" ?disabled=${index === 0} @click=${(e) => { e.stopPropagation(); this.moveBy(path, -1); }}>${icon('up', 16)}</button>
      <button type="button" class="icon-btn" aria-label="Move down" title="Move down" ?disabled=${index >= count - 1} @click=${(e) => { e.stopPropagation(); this.moveBy(path, 1); }}>${icon('down', 16)}</button>
      <button type="button" class="icon-btn" aria-label="Duplicate" title="Duplicate" @click=${(e) => { e.stopPropagation(); this.duplicate(path); }}>${icon('copy', 16)}</button>
      <button type="button" class="icon-btn danger" aria-label="Delete" title="Delete" @click=${(e) => { e.stopPropagation(); this.removeSelected(path); }}>${icon('trash', 16)}</button>
    </span>`;
  }

  isFieldShown(field, obj) {
    const condition = field.properties?.['fe:visibleWhen'];
    return condition === undefined || evaluateCondition(condition, obj);
  }

  renderInspector() {
    const target = this._selected;
    if (!target) {
      return html`<div class="panel-body"><p class="empty-note">Select an item to edit its properties.</p></div>`;
    }
    const obj = target.length ? getItem(this._form, target) : this._form;
    const component = target.length ? this._catalog.resolve(obj) : null;
    const sheet = target.length
      ? this._catalog.propertyForm(component) : this._catalog.rootPropertyForm();
    const tabs = (sheet?.items || [])
      .map((panel) => ({ label: panel.label?.value, fields: panel.items || [] }));
    tabs.push({ label: 'JSON', json: true });
    const active = tabs[Math.min(this._tab, tabs.length - 1)];
    const title = target.length ? (component?.title || obj?.fieldType || 'Item') : 'Form';
    return html`
      <div class="inspector" aria-label="Block Inspector">
        <div class="inspector-head">
          <h2>${title}</h2>
          <p class="inspector-sub">${target.length ? itemLabel(obj) : (stripHtml(this._form.title) || 'Form settings')}</p>
        </div>
        ${sheet ? nothing : html`<p class="notice info inline">No Universal Editor model matches this item${obj?.fieldType ? html` (fieldType <code>${obj.fieldType}</code>)` : nothing}. Edit it as JSON.</p>`}
        <div class="tabs is-wrap sub-tabs" role="tablist" aria-label="Property groups">
          ${tabs.map((tab, i) => html`
            <button type="button" role="tab" class="tab ${tab === active ? 'is-selected' : ''}" aria-selected=${tab === active} @click=${() => { this._tab = i; }}>${tab.label}</button>
          `)}
        </div>
        <div class="panel-body inspector-body">
          ${active.json ? this.renderJsonEditor(target, obj) : active.fields
    .filter((field) => field.dataRef && this.isFieldShown(field, obj))
    .map((field) => this.renderField(target, obj, field))}
        </div>
      </div>
    `;
  }

  // ---- Render: picker, states ----

  renderPicker() {
    return html`
      <div class="picker">
        <h1>Open a form</h1>
        <p class="picker-sub">Forms are Structured Content JSON documents (<code>schemaName: adaptive-form</code>) in <code>${this.storageLabel}</code>.</p>
        <form class="picker-row" @submit=${(e) => { e.preventDefault(); if (this._pickerPath.trim()) this.openDocument(this._pickerPath); }}>
          <label class="visually-hidden" for="picker-path">Document path</label>
          <input id="picker-path" type="text" placeholder="/forms/contact (.json)" .value=${this._pickerPath} @input=${(e) => { this._pickerPath = e.target.value; }}>
          <button type="submit" class="accent-btn" ?disabled=${!this._pickerPath.trim()}>Open</button>
        </form>
        <form class="picker-row" @submit=${this.createDocument}>
          <label class="visually-hidden" for="new-name">New form name or path</label>
          <input id="new-name" type="text" placeholder="New form: a name (created in ${FORMS_FOLDER}) or a path, e.g. /hr/onboarding" .value=${this._newName} @input=${(e) => { this._newName = e.target.value; }}>
          <button type="submit" class="quiet-btn" ?disabled=${!this._newName.trim()}>${icon('plus', 14)} Create</button>
        </form>
        <h2>Forms and fragments in the site</h2>
        ${this._docsLoading ? html`<p class="empty-note" role="status">Looking for form documents…</p>` : nothing}
        ${!this._docsLoading && !this._docs.length ? html`<p class="empty-note">No form documents in the site.</p>` : nothing}
        <ul class="doc-list">
          ${this._docs.map((doc) => html`<li><button type="button" class="doc-item" @click=${() => this.openDocument(doc.path)}>
            <span>${doc.path.replace(/\.json$/i, '')}</span>
            <span class="doc-meta">${doc.title ? `${doc.title} · ` : ''}${doc.kind}</span>
          </button></li>`)}
        </ul>
      </div>
    `;
  }

  renderBody() {
    switch (this._status) {
      case 'loading':
        return html`<div class="center" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div><p>Loading…</p></div>`;
      case 'error':
        return html`<div class="center"><p class="notice error" role="alert">${this._error}</p>
          ${this.storage ? html`<button type="button" class="quiet-btn" @click=${this.showPicker}>Open another form</button>` : nothing}</div>`;
      case 'picker':
        return this.renderPicker();
      default:
        return this.renderCanvas();
    }
  }

  render() {
    const ready = this._status === 'ready';
    const left = ready && this.coworkerShown;
    const right = ready && this._view !== 'preview' && this._toolsOpen;
    return html`
      <div class="shell ${left ? 'has-left' : ''} ${right ? 'has-right' : ''}">
        ${left ? this.renderCoworker() : nothing}
        <main class="main-card">
          ${this.renderHeader()}
          ${this.renderNotices()}
          <div class="main-body">${this.renderBody()}</div>
        </main>
        ${right ? this.renderSidePanel() : nothing}
      </div>
    `;
  }
}

if (!customElements.get('form-editor')) customElements.define('form-editor', FormEditor);

/**
 * Mounts a Form Editor in `container`. `storage` and `assistant` override the registry;
 * the other options are those of the element's `options` property.
 */
export function mountFormEditor(container, { storage, assistant, ...options } = {}) {
  const editor = document.createElement('form-editor');
  if (storage) editor.storage = storage;
  if (assistant) editor.assistant = assistant;
  editor.options = options;
  container.append(editor);
  return editor;
}
