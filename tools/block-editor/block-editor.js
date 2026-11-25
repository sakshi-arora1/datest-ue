import { LitElement, html, nothing } from 'da-lit';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { setConfig } from 'https://da.live/nx2/scripts/nx.js';
import {
  config, ADMIN_URLS, isLocalHost, setAdminEnvironment,
} from './config.js';
import { createDocumentActions, IMAGE_FILE_TYPES } from './document.js';
import { createImagePreviews } from './image-preview.js';
import {
  normalizeBlockName, buildBlockFieldDefinitions, resolveBlockFields,
  processBlockOptions, normalizeForSlashMenu, sameTarget, EditorSession,
} from './fields.js';
import {
  configureLibrary, loadBlockLibrary, loadBlockOptions, resetBlockLibraryCache,
  resetBlockOptionsCache, isMultiBlock, getMultiBlockTemplateRow,
  getBlockFieldTemplate, getBlockVariantChoices,
} from './library.js';

const codeBase = new URL('.', import.meta.url).href.replace(/\/$/, '');
await setConfig({ codeBase });
await import('https://da.live/nx2/blocks/shared/picker/picker.js');
async function getSheet(url) {
  const response = await fetch(String(url));
  if (!response.ok) throw new Error(`Unable to load styles: ${url}`);
  const sheet = new CSSStyleSheet();
  await sheet.replace(await response.text());
  return sheet;
}
const [formStyle, buttonsStyle, pageStyle, style] = await Promise.all([
  getSheet('https://da.live/nx2/styles/form.css'),
  getSheet('https://da.live/nx2/styles/buttons.css'),
  getSheet(new URL('./layout.css', import.meta.url)),
  getSheet(new URL('./block-editor.css', import.meta.url)),
]);

const ADD_ICON_SRC = `${codeBase}/img/icons/s2-icon-addcircle-20-n.svg`;
const DELETE_ICON_SRC = `${codeBase}/img/icons/s2-icon-delete-20-n.svg`;
const MAX_ITEM_TEXT_LENGTH = 30;
const OUT_OF_SYNC_ERRORS = new Set(['STALE_REVISION', 'STALE_LIVE', 'WRONG_DOCUMENT', 'WRONG_SELECTION']);

export class EwBlockProperties extends LitElement {
  static properties = {
    _name: { state: true },
    _disabled: { state: true },
    _hasBlock: { state: true },
    _variant: { state: true },
    _variantOptions: { state: true },
    _isMulti: { state: true },
    _multiTemplateRow: { state: true },
    _itemCount: { state: true },
    _itemTable: { state: true },
    _expandedItems: { state: true },
    _dragIndex: { state: true },
    _dropIndex: { state: true },
    _listDrag: { state: true },
    _listDrop: { state: true },
    _fieldDefinitions: { state: true },
    _blockOptions: { state: true },
    _fieldError: { state: true },
    _fieldErrorCode: { state: true },
    _libraryError: { state: true },
    _generateFieldsContext: { state: true },
    _fieldsGenerationRequested: { state: true },
    _refreshingLibrary: { state: true },
    _hostError: { state: true },
    _documentBusy: { state: true },
    _imagePreviewError: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [formStyle, buttonsStyle, pageStyle, style];
    this._hashState = undefined;
    this._variantOptions = [];
    this._isMulti = false;
    this._multiTemplateRow = null;
    this._fieldDefinitions = [];
    this._blockOptions = null;
    this._fieldError = '';
    this._fieldErrorCode = '';
    this._fieldErrorGeneration = 0;
    this._libraryError = '';
    this._expandedItems = new Set();
    this._generateFieldsContext = null;
    this._fieldsGenerationRequested = false;
    this._session = new EditorSession();
    this._documentBusy = false;
    this._documentOperation = null;
    this._fieldWriteQueue = Promise.resolve();
    this._imagePreviewError = '';
    this._imageUploadTarget = null;
    this._disabled = true;
    this._hostError = 'Connecting to editor…';
    this._connect();
  }

  async _connect() {
    const connection = (this._connection ?? 0) + 1;
    this._connection = connection;
    try {
      const sdk = await DA_SDK;
      if (!this.isConnected || this._connection !== connection) return;
      if (sdk.capabilities?.liveDocument !== 1
        || sdk.capabilities?.sendHTMLReplace !== 1
        || typeof sdk.actions?.subscribeLiveDocument !== 'function'
        || typeof sdk.actions?.sendHTML !== 'function'
        || typeof sdk.actions?.daFetch !== 'function') {
        this._hostError = 'This host does not support live document subscriptions, HTML replacement and authenticated fetching. Update the canvas host and SDK.';
        return;
      }
      this._actions = createDocumentActions(sdk, {
        admin: config.admin,
        onSnapshot: (snapshot) => {
          if (!this.isConnected || this._connection !== connection) return;
          this._session.receive(snapshot);
          this._refresh();
        },
      });
      configureLibrary(this._actions);
      this._imagePreviews = createImagePreviews(sdk, {
        onChange: (error) => {
          if (!this.isConnected || this._connection !== connection) return;
          if (error) this._imagePreviewError = error;
          this.requestUpdate();
        },
      });
      const context = sdk.context || {};
      const project = sdk.project || {};
      const org = context.org || project.org;
      const site = context.site || context.repo || project.site || project.repo;
      this._hashState = { org, site };
      this._hostError = '';
      const unsubscribe = sdk.actions.subscribeLiveDocument((value) => {
        if (!this.isConnected || this._connection !== connection) return;
        try {
          this._actions.receiveLiveDocument(value);
          this._hostError = '';
        } catch (error) {
          this._hostError = `Live document unavailable: ${error.message}`;
        }
      });
      if (!this.isConnected || this._connection !== connection) unsubscribe();
      else this._unsubscribeLiveDocument = unsubscribe;
    } catch (error) {
      if (this.isConnected && this._connection === connection) this._hostError = `Unable to connect: ${error.message}`;
    }
  }

