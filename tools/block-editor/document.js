import { normalizeBlockName } from './fields.js';
import { getBlockTableHtml } from './library.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const text = (value) => value.replace(/\s+/g, ' ').trim();
const targetFor = (index, extra = {}) => ({ attribute: 'source-block', index, ...extra });
const sourceRows = new WeakMap();
const sourceCells = new WeakMap();
export const IMAGE_FILE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};
export const MAX_IMAGE_BYTES = 20_000_000;

function validateImageUrl(src) {
  if (typeof src !== 'string' || !/^(https?:\/\/|\.\/media_)/.test(src)) {
    throw fail('INVALID_IMAGE', 'The image must have an HTTP(S) or media-bus URL.');
  }
  let url;
  try { url = new URL(src, 'https://example.invalid/'); } catch {
    throw fail('INVALID_IMAGE', 'The upload did not return a valid image URL.');
  }
  if (url.username || url.password) throw fail('INVALID_IMAGE', 'Image URLs cannot contain credentials.');
}

function contentFields(cell) {
  if (!cell.children.length) return [cell];
  return [...cell.children].flatMap((element) => (
    element.tagName === 'BLOCKQUOTE' ? [...element.children] : [element]
  ));
}

function textContainer(element) {
  const child = element.firstElementChild;
  let container = element.matches('li') && element.children.length === 1 && child.matches('p')
    && text(element.textContent) === text(child.textContent) ? child : element;
  while (container.children.length === 1) {
    const formatted = container.firstElementChild;
    if (!formatted.matches('strong, b, em, i, u, s, strike, del, ins, code, sub, sup, mark, small, span')
      || [...container.childNodes].some((node) => node !== formatted && node.textContent.trim())) break;
    container = formatted;
  }
  return container;
}

function describeField(element, target) {
  const image = element.matches('img') ? element : element.querySelector('img');
  if (image) {
    const images = element.matches('img') ? [element] : [...element.querySelectorAll('img')];
    return {
      type: 'image',
      tagName: element.tagName,
      value: image.getAttribute('src') || '',
      alt: image.alt,
      target,
      readOnly: images.length !== 1 || !!element.textContent.trim(),
    };
  }
  if (element.matches('ul, ol')) {
    return {
      type: 'list',
      tagName: element.tagName,
      target,
      readOnly: [...element.children].some((item) => !item.matches('li')),
      items: [...element.children].map((item, itemIndex) => describeField(item, { ...target, itemIndex })),
    };
  }
  const container = textContainer(element);
  const links = container.matches('a') ? [container] : [...container.querySelectorAll('a')];
  const link = links.length === 1 ? links[0] : null;
  const editable = textContainer(link || container);
  const readOnly = links.length > 1 || [...editable.children].some((child) => child.tagName !== 'BR')
    || (link && text(container.textContent) !== text(link.textContent));
  return {
    type: 'text',
    tagName: element.tagName,
    value: [...editable.childNodes].map((node) => (node.nodeName === 'BR' ? '\n' : node.textContent)).join(''),
    ...(link ? { href: link.getAttribute('href') || '' } : {}),
    multiline: !!editable.querySelector('br'),
    target,
    readOnly: !!readOnly,
  };
}

export function describeBlock({ html, index = 0 }) {
  const doc = parse(html);
  const table = doc.querySelector('table');
  if (!table || !table.rows.length) throw fail('INVALID_BLOCK', 'A block table is required.');
  const header = text(table.rows[0].textContent);
  const match = header.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const name = match?.[1] || header;
  const variant = match?.[2] || '';
  const target = targetFor(index);
  const rows = [...table.rows].slice(1).map((row, rowIndex) => ({
    cells: [...row.cells].map((cell, cellIndex) => ({
      colspan: cell.colSpan,
      rowspan: cell.rowSpan,
      fields: contentFields(cell).map((element, fieldIndex) => (
        describeField(element, { ...target, rowIndex, cellIndex, fieldIndex })
      )),
    })),
  }));
  rows.forEach((row) => {
    if (row.cells.length !== 2) return;
    const [key, value] = row.cells;
    if (key.fields.length === 1 && value.fields.length === 1
      && key.fields[0].type === 'text' && value.fields[0].type === 'text') {
      value.fields[0].optionKey = key.fields[0].value;
    }
  });
  return { name, variant, target, rows };
}

function sourceBlocks(doc) {
  return [...doc.querySelectorAll('main > div > div[class], main > div > table')]
    .filter((element) => !element.matches('.metadata, .section-metadata, .da-metadata, .library-metadata'));
}

