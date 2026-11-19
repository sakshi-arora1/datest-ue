/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readForm, writeForm, findFormBlocks, newFormDocument, appendFormSection, setPath, getItem,
  moveItem, insertItem, duplicateItem, createItem, resolveComponent, evaluateCondition,
} from '../../../../tools/apps/formeditor/crispr.js';

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

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const doc = (code) => `<body><header></header><main><div><h1>Hi &amp; welcome</h1></div><div><div class="form"><div><div><pre><code>${code}</code></pre></div></div></div><p>after</p></div></main><footer></footer></body>`;

test('reads a form block and writes it back changing only the code element', () => {
  const html = doc(escape(JSON.stringify(definition)));
  const { count, definition: parsed, encoding } = readForm(html);
  assert.equal(count, 1);
  assert.equal(encoding, 'json');
  assert.deepEqual(parsed, definition);

  parsed.items[0].label.value = 'Full name';
  const saved = writeForm(html, parsed, { encoding });
  const block = findFormBlocks(saved)[0];
  assert.equal(saved.slice(0, block.start), html.slice(0, findFormBlocks(html)[0].start));
  assert.ok(saved.endsWith('</code></pre></div></div></div><p>after</p></div></main><footer></footer></body>'));
  const reread = readForm(saved).definition;
  assert.equal(reread.items[0].label.value, 'Full name');
  assert.deepEqual(reread['fd:custom'], definition['fd:custom']);
  assert.equal(reread.items[0]['x-unknown'], 1);
  assert.equal(reread.title, 'Contact <us>');
});

test('keeps the double encoded (JSON string) storage format', () => {
  const html = doc(escape(JSON.stringify(JSON.stringify(definition))));
  const { definition: parsed, encoding } = readForm(html);
  assert.equal(encoding, 'string');
  const saved = writeForm(html, parsed, { encoding });
  assert.equal(saved, html);
});

test('handles documents with several or no form blocks', () => {
  const two = doc(escape('{"items":[]}')).replace('<p>after</p>', '<div class="form"><div><div><pre><code>{"title":"2nd"}</code></pre></div></div></div>');
  assert.equal(readForm(two, 1).definition.title, '2nd');
  const updated = writeForm(two, { title: 'second' }, { index: 1 });
  assert.equal(readForm(updated, 0).definition.items.length, 0);
  assert.equal(readForm(updated, 1).definition.title, 'second');

  const none = '<body><header></header><main><div><p>x</p></div></main><footer></footer></body>';
  assert.equal(readForm(none).count, 0);
  const added = appendFormSection(none);
  assert.equal(readForm(added).definition.adaptiveform, '0.10.0');
  assert.ok(added.startsWith('<body><header></header><main><div><p>x</p></div><div><div class="form">'));
  assert.deepEqual(readForm(newFormDocument()).definition.items, []);
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

test('evaluates UE field conditions', () => {
  assert.equal(evaluateCondition({ '===': [1, 0] }, {}), false);
  const cond = { and: [{ '===': [{ var: 'properties.repeatable' }, true] }, { '!==': [{ var: 'properties.variant' }, 'noButtons'] }] };
  assert.equal(evaluateCondition(cond, { properties: { repeatable: true } }), true);
  assert.equal(evaluateCondition(cond, { properties: { repeatable: true, variant: 'noButtons' } }), false);
});
