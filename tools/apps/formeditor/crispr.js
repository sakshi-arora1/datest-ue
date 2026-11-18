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

/*
 * Pure helpers for Crispr (Adaptive Form JSON) definitions stored in DA documents.
 *
 * A form lives in a document as a `form` block whose cell holds the JSON in <pre><code>
 * (see ue/models/blocks/form.json and blocks/form/form.js). Everything outside that <code>
 * element is kept byte for byte, and every edit is applied by JSON path on the parsed
 * definition, so properties the editor does not know about survive a load/save roundtrip.
 *
 * No DOM or network access here: the module is shared by the app and the Node unit tests.
 */

export const NEW_FORM_JSON = {
  adaptiveform: '0.10.0',
  metadata: { grammar: 'json-formula-1.0.0', version: '1.0.0' },
  items: [],
};

const FORM_BLOCK_RE = /<div\s+class="form(?:\s[^"]*)?"\s*>/gi;
const CODE_RE = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i;
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

export function decodeHtml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function encodeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Finds the <code> content range of every form block of a DA document. */
export function findFormBlocks(html) {
  const starts = [...html.matchAll(FORM_BLOCK_RE)];
  return starts.flatMap((match, i) => {
    const from = match.index + match[0].length;
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const code = CODE_RE.exec(html.slice(from, end));
    if (!code) return [];
    const openTagEnd = code[0].indexOf('>', code[0].search(/<code/i)) + 1;
    const start = from + code.index + openTagEnd;
    return [{ start, end: start + code[1].length, raw: decodeHtml(code[1]) }];
  });
}

/**
 * Parses the code content like blocks/form/form.js does. `encoding` is 'string' when the JSON
 * is stored as a JSON string literal (double encoded) so that it is written back the same way.
 */
export function decodeDefinition(raw) {
  const content = raw.trim();
  if (content.startsWith('"') && content.endsWith('"')) {
    return { definition: JSON.parse(JSON.parse(content)), encoding: 'string' };
  }
  try {
    return { definition: JSON.parse(content), encoding: 'json' };
  } catch (e) {
    // DA code blocks may carry soft line breaks inside the JSON text
    return { definition: JSON.parse(content.replace(/\r?\n/g, '')), encoding: 'json' };
  }
}

export function encodeDefinition(definition, encoding = 'json') {
  const json = JSON.stringify(definition);
  return encoding === 'string' ? JSON.stringify(json) : json;
}

/** Reads the form definition of the `index`th form block of a DA document. */
export function readForm(html, index = 0) {
  const blocks = findFormBlocks(html);
  if (!blocks.length) return { count: 0 };
  const block = blocks[index];
  if (!block) throw new Error(`The document has no form block #${index + 1}.`);
  const { definition, encoding } = decodeDefinition(block.raw);
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('The form block does not hold a form definition object.');
  }
  return { count: blocks.length, definition, encoding };
}

/** Returns the document with the `index`th form block's JSON replaced, nothing else changed. */
export function writeForm(html, definition, { index = 0, encoding = 'json' } = {}) {
  const block = findFormBlocks(html)[index];
  if (!block) throw new Error(`The document has no form block #${index + 1}.`);
  const code = encodeHtml(encodeDefinition(definition, encoding));
  return `${html.slice(0, block.start)}${code}${html.slice(block.end)}`;
}

const formSection = (definition) => `<div><div class="form"><div><div><pre><code>${encodeHtml(encodeDefinition(definition))}</code></pre></div></div></div></div>`;

export function newFormDocument(definition = NEW_FORM_JSON) {
  return `<body><header></header><main>${formSection(definition)}</main><footer></footer></body>`;
}

/** Appends a section with a new form block to the end of the document's <main>. */
export function appendFormSection(html, definition = NEW_FORM_JSON) {
  const at = html.lastIndexOf('</main>');
  if (at < 0) throw new Error('The document has no <main> element.');
  return `${html.slice(0, at)}${formSection(definition)}${html.slice(at)}`;
}

// ---- JSON paths ('label.value', 'properties.fd:submit.actionName') ----

export function getPath(obj, name) {
  return name.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const isEmpty = (value) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0);

/** Sets a value by path; an empty value removes the key (and the parents it left empty). */
export function setPath(obj, name, value) {
  const keys = name.split('.');
  const parents = [obj];
  let target = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (target[key] === null || typeof target[key] !== 'object') {
      if (isEmpty(value)) return obj;
      target[key] = {};
    }
    target = target[key];
    parents.push(target);
  }
  const last = keys[keys.length - 1];
  if (!isEmpty(value)) {
    target[last] = value;
    return obj;
  }
  delete target[last];
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    const child = parents[i][keys[i]];
    if (!child || typeof child !== 'object' || Array.isArray(child) || Object.keys(child).length) break;
    delete parents[i][keys[i]];
  }
  return obj;
}

// ---- Item tree (a path is the list of indexes into nested `items` arrays) ----

export function getItem(form, path) {
  return path.reduce((node, index) => node?.items?.[index], form);
}

export function isContainer(item) {
  return Array.isArray(item?.items) || item?.fieldType === 'panel';
}

