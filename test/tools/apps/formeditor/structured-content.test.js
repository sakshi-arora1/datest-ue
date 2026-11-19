/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@adobe/da-sc-sdk';
import {
  structuredContentSchema, fromStructuredContentHtml, toStructuredContentHtml,
} from '../../../../tools/apps/formeditor/providers/da/structured-content.js';

const form = {
  metadata: { schemaName: 'adaptive-form', title: 'Contact' },
  data: {
    adaptiveform: '0.10.0',
    title: 'Contact',
    properties: { 'fd:submit': { actionName: 'spreadsheet' }, ':type': 'fd/form' },
    items: [
      {
        name: 'name', fieldType: 'text-input', label: { value: 'Name' }, required: true,
      },
      {
        name: 'jobs',
        fieldType: 'panel',
        minOccur: 1,
        properties: { repeatable: true },
        items: [{ name: 'from', fieldType: 'date-input', rules: { visible: "a.$value == 'x'" } }],
      },
      {
        name: 'ok', fieldType: 'checkbox', enum: [true, false], type: 'boolean',
      },
    ],
  },
};

test('writes a form as a DA Structured Content document and reads it back', () => {
  const html = toStructuredContentHtml(sdk, form);
  assert.match(html, /<div class="da-form">/);
  assert.equal(structuredContentSchema(html), 'adaptive-form');
  assert.deepEqual(fromStructuredContentHtml(sdk, html), form);
});

test('recognizes Structured Content documents by the schema of their da-form block', () => {
  const fragment = toStructuredContentHtml(sdk, { metadata: { schemaName: 'adaptive-form-fragment' }, data: { items: [] } });
  assert.equal(structuredContentSchema(fragment), 'adaptive-form-fragment');
  const page = '<body><header></header><main><div><div class="hero"><div><div><h1>Hi</h1></div></div></div></div></main></body>';
  assert.equal(structuredContentSchema(page), null);
  assert.equal(structuredContentSchema(''), null);
  assert.throws(() => fromStructuredContentHtml(sdk, page), /not a Structured Content document/);
});

test('refuses documents without a schema', () => {
  assert.throws(() => toStructuredContentHtml(sdk, { data: {} }), /schemaName/);
});
