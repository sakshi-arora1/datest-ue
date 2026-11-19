/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFormDocument, mapWithLimit } from '../../../../tools/apps/formsmanager/forms.js';

const doc = (metadata, data = { items: [] }) => JSON.stringify({ metadata, data });

test('describes form and form fragment documents', () => {
  const form = describeFormDocument(doc({ schemaName: 'adaptive-form', title: 'Contact' }, {
    title: 'ignored',
    items: [{ name: 'a' }, { name: 'p', fieldType: 'panel', items: [{ name: 'b' }, { name: 'c' }] }],
  }));
  assert.deepEqual(form, {
    schemaName: 'adaptive-form', kind: 'Form', title: 'Contact', fields: 3,
  });
  const fragment = describeFormDocument(doc({ schemaName: 'adaptive-form-fragment' }, { title: '<b>Address</b>', items: [] }));
  assert.deepEqual([fragment.kind, fragment.title, fragment.fields], ['Fragment', 'Address', 0]);
});

test('ignores other JSON documents', () => {
  [
    doc({ schemaName: 'product' }),
    doc({}),
    JSON.stringify({ total: 1, ':type': 'sheet', data: [{ a: 1 }] }),
    JSON.stringify({ adaptiveform: '0.10.0', items: [] }),
    JSON.stringify({ metadata: { schemaName: 'adaptive-form' }, data: [] }),
    JSON.stringify({ metadata: { schemaName: 'toString' }, data: {} }),
    'not json',
  ].forEach((text) => assert.equal(describeFormDocument(text), null, text));
});

test('runs tasks with a concurrency limit and keeps the order', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithLimit([5, 1, 4, 2, 3], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => { setTimeout(resolve, n); });
    running -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithLimit([], 3, async () => 1), []);
});
