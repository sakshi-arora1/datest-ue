/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fromDataRef } from '../../../../tools/apps/formeditor/editor/property-form.js';

const root = new URL('../../../../', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const dir = new URL('ue/models/form/', root);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const FIELD_TYPES = ['text-input', 'multiline-input', 'number-input', 'date-input', 'checkbox', 'checkbox-group', 'drop-down', 'radio-group'];

test('reads the property path of a dataRef', () => {
  assert.equal(fromDataRef('$.label.value'), 'label.value');
  assert.equal(fromDataRef("$.properties['fd:submit'].actionName"), 'properties.fd:submit.actionName');
  assert.equal(fromDataRef("$[':type']"), ':type');
});

test('every form component stores a valid property form', () => {
  files.forEach((name) => {
    const json = readJson(new URL(name, dir));
    assert.ok(Array.isArray(json.propertyForms), `${name} has no propertyForms`);
    json.models.forEach((model) => {
      const form = json.propertyForms.find((p) => p.id === model.id)?.form;
      assert.ok(form, `${name}: no property form for ${model.id}`);
      assert.ok(form.items.length && form.items.every((panel) => panel.fieldType === 'panel'
        && panel.label?.value && Array.isArray(panel.items)), `${name}: tabs must be panels with a label`);
      const fields = form.items.flatMap((panel) => panel.items);
      const names = new Set();
      fields.forEach((field) => {
        assert.ok(FIELD_TYPES.includes(field.fieldType), `${name}: ${field.name} has fieldType ${field.fieldType}`);
        assert.ok(fromDataRef(field.dataRef), `${name}: ${field.name} has no dataRef`);
        assert.ok(!names.has(field.name), `${name}: duplicate field name ${field.name}`);
        names.add(field.name);
        if (field.pattern) new RegExp(field.pattern); // eslint-disable-line no-new
      });
    });
  });
});

test('component-property-forms.json holds the property forms of the components', () => {
  const merged = readJson(new URL('component-property-forms.json', root));
  const stored = files.flatMap((name) => readJson(new URL(name, dir)).propertyForms);
  assert.deepEqual(
    [...merged].sort((a, b) => a.id.localeCompare(b.id)),
    [...stored].sort((a, b) => a.id.localeCompare(b.id)),
    'component-property-forms.json is out of date: run npm run build:json',
  );
});