  _discardDrafts() {
    this._session.drafts.clear();
    this._fieldError = '';
    this._fieldErrorCode = '';
    this._refresh();
  }

  _commitLink(field, href) {
    return this._commitValue(field, 'href', href, 'setLink');
  }

  _chooseImage(field, event) {
    const request = this._captureField(field);
    if (!request) return;
    this._imageUploadTarget = request;
    const input = event.currentTarget.closest('.ew-block-field').querySelector('input[type="file"]');
    input.value = '';
    input.click();
  }

  async _uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const request = this._imageUploadTarget;
    this._imageUploadTarget = null;
    if (!file) return;
    if (!request || !this._isFieldTargetCurrent(request)) {
      this._fieldErrorCode = 'WRONG_SELECTION';
      this._fieldError = 'The selected image changed. Choose the intended image again.';
      return;
    }
    if (this._documentBusy) {
      this._fieldErrorCode = 'BUSY';
      this._fieldError = 'Wait for the current document operation.';
      return;
    }
    const connection = this._connection;
    this._documentBusy = true;
    const operation = (async () => {
      const uploaded = await this._run('uploadImage', request, file);
      if (!uploaded || !this.isConnected || this._connection !== connection) return;
      if (!this._isFieldTargetCurrent(request)) {
        this._fieldErrorCode = 'WRONG_SELECTION';
        this._fieldError = 'The document or selected image changed during upload. Choose the intended image again.';
        return;
      }
      await this._run('applyChanges', {
        ...request, changes: [{ type: 'setImage', target: request.target, src: uploaded.src }],
      });
    })();
    this._documentOperation = operation;
    try {
      await operation;
    } finally {
      if (this._connection === connection && this._documentOperation === operation) {
        this._documentBusy = false;
        this._documentOperation = null;
      }
    }
  }

  _changeList(field, from, to) {
    const target = this._captureField(field);
    if (!target) return;
    if (from !== null && (from < 0 || from >= field.items.length)) return;
    if (from !== null && to === null && field.items.length <= 1) return;
    if (from !== null && to !== null && (from === to || to < 0 || to >= field.items.length)) return;
    this._apply(target, { type: 'changeList', target: field.target, from, to: to ?? null });
  }

  _renderTextField(field, disabled) {
    const id = `ew-block-field-${field.key}`;
    let control;
    if (field.values?.length) {
      control = html`
        <nx-picker id=${id} size="m" variant="field" placement="below-start"
          aria-label=${field.label} placeholder="Please Select"
          ?inert=${disabled || field.readOnly}
          aria-disabled=${disabled || field.readOnly}
          .items=${field.values.map(({ title, value }) => ({ label: title, value }))}
          .value=${this._session.value(field, 'value')}
          .labelOverride=${field.values.some(({ value }) => value === field.value) ? '' : field.value}
          @focusin=${() => this._session.draft(field, 'value', this._session.value(field, 'value'))}
          @change=${(e) => this._commitText(field, e.detail.value)}></nx-picker>`;
    } else if (field.multiline) {
      control = html`
        <textarea id=${id} class="nx-input ew-block-textarea" rows="4" .value=${this._session.value(field, 'value')}
          ?readonly=${disabled || field.readOnly}
          @focus=${() => this._session.draft(field, 'value', this._session.value(field, 'value'))}
          @input=${(e) => this._session.draft(field, 'value', e.target.value)}
          @blur=${(e) => this._commitText(field, e.target.value)}></textarea>`;
    } else {
      control = html`<input id=${id} class="nx-input" type="text" .value=${this._session.value(field, 'value')}
        ?readonly=${disabled || field.readOnly}
        @focus=${() => this._session.draft(field, 'value', this._session.value(field, 'value'))}
        @input=${(e) => this._session.draft(field, 'value', e.target.value)}
        @blur=${(e) => this._commitText(field, e.target.value)}>`;
    }
    return html`
      <label for=${id}>${field.label}</label>
      ${control}
      ${field.href !== undefined ? html`
        <label for="${id}-url">URL</label>
        <input id="${id}-url" class="nx-input" type="url" .value=${this._session.value(field, 'href')}
          ?readonly=${disabled || field.readOnly}
          @focus=${() => this._session.draft(field, 'href', this._session.value(field, 'href'))}
          @input=${(e) => this._session.draft(field, 'href', e.target.value)}
          @blur=${(e) => this._commitLink(field, e.target.value)}>
      ` : nothing}`;
  }

  _renderListField(field, disabled) {
    return html`
      <section class="ew-block-items" aria-label=${field.label}>
        <div class="ew-block-items-header">
          <h4 class="nx-form-field">${field.label}</h4>
          <button type="button" class="nx-action-btn-icon nx-btn-sm"
            aria-label=${`Add item to ${field.label}`} ?disabled=${disabled}
            @click=${() => this._changeList(field, null)}>
            <svg aria-hidden="true" viewBox="0 0 20 20"><use href="${ADD_ICON_SRC}#icon"></use></svg>
          </button>
        </div>
        <ol class="ew-block-item-list">
          ${Array.from({ length: field.items.length + 1 }, (_, index) => html`
            <li class="ew-block-drop-zone" role="presentation" aria-hidden="true"
              ?data-drop-active=${this._listDrop?.key === field.key && this._listDrop.index === index}
              @dragover=${(e) => {
                if (disabled || this._listDrag?.key !== field.key) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this._listDrop = { key: field.key, index };
              }}
              @dragleave=${() => {
                if (this._listDrop?.key === field.key && this._listDrop.index === index) {
                  this._listDrop = null;
                }
              }}
              @drop=${(e) => {
                e.preventDefault();
                const drag = this._listDrag;
                this._clearListDragState();
                if (drag?.key === field.key && drag.target
                  && this._isFieldTargetCurrent(drag.target)) {
                  this._changeList(field, drag.index, index > drag.index ? index - 1 : index);
                }
              }}></li>
            ${index < field.items.length ? html`
            <li class="ew-block-item ${this._listDrag?.key === field.key && this._listDrag.index === index ? 'is-dragging' : ''}"
              draggable=${!disabled}
              tabindex=${disabled ? -1 : 0} aria-label=${field.items[index].label}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              title="Drag to reorder, or press Alt+ArrowUp / Alt+ArrowDown"
              @dragstart=${(e) => {
                if (disabled || e.target.closest('input, button')) {
                  e.preventDefault();
                  return;
                }
                this._listDrag = { target: this._captureField(field), key: field.key, index };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', field.items[index].key);
              }}
              @dragend=${this._clearListDragState}
              @keydown=${(e) => {
                if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
                e.preventDefault();
                this._changeList(field, index, index + (e.key === 'ArrowUp' ? -1 : 1));
              }}>
              <svg class="ew-block-item-grip" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="5" cy="4" r="1"></circle><circle cx="11" cy="4" r="1"></circle>
                <circle cx="5" cy="8" r="1"></circle><circle cx="11" cy="8" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle><circle cx="11" cy="12" r="1"></circle>
              </svg>
              <div class="nx-form-field ew-block-list-item ${field.items[index].href !== undefined ? 'ew-block-field-group' : ''}"
                aria-disabled=${disabled || field.items[index].readOnly}>
                ${this._renderTextField(field.items[index], disabled || !field.items[index].target)}
              </div>
              <button type="button" class="nx-action-btn-icon nx-btn-sm ew-block-list-delete"
                draggable="false" aria-label=${`Delete item ${index + 1} from ${field.label}`}
                title=${field.items.length === 1 ? 'At least one list item must remain' : 'Delete item'}
                ?disabled=${disabled || field.items.length === 1}
                @click=${() => this._changeList(field, index, null)}>
                <svg aria-hidden="true" viewBox="0 0 20 20"><use href="${DELETE_ICON_SRC}#icon"></use></svg>
              </button>
            </li>` : nothing}`)}
        </ol>
      </section>`;
  }

  _clearListDragState() {
    this._listDrag = null;
    this._listDrop = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._connection = (this._connection ?? 0) + 1;
    this._unsubscribeLiveDocument?.();
    this._unsubscribeLiveDocument = null;
    this._actions?.dispose?.();
    this._actions = null;
    this._imagePreviews?.dispose();
    this._imagePreviews = null;
    this._imageUploadTarget = null;
    this._documentOperation = null;
    this._fieldWriteQueue = Promise.resolve();
    this._variantLoadId = (this._variantLoadId ?? 0) + 1;
    this._multiLoadId = (this._multiLoadId ?? 0) + 1;
    this._fieldLoadId = (this._fieldLoadId ?? 0) + 1;
    this._clearDragState();
    this._clearListDragState();
  }

  _refresh() {
    const { snapshot } = this._session;
    const block = snapshot?.blocks.find((entry) => sameTarget(entry.target, snapshot.selectedBlock));
    const prevName = this._name;
    const prevVariant = this._variant;
    const previous = this._itemTable;
    this._name = block?.name || '';
    this._variant = block?.variant || '';
    this._hasBlock = !!block;
    this._disabled = !block || snapshot.editable === false;
    const documentChanged = this._documentId !== snapshot.documentId;
    if (this._name !== prevName || this._variant !== prevVariant
      || documentChanged || !sameTarget(block?.target, previous?.target)) {
      this._fieldsGenerationRequested = false;
      this._expandedItems = new Set();
    } else if (previous && block) {
      const previousKeys = previous.rows.map((row) => row.key);
      const nextKeys = block.rows.map((row) => row.key);
      const reordered = nextKeys.some((key, index) => key !== undefined
        && previousKeys.includes(key) && previousKeys.indexOf(key) !== index);
      this._expandedItems = new Set([...this._expandedItems].flatMap((index) => {
        const next = previousKeys[index] === undefined ? -1 : nextKeys.indexOf(previousKeys[index]);
        if (next >= 0) return [next];
        return !reordered && previous.rows.length === block.rows.length ? [index] : [];
      }));
    }
    if (this._revision !== snapshot.revision || this._disabled
      || !sameTarget(block?.target, previous?.target) || documentChanged) {
      this._clearDragState();
      this._clearListDragState();
    }
    this._documentId = snapshot.documentId;
    this._revision = snapshot.revision;
    this._itemTable = block || null;
    this._itemCount = block?.rows.length || 0;
    if (this._name !== prevName || this._variant !== prevVariant || documentChanged) {
      this._fieldError = '';
      this._fieldErrorCode = '';
      this._reloadLibrary();
    }
    this.requestUpdate();
  }

  async _reloadLibrary() {
    const identity = `${this._documentId}:${this._name}:${this._variant}`;
    try {
      await Promise.all([this._loadVariants(), this._loadMultiBlock(), this._loadFields()]);
    } catch (error) {
      if (this.isConnected && identity === `${this._documentId}:${this._name}:${this._variant}`) {
        this._libraryError = `Unable to load block library: ${error.message}`;
      }
    }
  }

  async _loadMultiBlock() {
    const loadId = (this._multiLoadId ?? 0) + 1;
    this._multiLoadId = loadId;
    this._isMulti = false;
    this._multiTemplateRow = null;
    this._clearDragState();
    const { org, site } = this._hashState ?? {};
    const name = this._name;
    const variant = this._variant;
    if (!org || !site || !name) return;
    const multi = await isMultiBlock(org, site, name);
    if (loadId !== this._multiLoadId || !this.isConnected) return;
    this._isMulti = multi;
    if (!multi) return;
    const { blocks } = await loadBlockLibrary(org, site);
    const match = await getBlockFieldTemplate(blocks, name, variant, this._actions);
    const row = match?.item.dom.rows[1] ?? await getMultiBlockTemplateRow(org, site, name);
    if (loadId !== this._multiLoadId || !this.isConnected) return;
    this._multiTemplateRow = row;
  }

  _getItemView({ editable = true } = {}) {
    if (!this._isMulti || !this._itemTable || (editable && (this._disabled || this._documentBusy))) return null;
    return this._session.capture(this._itemTable.target);
  }

  _scrollToItem(index) {
    if (this._dragSource || !this._getItemView({ editable: false })) return;
    this._expandedItems = new Set([...this._expandedItems, index]);
  }

  _onItemClick(e, index) {
    if (e.target.closest('button')) return;
    this._scrollToItem(index);
  }

  _onAddItem() {
    const view = this._getItemView();
    if (!view || !this._multiTemplateRow) return;
    this._apply(view, { type: 'appendBlockRow', target: view.target, html: this._multiTemplateRow.outerHTML });
  }

  _onDeleteItem(index) {
    const view = this._getItemView();
    if (!view) return;
    this._apply(view, { type: 'deleteBlockRow', target: view.target, rowIndex: index });
  }

  _clearDragState() {
    this._dragSource = null;
    this._dragIndex = undefined;
    this._dropIndex = undefined;
  }

  _onItemDragStart(e, index) {
    const view = this._getItemView();
    if (!view || e.target.closest('button, input, nx-picker')) {
      e.preventDefault();
      return;
    }
    this._dragSource = { ...view, index };
    this._dragIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-da-block-item', String(index));
  }

  _onItemDragOver(e, index) {
    if (!this._dragSource || !this._getItemView()) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    this._dropIndex = index;
  }

  _onItemDragLeave(index) {
    if (this._dropIndex === index) this._dropIndex = undefined;
  }

  _onItemDrop(e, index) {
    e.preventDefault();
    e.stopPropagation();
    const source = this._dragSource;
    const targetIndex = this._dropIndex;
    const view = this._getItemView();
    this._clearDragState();
    if (!view || !source || !this._isFieldTargetCurrent(source) || targetIndex !== index) return;
    const destination = index - (source.index < index ? 1 : 0);
    if (destination === source.index) return;
    this._moveItem(source, source.index, destination);
  }

  _onItemKeydown(e, index) {
    if (e.target !== e.currentTarget) return;
    if (['Enter', ' '].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this._scrollToItem(index);
      return;
    }
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const view = this._getItemView();
    if (!view) return;
    e.preventDefault();
    e.stopPropagation();
    const destination = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (destination < 0 || destination >= this._itemCount) return;
    this._moveItem(view, index, destination).then(() => {
      this.updateComplete.then(() => {
        this.shadowRoot.querySelectorAll('.ew-block-multi-item')[destination]?.focus();
      });
    });
  }

  async _moveItem(request, from, to) {
    const result = await this._apply(request, { type: 'moveBlockRow', target: request.target, from, to });
    if (!result) return;
    this._expandedItems = new Set([...this._expandedItems].map((index) => {
      if (index === from) return to;
      if (from < to && index > from && index <= to) return index - 1;
      if (from > to && index >= to && index < from) return index + 1;
      return index;
    }));
  }

  _renderItemPreview(index) {
    const content = [];
    const addText = (text) => {
      const value = text.replace(/\s+/g, ' ').trim();
      if (value) {
        content.push(html`<span class="ew-block-item-text">${Array.from(value).slice(0, MAX_ITEM_TEXT_LENGTH).join('')}</span>`);
      }
    };
    const addImage = (field) => {
      if (field.value) {
        content.push(html`<img class="ew-block-item-thumbnail" src=${this._imagePreviews?.get(field.previewSrc || field.value) ?? nothing}
          alt=${field.alt || ''} loading="lazy" decoding="async" draggable="false">`);
      }
    };
    this._itemTable.rows[index].cells.flatMap((cell) => cell.fields).forEach((field) => {
      if (field.type === 'image') addImage(field);
      else if (field.type === 'list') field.items.forEach((item) => addText(item.value));
      else addText(field.value);
    });
    return content.length ? content.map((item, itemIndex) => html`
      ${itemIndex ? html`<span class="ew-block-item-separator" aria-hidden="true"></span>` : nothing}
      ${item}
    `) : html`<span class="ew-block-item-label">item ${index + 1}</span>`;
  }

  _renderItems() {
    if (!this._isMulti) return nothing;
    const fields = this._fields;
    return html`
      <section class="ew-block-items" aria-labelledby="block-items-heading">
        <div class="ew-block-items-header">
          <h4 id="block-items-heading" class="nx-form-field">Items</h4>
          <button type="button" class="nx-action-btn-icon nx-btn-sm"
            aria-label="Add item" title="Add item"
            ?disabled=${this._disabled || !this._multiTemplateRow} @click=${this._onAddItem}>
            <svg aria-hidden="true" viewBox="0 0 20 20"><use href="${ADD_ICON_SRC}#icon"></use></svg>
          </button>
        </div>
        <ol class="ew-block-item-list">
          ${Array.from({ length: this._itemCount + 1 }, (_, index) => html`
            <li class="ew-block-drop-zone" role="presentation" aria-hidden="true"
              ?data-drop-active=${this._dropIndex === index}
              @dragover=${(e) => this._onItemDragOver(e, index)}
              @dragleave=${() => this._onItemDragLeave(index)}
              @drop=${(e) => this._onItemDrop(e, index)}></li>
            ${index < this._itemCount ? html`
            <li class="ew-block-item ew-block-multi-item ${this._dragIndex === index ? 'is-dragging' : ''}"
              draggable=${!this._disabled && !this._expandedItems.has(index)}
              tabindex=${this._disabled ? -1 : 0}
              aria-label=${`Item ${index + 1}`} aria-keyshortcuts="Enter Space Alt+ArrowUp Alt+ArrowDown"
              title="Click to scroll to item. Drag to reorder, or press Alt+ArrowUp / Alt+ArrowDown"
              @click=${(e) => this._onItemClick(e, index)}
              @dragstart=${(e) => this._onItemDragStart(e, index)}
              @dragend=${this._clearDragState}
              @keydown=${(e) => this._onItemKeydown(e, index)}>
              <div class="ew-block-item-header" draggable=${!this._disabled}>
              <svg class="ew-block-item-grip" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="5" cy="4" r="1"></circle><circle cx="11" cy="4" r="1"></circle>
                <circle cx="5" cy="8" r="1"></circle><circle cx="11" cy="8" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle><circle cx="11" cy="12" r="1"></circle>
              </svg>
              ${this._fieldDefinitions.length ? html`
              <button type="button" class="nx-action-btn-icon nx-btn-sm ew-block-item-toggle"
                draggable="false" aria-label=${`Edit item ${index + 1} fields`}
                aria-expanded=${this._expandedItems.has(index)}
                aria-controls=${`ew-block-item-fields-${index}`}
                @click=${() => {
                  const expanded = new Set(this._expandedItems);
                  if (expanded.has(index)) expanded.delete(index);
                  else expanded.add(index);
                  this._expandedItems = expanded;
                }}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"></path>
                </svg>
              </button>
              ` : nothing}
              <div class="ew-block-item-preview">${this._renderItemPreview(index)}</div>
              <button type="button" class="nx-action-btn-icon nx-btn-sm"
                draggable="false" aria-label=${`Delete item ${index + 1}`}
                ?disabled=${this._disabled} @click=${() => this._onDeleteItem(index)}>
                <svg aria-hidden="true" viewBox="0 0 20 20"><use href="${DELETE_ICON_SRC}#icon"></use></svg>
              </button>
              </div>
              ${this._expandedItems.has(index) ? html`
                <div class="ew-block-item-fields" id=${`ew-block-item-fields-${index}`}
                  @click=${(e) => e.stopPropagation()}
                  @keydown=${(e) => e.stopPropagation()}
                  @dragstart=${(e) => e.stopPropagation()}
                  @dragend=${(e) => e.stopPropagation()}>
                  ${fields.filter((field) => field.itemIndex === index)
                    .map((field) => this._renderField(field))}
                </div>
              ` : nothing}
            </li>` : nothing}`)}
        </ol>
      </section>`;
  }

  async _loadFields() {
    const loadId = (this._fieldLoadId ?? 0) + 1;
    this._fieldLoadId = loadId;
    this._fieldDefinitions = [];
    this._blockOptions = null;
    this._generateFieldsContext = null;
    this._libraryError = '';
    const { org, site } = this._hashState ?? {};
    const name = this._name;
    const variant = this._variant;
    if (!org || !site || !name || !this._actions) return;
    try {
      const [multi, { ext, blocks, warnings = [] }, options] = await Promise.all([
        isMultiBlock(org, site, name), loadBlockLibrary(org, site), loadBlockOptions(org, site),
      ]);
      if (loadId !== this._fieldLoadId || !this.isConnected) return;
      const match = await getBlockFieldTemplate(blocks, name, variant, this._actions);
      if (loadId !== this._fieldLoadId || !this.isConnected) return;
      this._isMulti = multi;
      this._blockOptions = processBlockOptions(options);
      if (!match && warnings.some((warning) => (
        normalizeBlockName(warning.name) === normalizeBlockName(name)
      ))) throw new Error(`The template for ${name} is unavailable. Retry loading the library.`);
      this._generateFieldsContext = {
        org,
        site,
        name,
        variant,
        multi,
        templateRowCount: match ? match.template.rows.length : null,
        librarySources: ext?.sources ?? [],
        blockPath: match?.path,
      };
      const definitions = buildBlockFieldDefinitions(match, { multi });
      this._fieldDefinitions = definitions;
      if (definitions.length) this._generateFieldsContext = null;
    } catch (error) {
      if (loadId !== this._fieldLoadId || !this.isConnected) return;
      this._libraryError = `Unable to load block fields: ${error.message}`;
      if (this._generateFieldsContext) {
        this._generateFieldsContext = {
          ...this._generateFieldsContext,
          validationError: error.message,
        };
      }
    }
  }

  _onGenerateFields() {
    const context = this._generateFieldsContext;
    const block = this._itemTable;
    if (!context || !block || block.name !== context.name
      || block.variant !== context.variant) return;
    const library = context.librarySources.length
      ? context.librarySources.map((source) => `- ${source}`).join('\n')
      : 'No block library is configured. Resolve the blocks library for this organization/site first.';
    const text = `Generate sidebar field definitions for the currently selected block variant.

Selected block:
- Organization/site: ${context.org}/${context.site}
- Block name: ${context.name}
- Variant: ${context.variant || '(no variant)'}
- Exact block table header: ${block.name}${block.variant ? ` (${block.variant})` : ''}
- Multi-item block: ${context.multi ? 'yes' : 'no'}
- Block library type config: ${context.multi ? `block=${context.name}, property=multi` : 'not configured as multi'}
${context.multi ? `- Library template sample items: ${context.templateRowCount ?? '(not loaded; inspect the library)'}
` : `- Library template content rows: ${context.templateRowCount ?? '(not loaded; inspect the library)'}
`}- Matching block library document: ${context.blockPath || 'Locate it by following the library index entries below.'}

Configured block library index sources:
${library}

Block type rules (authoritative):
- ONLY the selected block's type configuration in the block library editor sheet determines whether it is multi-item. Never infer this from row count, similar-looking rows, the block name, or the presence of a list.
- If the block is NOT configured as multi, generate fields for ALL N content rows, even if those rows look like repeated cards. They are not sample items to skip.
- If the block IS configured as multi, generate fields for ONLY the FIRST content row, regardless of N. Only in this case are later library rows sample items sharing the first row's schema.
- The block name/variant header is not included in N.

${context.validationError ? `Existing fields metadata failed sidebar validation:
${context.validationError}
Inspect and repair ONLY this variant's invalid fields entry. Reuse appropriate existing labels, but correct its rows/cells to the schema rules below. Do not duplicate per-item metadata rows.

` : ''}Inspect the block library before generating anything:
1. Open the configured library index source(s) and follow the block's document path. If a matching library document is listed above, inspect that document.
2. Find ONLY the "${context.name}" variant "${context.variant || '(no variant)'}". Match the actual block table header or block CSS classes, not just a display heading.
3. Read that variant's template rows, cells, text elements, images, lists, and blockquotes. Generate fields from the LIBRARY TEMPLATE, not from extra content in the current page. If the exact variant cannot be found or the source cannot be read, explain what is missing rather than inventing a schema.
${context.multi ? '4. Inspect ONLY the first item row after the block header to define its shared field schema.' : '4. Its field schema must describe all of the library template content rows.'}

Fields metadata format:
- Each library variant can have a "fields" entry in its associated "library-metadata". The entry's value is a nested table.
- The nested table starts with a single header cell containing "fields". This is a header, not an editable field.
- ${context.multi ? 'For this multi-item block, the fields table must contain exactly two rows: the Fields header and ONE content row describing only the first item. That item row must have the same number and order of cells as the first library item row. Every repeating item reuses this schema; do not duplicate the metadata rows.' : 'Subsequent rows mirror the template\'s content rows in the same order, with the same number and order of cells.'} Do not add the block name/variant header as a content row.
- Inside each metadata cell, put one plain paragraph per field label, in the same order as the template content. Use meaningful names, not type declarations or dropdown choices.
- Count each heading/paragraph, image/picture, or whole list as one field. Headings and paragraphs are both text; inline formatting and links do not create extra labels. For blockquotes, label their text blocks, not the wrapper. Ignore empty spacer paragraphs around image-only content.
- A list needs one label for the whole list, not one label per item. Keep the template's cell order and spans; multiple fields in one cell need multiple label paragraphs in that cell, not separate table rows.
- Use the exact label IGNORE to hide a field without changing subsequent field positions. For a key/value row, label the key IGNORE if it should not be edited, and give the value a meaningful label. Hidden fields still occupy their original positions.

${context.multi ? `Illustrative HTML ONLY: a repeating Cards block with THREE sample items and ONE shared first-item schema. These are table-row items, not a list field.
<div class="cards">
  <div><div><picture><img src="/first.png" alt="First"></picture></div><div><h2>First title</h2><p>$39.99</p><p><a href="/first">Shop now</a></p></div></div>
  <div><div><picture><img src="/second.png" alt="Second"></picture></div><div><h2>Second title</h2><p>$249.99</p><p><a href="/second">Shop now</a></p></div></div>
  <div><div><picture><img src="/third.png" alt="Third"></picture></div><div><h2>Third title</h2><p>$14.99</p><p><a href="/third">Shop now</a></p></div></div>
</div>
<div class="library-metadata">
  <div><div><p>fields</p></div><div>
    <table><tbody>
      <tr><td colspan="2"><p>fields</p></td></tr>
      <tr><td><p>Image</p></td><td><p>Title</p><p>Price</p><p>Link</p></td></tr>
    </tbody></table>
  </div></div>
</div>
` : `Illustrative HTML ONLY: the non-repeating Everything Block and its corresponding library metadata.
<div class="everything-block">
  <div><div>
    <h1>Hello World</h1><p>Tagline</p><picture><img src="/example.png"></picture>
    <ul><li>List</li><li>Item 2</li><li>Item 3</li></ul>
    <blockquote><p>A quote</p></blockquote><p>A paragraph</p><p><a href="https://google.com">A link</a></p>
  </div></div>
  <div><div><p>Color</p></div><div><p>Green</p></div></div>
  <div><div><p>Left side</p></div><div><p>Right side</p></div></div>
</div>
<div class="library-metadata">
  <div><div><p>fields</p></div><div><table>
    <tr><td colspan="2"><p>fields</p></td></tr>
    <tr><td colspan="2"><p>title</p><p>tagline</p><p>image</p><p>list below image</p><p>quote</p><p>paragraph</p><p>link</p></td></tr>
    <tr><td><p>IGNORE</p></td><td><p>Color</p></td></tr>
    <tr><td><p>Left Column</p></td><td><p>Right Column</p></td></tr>
  </table></div></div>
</div>
`}
Adapt the rows, cells, and labels to the actual selected library variant; do not blindly copy this example. Add the generated fields table to that variant's existing library metadata, or create associated library metadata if absent. Fill an empty fields entry if one exists. Preserve description, search tags, other metadata, all template content, and all other variants. Do not replace the block or edit the current page to add this schema. ${context.validationError ? 'Repair the existing invalid fields entry identified above; do not overwrite valid fields in other variants.' : 'If nonempty fields already exist in the source, report them rather than overwriting them.'} Show the generated table and identify the exact library document and variant to which it belongs.`;
    this._fieldsGenerationRequested = true;
    this._run('setPrompt', text, { autoSend: true });
  }

  async _onRefreshLibrary() {
    const { org, site } = this._hashState ?? {};
    const block = this._itemTable;
    if (this._refreshingLibrary || !org || !site
      || !block || block.name !== this._name
      || block.variant !== this._variant) return;
    this._refreshingLibrary = true;
    resetBlockLibraryCache();
    resetBlockOptionsCache();
    const loading = Promise.all([
      this._loadVariants(), this._loadMultiBlock(), this._loadFields(),
    ]);
    const loadId = this._fieldLoadId;
    try {
      await loading;
    } catch (error) {
      if (loadId === this._fieldLoadId && this.isConnected) {
        this._libraryError = `Unable to refresh block library: ${error.message}`;
      }
    } finally {
      this._refreshingLibrary = false;
    }
  }

  get _fields() {
    const options = this._blockOptions?.get(this._name);
    const block = this._itemTable;
    const definitions = this._fieldDefinitions ?? [];
    const fields = this._isMulti
      ? Array.from({ length: block?.rows.length || 0 }, (_, itemIndex) => (
        resolveBlockFields(block, definitions, { itemIndex })
      )).flat()
      : resolveBlockFields(block, definitions);
    return fields.map((field) => ({
      ...field,
      values: field.optionKey
        ? options?.get(normalizeForSlashMenu(field.optionKey)) : undefined,
    }));
  }

  _captureField(field) {
    if (this._disabled || this._documentBusy || !this._itemTable || !field.target || field.readOnly
      || !this._fields.flatMap((current) => [current, ...(current.items ?? [])])
        .some((current) => current.key === field.key && !current.readOnly)) return null;
    return this._session.capture(field.target);
  }

  _isFieldTargetCurrent(target) {
    const { snapshot } = this._session;
    return this.isConnected && !this._disabled && snapshot?.documentId === target.documentId
      && snapshot.liveBlockSignature === target.liveBlockSignature
      && snapshot.revision === target.revision && sameTarget(target.target, this._itemTable?.target);
  }

  _commitText(field, value) {
    return this._commitValue(field, 'value', value, 'setText');
  }

  async _commitValue(field, property, value, type) {
    if (this._disabled || !field.target || field.readOnly) return null;
    const session = this._session;
    const connection = this._connection;
    const errorGeneration = this._fieldErrorGeneration;
    const key = session.draft(field, property, value);
    const draft = session.drafts.get(key);
    const pending = this._fieldWriteQueue.then(async () => {
      while (this.isConnected && this._connection === connection && this._documentOperation) {
        // eslint-disable-next-line no-await-in-loop
        await this._documentOperation;
      }
      if (!this.isConnected || this._connection !== connection
        || this._session !== session || session.drafts.get(key) !== draft
        || this._fieldErrorGeneration !== errorGeneration
        || OUT_OF_SYNC_ERRORS.has(this._fieldErrorCode)) return null;
      const edit = session.edit(field, property, value);
      if (!edit) return null;
      const current = this._fields.flatMap((entry) => [entry, ...(entry.items || [])])
        .find((entry) => entry.key === field.key && !entry.readOnly);
      if (edit.conflict || !current || this._disabled) {
        this._setFieldError({ code: 'STALE_LIVE' });
        return null;
      }
      const result = await this._apply(edit.request, {
        type, target: edit.request.target, [property === 'href' ? 'href' : 'value']: value,
      });
      if (result && this.isConnected && this._connection === connection
        && session.drafts.get(key) === draft && !session.acknowledge(edit, property, value)) {
        this._setFieldError({ code: 'STALE_LIVE' });
      }
      this.requestUpdate();
      return result;
    });
    this._fieldWriteQueue = pending;
    return pending;
  }

  _setFieldError(error, action) {
    this._fieldErrorGeneration += 1;
    this._fieldErrorCode = error.code || '';
    this._fieldError = OUT_OF_SYNC_ERRORS.has(error.code)
      ? `${error.code}: The document or selection changed. Discard changes to use the current values.`
      : `${error.code || action}: ${error.message}`;
  }

  async _run(action, ...args) {
    const connection = this._connection;
    this._fieldError = '';
    this._fieldErrorCode = '';
    try {
      if (!this._actions?.[action]) throw new Error('This feature is unavailable with the standard SDK.');
      return await this._actions[action](...args);
    } catch (error) {
      if (this.isConnected && this._connection === connection) {
        this._setFieldError(error, action);
      }
      return null;
    }
  }

  async _apply(request, change) {
    if (this._documentBusy) {
      this._fieldErrorCode = 'BUSY';
      this._fieldError = 'Wait for the current document operation.';
      return null;
    }
    this._documentBusy = true;
    const operation = this._run('applyChanges', { ...request, changes: [change] });
    this._documentOperation = operation;
    try {
      return await operation;
    } finally {
      if (this._documentOperation === operation) {
        this._documentBusy = false;
        this._documentOperation = null;
      }
    }
  }

  _renderField(field) {
    const disabled = this._disabled || this._documentBusy || !field.target || field.readOnly;
    let control = nothing;
    if (field.type === 'text') control = this._renderTextField(field, disabled);
    if (field.type === 'list') control = this._renderListField(field, disabled);
    return html`
          <div class="nx-form-field ew-block-field ${field.type === 'list' || field.href !== undefined ? 'ew-block-field-group' : ''}"
            data-field=${field.label}
            aria-disabled=${disabled || field.readOnly}>
            ${field.type === 'image' ? html`
              <label>${field.label}</label>
              ${field.value ? html`<img class="ew-block-field-image"
                src=${this._imagePreviews?.get(field.previewSrc || field.value) ?? nothing}
                alt=${field.alt || ''}>` : nothing}
              <input type="file" hidden accept=${Object.values(IMAGE_FILE_TYPES).join(',')}
                ?disabled=${disabled} @change=${this._uploadImage}>
              <button type="button" class="nx-form-btn-secondary"
                aria-label=${`Replace ${field.label || 'image'}`}
                ?disabled=${disabled} @click=${(event) => this._chooseImage(field, event)}>
                Replace image
              </button>
            ` : control}
            ${field.error ? html`<span class="nx-input-error-msg" role="alert">${field.error}</span>` : nothing}
          </div>`;
  }

  _renderEditError() {
    if (!this._fieldError) return nothing;
    return html`
      <p class="nx-input-error-msg" role="alert">${this._fieldError}</p>
      ${this._session.drafts.size || OUT_OF_SYNC_ERRORS.has(this._fieldErrorCode) ? html`
        <button type="button" class="nx-form-btn-secondary"
          @click=${this._discardDrafts}>Discard changes</button>` : nothing}`;
  }

  _renderFields() {
    return html`
      ${this._generateFieldsContext ? html`
        <button type="button" class="nx-form-btn-secondary ew-block-generate-fields"
          ?disabled=${this._refreshingLibrary}
          @click=${this._onGenerateFields}>
          ${this._generateFieldsContext.validationError ? 'Repair fields' : 'Generate fields'}
        </button>
      ` : nothing}
      ${this._fieldsGenerationRequested && !this._fieldDefinitions.length ? html`
        <button type="button" class="nx-form-btn-secondary ew-block-refresh-library"
          ?disabled=${this._refreshingLibrary} @click=${this._onRefreshLibrary}>
          ${this._refreshingLibrary ? 'Refreshing...' : 'Refresh'}
        </button>
      ` : nothing}
      ${this._isMulti ? nothing : this._fields.map((field) => this._renderField(field))}
      ${this._libraryError ? html`<p class="nx-input-error-msg" role="alert">${this._libraryError}</p>` : nothing}
      ${this._renderEditError()}`;
  }

  async _loadVariants() {
    const loadId = (this._variantLoadId ?? 0) + 1;
    this._variantLoadId = loadId;
    this._variantOptions = [];
    const { org, site } = this._hashState ?? {};
    const name = this._name;
    if (!org || !site || !name) return;
    const { blocks } = await loadBlockLibrary(org, site);
    const options = await getBlockVariantChoices(blocks, name);
    if (loadId !== this._variantLoadId || !this.isConnected) return;
    this._variantOptions = options;
  }

  _onVariantChange(e) {
    if (this._disabled || this._documentBusy || !this._itemTable) return;
    const request = this._session.capture(this._itemTable.target);
    this._apply(request, { type: 'setBlockVariant', target: request.target, value: e.detail.value });
  }

  _renderVariantPicker() {
    if (!this._variantOptions?.length) return nothing;
    const value = this._variantOptions
      .find((v) => normalizeBlockName(v.value) === normalizeBlockName(this._variant))?.value ?? '';
    return html`
      <div class="nx-form-field ew-pm-control ew-block-variant"
        ?inert=${this._disabled || this._documentBusy} aria-disabled=${this._disabled || this._documentBusy}>
        <span>Variant</span>
        <nx-picker size="m" variant="field" placement="below-start"
          aria-label="Block variant"
          .items=${[
            { value: '', label: 'No variant' },
            ...this._variantOptions,
          ]}
          .value=${value}
          .labelOverride=${this._variant && !value ? this._variant : ''}
          @change=${this._onVariantChange}></nx-picker>
      </div>`;
  }

  _openBlockLibrary() {
    if (!this._itemTable || this._documentBusy) return null;
    return this._run('showPanel', 'blocks');
  }

  _renderAdminSelector(hostname = window.location.hostname) {
    if (!isLocalHost(hostname)) return nothing;
    return html`
      <label class="nx-form-field ew-admin-selector">
        <span>Admin environment</span>
        <select class="nx-input"
          ?disabled=${this._documentBusy}
          @change=${(event) => setAdminEnvironment(event.target.value)}>
          ${!Object.values(ADMIN_URLS).includes(config.admin)
    ? html`<option value=${config.admin} selected disabled>Custom (${config.admin})</option>` : nothing}
          <option value=${ADMIN_URLS.stage} ?selected=${config.admin === ADMIN_URLS.stage}>Stage</option>
          <option value=${ADMIN_URLS.prod} ?selected=${config.admin === ADMIN_URLS.prod}>Prod</option>
        </select>
      </label>
    `;
  }

  render() {
    return html`${this._renderAdminSelector()}
      ${this._imagePreviewError ? html`<p class="nx-input-error-msg" role="alert">${this._imagePreviewError}</p>` : nothing}
      ${this._renderEditor()}`;
  }

  _renderEditor() {
    const switchIcon = html`<svg aria-hidden="true" viewBox="0 0 20 20"><use href="${codeBase}/img/icons/s2-icon-switch-20-n.svg#icon"></use></svg>`;
    if (this._hostError) return html`<p class="ew-block-empty" role="status">${this._hostError}</p>`;
    if (!this._session?.snapshot) return html`<p class="ew-block-empty" role="status">Waiting for a live canvas document…</p>`;
    return html`
      ${!this._hasBlock ? this._renderEditError() : nothing}
      <div class="ew-page-metadata" aria-busy=${!!this._documentBusy}>
        <div class="ew-pm-fields" ?inert=${this._documentBusy}>
          ${this._hasBlock ? html`<div class="nx-form-field ew-pm-control">
            <span>Block</span>
            <button type="button" class="ew-block-name"
              aria-label=${`Open block library for ${this._name}`}
              aria-haspopup="dialog"
              ?disabled=${this._documentBusy}
              title="Open block library to replace the selected canvas block"
              @click=${this._openBlockLibrary}
              >${html`<span>${this._name}</span>`}${switchIcon}</button>
          </div>${this._renderVariantPicker()}${this._renderFields()}${this._renderItems()}
            ${this._libraryError && !OUT_OF_SYNC_ERRORS.has(this._fieldErrorCode) ? html`
              <button type="button" class="nx-form-btn-secondary"
                ?disabled=${this._refreshingLibrary} @click=${this._onRefreshLibrary}>
                ${this._refreshingLibrary ? 'Loading library…' : 'Retry loading library'}
              </button>` : nothing}
          ` : html`<div class="ew-block-empty-state">
            <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48">
              <use href=${`${codeBase}/img/no-block-selected.svg#icon`}></use>
            </svg>
            <p class="ew-block-empty">No block selected</p>
          </div>`}
        </div>
      </div>
      `;
  }
}

customElements.define('ew-block-properties', EwBlockProperties);
