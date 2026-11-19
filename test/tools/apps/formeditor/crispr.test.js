/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readFormDocument, writeFormDocument, newFormDocument, newFormPath, toDocPath, SCHEMA_NAME,
  setPath, getItem,
  moveItem, insertItem, duplicateItem, createItem, resolveComponent,
} from '../../../../tools/apps/formeditor/editor/crispr.js';

const root = new URL('../../../../', import.meta.url);
const json = (name) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));

const definition = {
  adaptiveform: '0.10.0',
  title: 'Contact <us>',
  'fd:custom': { keep: [1, true, null] },
  items: [
    {
      name: 'name', fieldType: 'text-input', label: { value: 'Name & surname' }, 'x-unknown': 1,
    },
    {
      name: 'panel1',
      fieldType: 'panel',
      items: [{ name: 'a', fieldType: 'email' }, { name: 'b', fieldType: 'checkbox' }],
    },
    { name: 'submit', fieldType: 'button', events: { click: ['submitForm()'] } },
  ],
};

test('reads and writes Structured Content form documents without changing other data', () => {
  const stored = {
    metadata: { schemaName: SCHEMA_NAME, title: 'Contact', owner: 'x' },
    'x-extra': [1, null],
    data: definition,
  };
  const { document, definition: parsed } = readFormDocument(JSON.stringify(stored));
  assert.deepEqual(parsed, definition);
  assert.deepEqual(document, { metadata: stored.metadata, 'x-extra': [1, null] });

  parsed.items[0].label.value = 'Full name';
  const reread = JSON.parse(writeFormDocument(document, parsed));
  assert.deepEqual(reread.metadata, stored.metadata);
  assert.deepEqual(reread['x-extra'], [1, null]);
  assert.equal(reread.data.items[0].label.value, 'Full name');
  assert.deepEqual(reread.data['fd:custom'], definition['fd:custom']);
  assert.equal(reread.data.items[0]['x-unknown'], 1);
  assert.equal(reread.data.title, 'Contact <us>');
});

test('accepts bare Crispr JSON and rejects other JSON', () => {
  const { document, definition: parsed } = readFormDocument(JSON.stringify(definition));
  assert.deepEqual(parsed, definition);
  assert.equal(JSON.parse(writeFormDocument(document, parsed)).metadata.schemaName, SCHEMA_NAME);
  assert.throws(() => readFormDocument('{"total":1,":type":"sheet","data":[]}'), /spreadsheet/);
  assert.throws(() => readFormDocument('{"hello":1}'), /not a form document/);
  assert.throws(() => readFormDocument('<html>'), /not valid JSON/);
});

test('creates new form documents', () => {
  const doc = newFormDocument({ title: 'Newsletter' });
  assert.deepEqual(doc.metadata, { schemaName: SCHEMA_NAME, title: 'Newsletter' });
  assert.deepEqual(doc.data.items, []);
  assert.equal(doc.data.title, 'Newsletter');
});

test('places new forms by name or by path', () => {
  assert.deepEqual(newFormPath('Newsletter Signup'), { path: '/forms/newsletter-signup', title: 'Newsletter Signup' });
  assert.deepEqual(newFormPath('/HR/Onboarding Form'), { path: '/hr/onboarding-form', title: 'Onboarding Form' });
  assert.deepEqual(newFormPath('hr/onboarding.json'), { path: '/hr/onboarding', title: 'onboarding' });
  assert.deepEqual(newFormPath('hr/onboarding.html'), { path: '/hr/onboarding', title: 'onboarding' });
  assert.deepEqual(newFormPath('contact', '/'), { path: '/contact', title: 'contact' });
  assert.deepEqual(newFormPath('  '), {});
  assert.equal(toDocPath('forms/contact/'), '/forms/contact');
  assert.equal(toDocPath('/forms/contact.html'), '/forms/contact');
  assert.equal(toDocPath('/forms/contact.json'), '/forms/contact');
  assert.deepEqual(newFormPath('/hr/***'), {});
});

test('setPath creates and prunes nested properties', () => {
  const item = { label: { value: 'x', visible: true } };
  setPath(item, 'properties.fd:submit.actionName', 'email');
  assert.equal(item.properties['fd:submit'].actionName, 'email');
  setPath(item, 'properties.fd:submit.actionName', '');
  assert.equal(item.properties, undefined);
  setPath(item, 'label.value', undefined);
  assert.deepEqual(item.label, { visible: true });
  setPath(item, 'missing.deep', undefined);
  assert.equal(item.missing, undefined);
});

test('moves items within and across containers', () => {
  const form = structuredClone(definition);
  assert.deepEqual(moveItem(form, [0], [], 3), [2]);
  assert.deepEqual(form.items.map((i) => i.name), ['panel1', 'submit', 'name']);

  const form2 = structuredClone(definition);
  // into the panel that follows it: the panel's path shifts when the item is removed
  assert.deepEqual(moveItem(form2, [0], [1], 1), [0, 1]);
  assert.deepEqual(form2.items[0].items.map((i) => i.name), ['a', 'name', 'b']);

  const form3 = structuredClone(definition);
  assert.deepEqual(moveItem(form3, [1, 1], [], 0), [0]);
  assert.equal(form3.items[0].name, 'b');
  assert.throws(() => moveItem(form3, [2], [2], 0));
});

test('creates new items from the UE models and mapping defaults', () => {
  const models = json('component-models.json');
  const mapping = json('component-json-mappings.json').find((m) => m.block === 'form');
  const form = structuredClone(definition);
  const text = createItem(form, 'text-input', { models, mapping });
  assert.equal(text.fieldType, 'text-input');
  assert.equal(text.label.value, 'Text Input');
  assert.equal(text.name, 'text_input1');
  insertItem(form, [], 0, text);
  assert.equal(createItem(form, 'text-input', { models, mapping }).name, 'text_input2');

  const accordion = createItem(form, 'form-accordion', { models, mapping });
  assert.equal(accordion[':type'], 'accordion');
  assert.equal(accordion.items.length, 2);
  assert.ok(accordion.items.every((i) => i.name));

  const ids = new Set(json('component-definition.json').groups.find((g) => g.id === 'form-components').components.map((c) => c.id));
  assert.equal(resolveComponent(accordion, mapping, ids), 'form-accordion');
  assert.equal(resolveComponent(getItem(form, [3]), mapping, ids), 'form-submit-button');
  assert.equal(resolveComponent({ fieldType: 'text' }, mapping, ids), 'text-input');
  assert.equal(resolveComponent({ fieldType: 'nope' }, mapping, ids), null);
});

test('duplicates items with fresh names and without ids', () => {
  const form = structuredClone(definition);
  form.items[1].id = 'panel-id';
  const copy = duplicateItem(form, form.items[1]);
  assert.equal(copy.id, undefined);
  assert.equal(copy.name, 'panel2');
  assert.deepEqual(copy.items.map((i) => i.name), ['a1', 'b1']);
  assert.equal(form.items[1].name, 'panel1');
});
