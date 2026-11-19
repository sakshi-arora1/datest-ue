/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toDataRef, fromDataRef, toPropertyField, modelToPropertyForm,
} from '../../../../tools/apps/formeditor/property-form.js';

const models = JSON.parse(readFileSync(new URL('../../../../component-models.json', import.meta.url), 'utf8'));
const model = (id) => models.find((m) => m.id === id);

test('binds properties with dataRef and reads the path back', () => {
  assert.equal(toDataRef('label.value'), '$.label.value');
  assert.equal(toDataRef('properties.fd:submit.actionName'), "$.properties['fd:submit'].actionName");
  ['label.value', 'properties.fd:submit.actionName', ':type', 'constraintMessages.required']
    .forEach((path) => assert.equal(fromDataRef(toDataRef(path)), path));
});

test('converts UE fields to Crispr fields', () => {
  assert.deepEqual(toPropertyField({
    component: 'boolean', name: 'visible', label: 'Show Component', valueType: 'boolean', value: true,
  }), {
    name: 'visible', dataRef: '$.visible', label: { value: 'Show Component' }, fieldType: 'checkbox', type: 'boolean', enum: [true, false], default: true,
  });
  const select = toPropertyField({
    component: 'select', name: 'properties.colspan', label: 'Column Span', options: [{ name: '1 column', value: '1' }],
  });
  assert.equal(select.fieldType, 'drop-down');
  assert.deepEqual([select.enum, select.enumNames], [['1'], ['1 column']]);
  const name = toPropertyField({
    component: 'text', name: 'name', required: true, validation: { regExp: '^[^$].*', customErrorMsg: 'No $' },
  });
  assert.deepEqual([name.fieldType, name.required, name.pattern, name.constraintMessages.pattern], ['text-input', true, '^[^$].*', 'No $']);
  assert.equal(toPropertyField({ component: 'text', name: 'enum', multi: true }).type, 'string[]');
  assert.equal(toPropertyField({ component: 'richtext', name: 'value' }).properties['fe:richText'], true);
  const condition = { '===': [{ var: 'properties.repeatable' }, true] };
  assert.deepEqual(toPropertyField({ component: 'number', name: 'minOccur', condition }).properties, { 'fe:visibleWhen': condition });
});

test('turns every tab of a UE model into a panel of the property form', () => {
  const ue = model('text-input');
  const form = modelToPropertyForm(ue);
  assert.equal(form.adaptiveform, '0.10.0');
  assert.deepEqual(form.items.map((p) => p.label.value), ue.fields.filter((f) => f.component === 'tab').map((f) => f.label));
  assert.ok(form.items.every((p) => p.fieldType === 'panel'));
  const fields = form.items.flatMap((p) => p.items);
  assert.equal(fields.length, ue.fields.filter((f) => f.component !== 'tab' && f.name).length);
  assert.ok(fields.every((f) => f.dataRef.startsWith('$')));
  assert.equal(new Set(fields.map((f) => f.name)).size, fields.length);

  const settings = modelToPropertyForm(model('form-settings'));
  assert.ok(settings.items.flatMap((p) => p.items).some((f) => fromDataRef(f.dataRef) === 'properties.fd:submit.actionName'));
});