function blockTable(element) {
  if (element.tagName === 'TABLE') return element.cloneNode(true);
  const table = getBlockTableHtml(element);
  [...table.rows].slice(1).forEach((row, index) => {
    const source = element.children[index];
    sourceRows.set(row, source);
    [...row.cells].forEach((cell, cellIndex) => sourceCells.set(cell, source.children[cellIndex]));
  });
  return table;
}

function fieldElement(table, target) {
  const cell = table.rows[target.rowIndex + 1]?.cells[target.cellIndex];
  const field = cell && contentFields(cell)[target.fieldIndex];
  return target.itemIndex === undefined ? field : field?.children[target.itemIndex];
}

function replaceText(element, value) {
  element.replaceChildren();
  String(value).split('\n').forEach((line, index) => {
    if (index) element.append(document.createElement('br'));
    element.append(document.createTextNode(line));
  });
}

function applyChange(table, change) {
  const { target } = change;
  const row = table.rows[change.rowIndex + 1];
  if (change.type === 'setBlockVariant') {
    const { name } = describeBlock({ html: table.outerHTML });
    table.rows[0].cells[0].textContent = change.value ? `${name} (${change.value})` : name;
    return;
  }
  if (change.type === 'appendBlockRow') {
    const template = parse(`<table>${change.html}</table>`).querySelector('tr');
    if (!template) throw fail('INVALID_CHANGE', 'Missing template row.');
    table.tBodies[0].append(template);
    return;
  }
  if (change.type === 'deleteBlockRow') {
    if (!row || table.rows.length <= 2) throw fail('INVALID_CHANGE', 'At least one block item must remain.');
    row.remove();
    return;
  }
  if (change.type === 'moveBlockRow') {
    const rows = [...table.rows].slice(1);
    const moved = rows.splice(change.from, 1)[0];
    if (!moved || change.to < 0 || change.to > rows.length) throw fail('INVALID_CHANGE', 'Invalid row destination.');
    rows.splice(change.to, 0, moved);
    rows.forEach((entry) => table.tBodies[0].append(entry));
    return;
  }
  const element = fieldElement(table, target);
  if (!element) throw fail('INVALID_CHANGE', 'The field is no longer available.');
  const descriptor = describeField(element, target);
  if (descriptor.readOnly) throw fail('READ_ONLY', 'This rich or unsupported field cannot be edited safely.');
  if (change.type === 'setImage' && descriptor.type === 'image') {
    validateImageUrl(change.src);
    const image = element.matches('img') ? element : element.querySelector('img');
    image.setAttribute('src', change.src);
    ['srcset', 'sizes', 'width', 'height'].forEach((attribute) => image.removeAttribute(attribute));
    image.closest('picture')?.querySelectorAll('source').forEach((source) => {
      source.setAttribute('srcset', change.src);
      source.removeAttribute('sizes');
      source.removeAttribute('type');
    });
  } else if (change.type === 'setText' && descriptor.type === 'text') {
    replaceText(textContainer(element.matches('a') ? element : element.querySelector('a') || element), change.value);
  } else if (change.type === 'setLink' && descriptor.href !== undefined) {
    const { protocol } = new URL(change.href, 'https://example.invalid/');
    // eslint-disable-next-line no-script-url -- This is a rejection list, not a navigable URL.
    if (['javascript:', 'data:', 'vbscript:'].includes(protocol)) {
      throw fail('INVALID_CHANGE', 'Unsupported link protocol.');
    }
    (element.matches('a') ? element : element.querySelector('a')).setAttribute('href', change.href);
  } else if (change.type === 'changeList' && descriptor.type === 'list') {
    const items = [...element.children];
    if (change.from === null) {
      const item = document.createElement('li');
      item.textContent = 'New item';
      element.append(item);
    } else {
      const moved = items.splice(change.from, 1)[0];
      if (!moved || (change.to === null && !items.length)) throw fail('INVALID_CHANGE', 'Invalid list change.');
      if (change.to !== null) {
        if (change.to < 0 || change.to > items.length) throw fail('INVALID_CHANGE', 'Invalid list destination.');
        items.splice(change.to, 0, moved);
      }
      element.replaceChildren(...items);
    }
  } else throw fail('INVALID_CHANGE', `Unsupported change: ${change.type}`);
}

