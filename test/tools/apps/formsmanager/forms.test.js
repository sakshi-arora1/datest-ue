/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithLimit } from '../../../../tools/apps/formsmanager/forms.js';
import { describeForm } from '../../../../tools/apps/formeditor/editor/crispr.js';

const doc = (metadata, data = { items: [] }) => ({ metadata, data });

test('describes form and form fragment documents', () => {
  const form = describeForm(doc({ schemaName: 'adaptive-form', title: 'Contact' }, {
    title: 'ignored',
    items: [{ name: 'a' }, { name: 'p', fieldType: 'panel', items: [{ name: 'b' }, { name: 'c' }] }],
  }));
  assert.deepEqual(form, {
    schemaName: 'adaptive-form', kind: 'Form', title: 'Contact', fields: 3,
  });
  const fragment = describeForm(doc({ schemaName: 'adaptive-form-fragment' }, { title: '<b>Address</b>', items: [] }));
  assert.deepEqual([fragment.kind, fragment.title, fragment.fields], ['Fragment', 'Address', 0]);
});

test('ignores other documents', () => {
  [
    doc({ schemaName: 'product' }),
    doc({}),
    { total: 1, ':type': 'sheet', data: [{ a: 1 }] },
    { adaptiveform: '0.10.0', items: [] },
    { metadata: { schemaName: 'adaptive-form' }, data: [] },
    { metadata: { schemaName: 'toString' }, data: {} },
    null,
  ].forEach((json) => assert.equal(describeForm(json), null, JSON.stringify(json)));
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