export function samePath(a, b) {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True when `ancestor` is a strict ancestor of `path`. */
export function isAncestor(ancestor, path) {
  return ancestor.length < path.length && ancestor.every((v, i) => v === path[i]);
}

export function walkItems(form, visit, path = []) {
  (form?.items || []).forEach((item, index) => {
    const itemPath = [...path, index];
    visit(item, itemPath);
    if (Array.isArray(item?.items)) walkItems(item, visit, itemPath);
  });
}

export function insertItem(form, parentPath, index, item) {
  const parent = getItem(form, parentPath);
  if (!parent || typeof parent !== 'object') throw new Error('Invalid container.');
  if (!Array.isArray(parent.items)) parent.items = [];
  const at = Math.max(0, Math.min(index ?? parent.items.length, parent.items.length));
  parent.items.splice(at, 0, item);
  return [...parentPath, at];
}

export function removeItem(form, path) {
  const parent = getItem(form, path.slice(0, -1));
  return parent.items.splice(path[path.length - 1], 1)[0];
}

/**
 * Moves the item at `from` into the container at `parentPath`, before the item that is at
 * `index` before the move. Returns the item's new path.
 */
export function moveItem(form, from, parentPath, index) {
  if (samePath(from, parentPath) || isAncestor(from, parentPath)) {
    throw new Error('An item cannot be moved into itself.');
  }
  const depth = from.length - 1;
  const fromIndex = from[depth];
  const fromParent = from.slice(0, depth);
  const target = [...parentPath];
  let at = index ?? getItem(form, parentPath)?.items?.length ?? 0;
  // removing the item shifts its later siblings (and paths through them) one place up
  if (samePath(fromParent, target) && at > fromIndex) at -= 1;
  if (isAncestor(fromParent, target) && target[depth] > fromIndex) target[depth] -= 1;
  const item = removeItem(form, from);
  return insertItem(form, target, at, item);
}

export function collectNames(form) {
  const names = new Set();
  walkItems(form, (item) => { if (item?.name) names.add(item.name); });
  return names;
}

/** Returns `<base><n>` not yet in `names`, and adds it to `names`. */
export function uniqueName(names, base) {
  const stem = String(base || 'field').replace(/[^A-Za-z0-9_]/g, '_').replace(/\d+$/, '') || 'field';
  let n = 1;
  while (names.has(`${stem}${n}`)) n += 1;
  names.add(`${stem}${n}`);
  return `${stem}${n}`;
}

/** Deep copy of an item with fresh unique names (and no ids) for it and its descendants. */
export function duplicateItem(form, item) {
  const names = collectNames(form);
  const copy = structuredClone(item);
  const rename = (node) => {
    if (!node || typeof node !== 'object') return;
    delete node.id;
    if (node.name) node.name = uniqueName(names, node.name);
    (node.items || []).forEach(rename);
  };
  rename(copy);
  return copy;
}

// ---- UE component catalog (component-definition/models/filters/json-mappings) ----

function matchesWhen(item, when) {
  return Object.entries(when).every(([name, expected]) => {
    const actual = getPath(item, name);
    if (typeof expected === 'string' && expected.length > 1 && expected.startsWith('/') && expected.endsWith('/')) {
      const re = new RegExp(expected.slice(1, -1));
      return [actual].flat().some((v) => v != null && re.test(String(v)));
    }
    return actual === expected;
  });
}

/** Resolves the UE component id of a form item, as component-json-mappings.json describes. */
export function resolveComponent(item, mapping, componentIds) {
  const rules = mapping?.component || {};
  const hit = (rules.match || []).find((rule) => matchesWhen(item, rule.when || {}));
  if (hit && componentIds.has(hit.component)) return hit.component;
  const keys = rules.keys || [':type', 'fieldType'];
  const id = keys.map((key) => item?.[key])
    .filter((value) => typeof value === 'string')
    .map((value) => rules.aliases?.[value] || value)
    .find((value) => componentIds.has(value));
  return id || null;
}

/** Evaluates the JSONLogic subset used by UE model field conditions. */
export function evaluateCondition(condition, data) {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) {
    return condition;
  }
  const [op] = Object.keys(condition);
  const args = [condition[op]].flat();
  const val = (arg) => evaluateCondition(arg, data);
  switch (op) {
    case 'var': return getPath(data, String(args[0]));
    case '===': case '==': return val(args[0]) === val(args[1]);
    case '!==': case '!=': return val(args[0]) !== val(args[1]);
    case 'and': return args.every((a) => val(a));
    case 'or': return args.some((a) => val(a));
    case '!': return !val(args[0]);
    default: return true;
  }
}

export function flattenFields(fields = []) {
  return fields.flatMap((field) => (Array.isArray(field.fields)
    ? [field, ...flattenFields(field.fields)] : [field]));
}

/** Builds a new item for a UE component from its model defaults and mapping defaults. */
export function createItem(form, componentId, { models = [], mapping } = {}) {
  const model = models.find((m) => m.id === componentId);
  const item = {};
  flattenFields(model?.fields).forEach((field) => {
    if (field.name && field.value !== undefined && field.component !== 'tab') {
      setPath(item, field.name, structuredClone(field.value));
    }
  });
  const defaults = mapping?.defaults?.[componentId];
  if (defaults) Object.assign(item, structuredClone(defaults));
  if (!item.fieldType && !item[':type']) item.fieldType = componentId;
  const names = collectNames(form);
  item.name = uniqueName(names, componentId.replace(/^form-/, '').replace(/-/g, '_'));
  walkItems(item, (child) => {
    if (!child.name) child.name = uniqueName(names, (child.fieldType || 'item').replace(/-/g, '_'));
  });
  return item;
}

export function itemLabel(item) {
  const strip = (text) => (typeof text === 'string' ? text.replace(/<[^>]+>/g, '').trim() : '');
  const label = strip(item?.label?.value);
  if (label) return label;
  if (item?.fieldType === 'plain-text') {
    const text = strip(item.value);
    if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }
  return item?.name || item?.fieldType || 'Item';
}
