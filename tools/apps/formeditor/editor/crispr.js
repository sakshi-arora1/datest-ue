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
 * Pure helpers for Crispr (Adaptive Form JSON) definitions stored as Structured Content documents.
 *
 * A form is a JSON document in DA (for example /forms/contact.json) in the Structured Content
 * document shape, as agreed in the SC "JSON storage format" RFC:
 *
 *   { "metadata": { "schemaName": "adaptive-form", ... }, "data": { ...Crispr form... } }
 *
 * The document is stored and read as JSON as it is, with no conversion. Every edit is applied by
 * JSON path on the parsed definition, and other properties of the document and of its metadata
 * are written back unchanged, so properties the editor does not know about survive a roundtrip.
 *
 * No DOM, network or host access here: the module is shared by the editor, the storage
 * implementations and the Node unit tests.
 */

export const SCHEMA_NAME = 'adaptive-form';

export const NEW_FORM_JSON = {
  adaptiveform: '0.10.0',
  metadata: { grammar: 'json-formula-1.0.0', version: '1.0.0' },
  items: [],
};

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** Compact serialization of a definition, used to compare versions. */
export function encodeDefinition(definition) {
  return JSON.stringify(definition);
}

/** A new Structured Content document holding an empty form. */
export function newFormDocument({ title } = {}) {
  const data = structuredClone(NEW_FORM_JSON);
  if (title) data.title = title;
  return { metadata: { schemaName: SCHEMA_NAME, ...(title ? { title } : {}) }, data };
}

/**
 * The path and title of a new form typed as a name ("Newsletter Signup", created in `folder`)
 * or as a path ("/hr/onboarding", in any folder). Returns `{}` when nothing usable is typed.
 */
export function newFormPath(input, folder = '/forms/') {
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const raw = String(input || '').trim().replace(/\.json$/i, '');
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return {};
  const title = parts[parts.length - 1];
  const segments = parts.map(slug);
  if (segments.some((segment) => !segment)) return {};
  const base = raw.includes('/') ? '/' : folder;
  return { path: `${base}${segments.join('/')}.json`, title };
}

/** Normalizes a form document path to `/folder/name.json`. */
export function toDocPath(path) {
  const clean = `/${String(path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return /\.json$/i.test(clean) ? clean : `${clean}.json`;
}

/**
 * Splits a stored form document (a parsed JSON object) into the document (metadata and any other
 * properties) and the form definition (its `data`). A bare Crispr definition is accepted too and
 * gets wrapped in a document when it is saved.
 */
export function parseFormDocument(json) {
  if (!isObject(json)) throw new Error('The document is not a JSON object.');
  if (typeof json[':type'] === 'string') {
    throw new Error('The document is a spreadsheet, not a form document.');
  }
  if (isObject(json.metadata) && isObject(json.data)) {
    const { data, ...document } = json;
    return { document, definition: data };
  }
  if (json.adaptiveform !== undefined || Array.isArray(json.items)) {
    return { document: { metadata: { schemaName: SCHEMA_NAME } }, definition: json };
  }
  throw new Error('The document is not a form document: it needs "metadata" and "data".');
}

/** The form document object with `definition` as its `data`. */
export function buildFormDocument(document, definition) {
  const metadata = { schemaName: SCHEMA_NAME, ...(document?.metadata || {}) };
  return { ...document, metadata, data: definition };
}

/** Parses the text of a stored form document (see parseFormDocument). */
export function readFormDocument(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`The document is not valid JSON: ${e.message}`);
  }
  return parseFormDocument(json);
}

/** Serializes a form document with the given definition as its `data`. */
export function writeFormDocument(document, definition) {
  return `${JSON.stringify(buildFormDocument(document, definition), null, 2)}\n`;
}

export const FORM_SCHEMAS = {
  'adaptive-form': 'Form',
  'adaptive-form-fragment': 'Fragment',
};

function countFields(node) {
  return (node?.items || []).reduce((total, item) => total
    + (Array.isArray(item?.items) ? countFields(item) : 1), 0);
}

/**
 * Describes a parsed JSON document if it is a form or form fragment document ({ metadata,
 * data } with a schemaName of FORM_SCHEMAS), otherwise returns null.
 */
export function describeForm(json) {
  if (!isObject(json) || !isObject(json.metadata) || !isObject(json.data)) return null;
  const { schemaName } = json.metadata;
  if (!Object.hasOwn(FORM_SCHEMAS, schemaName)) return null;
  const strip = (text) => (typeof text === 'string' ? text.replace(/<[^>]+>/g, '').trim() : '');
  return {
    schemaName,
    kind: FORM_SCHEMAS[schemaName],
    title: strip(json.metadata.title) || strip(json.data.title) || strip(json.data.label?.value),
    fields: countFields(json.data),
  };
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