function writeTable(element, table, change) {
  if (element.tagName === 'TABLE') {
    element.replaceWith(table);
    return table;
  }
  if (change.type === 'setBlockVariant') {
    const { name, variant } = describeBlock({ html: table.outerHTML });
    element.className = [
      normalizeBlockName(name).replaceAll(' ', '-'),
      ...variant.split(',').map((v) => v.trim()).filter(Boolean),
    ].join(' ');
  }
  element.replaceChildren(...[...table.rows].slice(1).map((row) => {
    const div = sourceRows.get(row)?.cloneNode(false) || document.createElement('div');
    [...row.cells].forEach((cell) => {
      const column = sourceCells.get(cell)?.cloneNode(false) || document.createElement('div');
      column.innerHTML = cell.innerHTML;
      div.append(column);
    });
    return div;
  }));
  return element;
}

export function createDocumentActions(sdk, { admin = 'https://admin.da.live', onSnapshot } = {}) {
  const {
    org, site, repo, path, ref = 'main',
  } = { ...sdk.project, ...sdk.context };
  const siteName = site || repo;
  if (!org || !siteName || !path) throw fail('NO_DOCUMENT', 'The SDK did not supply org, site and document path.');
  const pathname = `/${path.replace(/^\/+/, '')}`;
  if (!pathname.endsWith('.html') && /\.[^/]+$/.test(pathname)) throw fail('NO_DOCUMENT', 'Only HTML documents can be edited.');
  const documentId = `/${org}/${siteName}${pathname.endsWith('.html') ? pathname : `${pathname}.html`}`;
  const previewOrigin = `https://${ref === 'local' ? 'main' : ref}--${siteName}--${org}.aem.live`;
  let live;
  let busy = false;
  let disposed = false;
  let siteType;
  const isHlx6 = () => {
    siteType ??= sdk.actions.daFetch(`https://admin.hlx.page/ping/${org}/${siteName}`)
      .then((response) => {
        if (!response.ok) throw fail('CONFIG_FAILED', `Unable to detect site type: ${response.status}`);
        return response.headers.has('x-api-upgrade-available');
      }).catch((error) => { siteType = undefined; throw error; });
    return siteType;
  };
  const base = `${previewOrigin}${pathname}`;
  const publish = () => {
    if (disposed || !live) return null;
    const snapshot = {
      documentId,
      revision: live.html,
      html: live.html,
      liveBlockSignature: live.signatures[live.index] ?? null,
      editable: live.editable,
      blocks: live.blocks,
      selectedBlock: live.blocks[live.index] ? targetFor(live.index) : null,
    };
    onSnapshot?.(snapshot);
    return snapshot;
  };
  const assertLiveTarget = (request) => {
    if (!live || live.index === null || !live.blocks[live.index]
      || !request.changes?.length || request.changes.some((change) => (
        change.target?.attribute !== 'source-block' || change.target.index !== live.index
      ))) throw fail('WRONG_SELECTION', 'The selected canvas block changed. Select the intended block again.');
    if (!request.liveBlockSignature || request.liveBlockSignature !== live.signatures[live.index]) {
      throw fail('STALE_LIVE', 'The live block changed while editing. Review your draft before saving.');
    }
  };
  const assertRequest = (request) => {
    if (disposed || request.documentId !== documentId) throw fail('WRONG_DOCUMENT', 'The document changed.');
    if (!live || request.revision !== live.html) throw fail('STALE_LIVE', 'The live document changed. Review your draft before saving.');
    if (!live.editable) throw fail('READ_ONLY', 'The editor is read-only.');
    if (sdk.capabilities?.sendHTMLReplace !== 1 || typeof sdk.actions.sendHTML !== 'function') {
      throw fail('UNSUPPORTED', 'The host does not support live HTML replacement.');
    }
    assertLiveTarget(request);
  };
  return {
    ...sdk.actions,
    dispose() { disposed = true; },
    describeBlock: async (request) => describeBlock(request),
    getEditorConfig: async () => {
      if (await isHlx6()) {
        const response = await sdk.actions.daFetch(`https://api.aem.live/${org}/sites/${siteName}/config.json`);
        if (!response.ok) throw fail('CONFIG_FAILED', `Unable to load library configuration: ${response.status}`);
        const siteConfig = await response.json();
        const editorConfig = siteConfig.editor?.da || {};
        const config = { ...editorConfig, library: { data: editorConfig.library || [] } };
        return { configs: [config], hasAemAssets: false };
      }
      const configs = await Promise.all([`/${org}`, `/${org}/${siteName}`].map(async (configPath) => {
        const response = await sdk.actions.daFetch(`${admin}/config${configPath}`);
        if (response.status === 404) return null;
        if (!response.ok) throw fail('CONFIG_FAILED', `Unable to load library configuration: ${response.status}`);
        return response.json();
      }));
      return { configs: configs.filter(Boolean), hasAemAssets: false };
    },
    receiveLiveDocument({ html, selection, editable = true }) {
      if (disposed) return null;
      const index = selection?.blockIndex;
      if (typeof html !== 'string' || typeof editable !== 'boolean'
        || (index !== null && (!Number.isSafeInteger(index) || index < 0))) {
        throw fail('INVALID_LIVE', 'The host did not provide a valid live document and block selection.');
      }
      if (!live || live.html !== html) {
        const doc = parse(html);
        if (!doc.querySelector('main')) throw fail('INVALID_LIVE', 'The live document has no main content.');
        const elements = sourceBlocks(doc);
        const blocks = elements.map((element, blockIndex) => {
          const block = describeBlock({ html: blockTable(element).outerHTML, index: blockIndex });
          block.rows.forEach((row) => row.cells.forEach((cell) => cell.fields.forEach((field) => {
            if (field.type === 'image' && field.value) {
              const src = field.value.startsWith('./media') ? field.value.slice(1) : field.value;
              field.previewSrc = new URL(src, base).href;
            }
          })));
          return block;
        });
        live = { html, blocks, signatures: elements.map((element) => element.outerHTML) };
      }
      live.index = index;
      live.editable = editable;
      return publish();
    },
    async uploadImage(request, file) {
      if (busy) throw fail('BUSY', 'Wait for the current document operation.');
      const change = { type: 'setImage', target: request.target };
      const guarded = { ...request, changes: [change] };
      assertRequest(guarded);
      const element = sourceBlocks(parse(live.html))[live.index];
      const field = fieldElement(blockTable(element), request.target);
      const descriptor = field && describeField(field, request.target);
      if (descriptor?.type !== 'image' || descriptor.readOnly) {
        throw fail('READ_ONLY', 'Select a single image field before uploading.');
      }
      if (!(file instanceof File) || !file.size) throw fail('INVALID_FILE', 'Choose a non-empty image file.');
      const extension = file.name.split('.').pop();
      const type = IMAGE_FILE_TYPES[extension.toLowerCase()];
      if (typeof type !== 'string' || (file.type && file.type !== type) || /[/\\]/.test(file.name)
        || [...file.name].some((character) => character.charCodeAt(0) < 32)) {
        throw fail('INVALID_FILE', 'Choose a PNG, JPEG, GIF or SVG image.');
      }
      if (file.size > MAX_IMAGE_BYTES) throw fail('IMAGE_TOO_LARGE', 'Max image size allowed is 20 MB.');
      const folder = pathname.slice(0, pathname.lastIndexOf('/'));
      const name = pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.html$/, '');
      // A replacement must not overwrite an asset still used by other images.
      const filename = `${file.name.slice(0, -extension.length - 1)}-${crypto.randomUUID()}.${extension}`;
      const url = `${admin}/source/${org}/${siteName}${folder}/.${name}/${encodeURIComponent(filename)}`;
      const body = new FormData();
      body.append('data', new Blob([file], { type }), filename);
      busy = true;
      try {
        const response = await sdk.actions.daFetch(url, { method: 'POST', body });
        if (!response.ok) throw fail('UPLOAD_FAILED', `Unable to upload image: ${response.status}`);
        const result = await response.json();
        assertRequest(guarded);
        const src = result?.source?.contentUrl;
        validateImageUrl(src);
        return { src };
      } finally { busy = false; }
    },
    async applyChanges(request) {
      if (busy) throw fail('BUSY', 'Wait for the current document operation.');
      assertRequest(request);
      busy = true;
      try {
        const expected = { html: live.html, blockIndex: live.index };
        const doc = parse(live.html);
        const elements = sourceBlocks(doc);
        let element = elements[live.index];
        request.changes.forEach((change) => {
          const table = blockTable(element);
          applyChange(table, change);
          element = writeTable(element, table, change);
        });
        const result = await sdk.actions.sendHTML(element.outerHTML, { replace: true, expected });
        if (disposed) throw fail('WRONG_DOCUMENT', 'The extension was closed.');
        if (!result?.ok) throw fail(result?.error || 'REPLACE_FAILED', result?.message || 'Unable to replace the live block.');
        if (typeof result.html !== 'string' || !result.selection) {
          throw fail('INVALID_RESPONSE', 'The host did not return the updated live document.');
        }
        if (live.html === expected.html || live.html === result.html) {
          this.receiveLiveDocument(result);
        }
        return publish();
      } finally { busy = false; }
    },
  };
}
