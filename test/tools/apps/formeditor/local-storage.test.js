/* eslint-disable import/no-relative-packages */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FormStorage, assertImplements, Registry } from '../../../../tools/apps/formeditor/editor/contract.js';
import { parseFormDocument, buildFormDocument } from '../../../../tools/apps/formeditor/editor/crispr.js';
import createLocalStorage, { isLocalStorageAvailable } from '../../../../tools/apps/formeditor/providers/local/storage.js';

/** An in-memory Web Storage area (the Storage interface of localStorage). */
function memoryArea() {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

const formDoc = (title, items = []) => ({ metadata: { schemaName: 'adaptive-form', title }, data: { title, items } });
const fragmentDoc = (title) => ({ metadata: { schemaName: 'adaptive-form-fragment' }, data: { title, items: [{ name: 'a' }] } });

const listAll = async (storage, options = {}) => {
  const found = [];
  await storage.list({ ...options, onForm: (form) => found.push(form) });
  return found.sort((a, b) => a.path.localeCompare(b.path));
};

let area;
let storage;
beforeEach(() => {
  area = memoryArea();
  storage = createLocalStorage({ storage: area });
});

test('implements the FormStorage contract', () => {
  assertImplements(FormStorage, storage);
  assert.deepEqual(storage.describe(), { label: 'this browser', kind: 'Local' });
  assert.equal(createLocalStorage({ storage: area, label: 'Kiosk' }).describe().label, 'Kiosk');
});

test('reports whether a storage area can be used', () => {
  assert.equal(isLocalStorageAvailable(area), true);
  assert.equal(area.length, 0, 'the probe entry is removed');
  assert.equal(isLocalStorageAvailable({ setItem() { throw new Error('QuotaExceededError'); } }), false);
  assert.equal(isLocalStorageAvailable(null), false);
});

test('returns null for a document that does not exist', async () => {
  assert.equal(await storage.read('/forms/missing.json'), null);
});

test('writes and reads a document without changing it', async () => {
  const doc = formDoc('Contact', [{ name: 'email', fieldType: 'email', 'x-unknown': { keep: [1, null, true] } }]);
  doc['x-extra'] = 'kept';
  await storage.write('/forms/contact.json', doc);
  const read = await storage.read('/forms/contact.json');
  assert.deepEqual(read, { document: doc, canWrite: true });
  assert.notEqual(read.document, doc, 'reads a copy, not the written object');
});

test('stores each document as JSON under its prefix and path', async () => {
  await storage.write('/forms/a.json', formDoc('A'));
  assert.deepEqual([...area.data.keys()], ['formeditor:doc:/forms/a.json']);
  const entry = JSON.parse(area.getItem('formeditor:doc:/forms/a.json'));
  assert.deepEqual(entry.document, formDoc('A'));
  assert.ok(!Number.isNaN(Date.parse(entry.lastModified)), 'records when it was written');
});

test('replaces a document on a second write', async () => {
  await storage.write('/forms/a.json', formDoc('First'));
  await storage.write('/forms/a.json', formDoc('Second'));
  assert.equal((await storage.read('/forms/a.json')).document.metadata.title, 'Second');
  assert.equal(area.length, 1);
});

test('lists form and fragment documents with their details', async () => {
  await storage.write('/forms/contact.json', formDoc('Contact', [{ name: 'a' }, { name: 'p', items: [{ name: 'b' }] }]));
  await storage.write('/fragments/address.json', fragmentDoc('Address'));
  const found = await listAll(storage);
  assert.deepEqual(found.map(({ lastModified, ...form }) => form), [
    {
      path: '/forms/contact.json', schemaName: 'adaptive-form', kind: 'Form', title: 'Contact', fields: 2,
    },
    {
      path: '/fragments/address.json', schemaName: 'adaptive-form-fragment', kind: 'Fragment', title: 'Address', fields: 1,
    },
  ]);
  assert.ok(found.every((form) => form.lastModified));
});

test('lists only form documents, skipping other entries', async () => {
  await storage.write('/forms/contact.json', formDoc('Contact'));
  await storage.write('/products/shoe.json', { metadata: { schemaName: 'product' }, data: {} });
  await storage.write('/sheets/prices.json', { ':type': 'sheet', data: [] });
  area.setItem('formeditor:doc:/broken.json', '{ not json');
  area.setItem('formeditor:coworker', 'closed');
  area.setItem('unrelated', '1');
  assert.deepEqual((await listAll(storage)).map((f) => f.path), ['/forms/contact.json']);
});

test('filters the listed documents by schema', async () => {
  await storage.write('/forms/contact.json', formDoc('Contact'));
  await storage.write('/fragments/address.json', fragmentDoc('Address'));
  const forms = await listAll(storage, { schemas: ['adaptive-form'] });
  assert.deepEqual(forms.map((f) => f.path), ['/forms/contact.json']);
});

test('reports progress and stops when the listing is cancelled', async () => {
  await storage.write('/forms/a.json', formDoc('A'));
  await storage.write('/forms/b.json', formDoc('B'));
  area.setItem('unrelated', '1');
  const progress = [];
  await storage.list({ onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress, [
    { scanned: 1, total: 2, unreadable: 0 },
    { scanned: 2, total: 2, unreadable: 0 },
  ]);
  const found = [];
  await storage.list({ onForm: (f) => found.push(f), isCancelled: () => found.length > 0 });
  assert.equal(found.length, 1);
});

test('keeps separate stores apart with different prefixes', async () => {
  const other = createLocalStorage({ storage: area, prefix: 'other:' });
  await storage.write('/forms/a.json', formDoc('Mine'));
  await other.write('/forms/a.json', formDoc('Theirs'));
  assert.equal((await storage.read('/forms/a.json')).document.metadata.title, 'Mine');
  assert.equal((await other.read('/forms/a.json')).document.metadata.title, 'Theirs');
  assert.deepEqual((await listAll(other)).map((f) => f.title), ['Theirs']);
});

test('roundtrips a form edited the way the editor saves it', async () => {
  const stored = formDoc('Contact', [{ name: 'email', fieldType: 'email', label: { value: 'Email' } }]);
  stored.metadata.owner = 'kept';
  await storage.write('/forms/contact.json', stored);

  const { document, definition } = parseFormDocument((await storage.read('/forms/contact.json')).document);
  definition.items[0].label.value = 'Work email';
  await storage.write('/forms/contact.json', buildFormDocument(document, definition));

  const saved = (await storage.read('/forms/contact.json')).document;
  assert.equal(saved.data.items[0].label.value, 'Work email');
  assert.deepEqual(saved.metadata, { schemaName: 'adaptive-form', title: 'Contact', owner: 'kept' });
});

test('is resolved by the registry when it is the available storage', async () => {
  const registry = new Registry()
    .register(FormStorage, { name: 'remote', isAvailable: () => false, create: () => ({}) })
    .register(FormStorage, {
      name: 'browser',
      isAvailable: () => isLocalStorageAvailable(area),
      create: () => createLocalStorage({ storage: area }),
    });
  const resolved = await registry.require(FormStorage);
  await resolved.write('/forms/a.json', formDoc('A'));
  assert.equal((await storage.read('/forms/a.json')).document.metadata.title, 'A');
});
