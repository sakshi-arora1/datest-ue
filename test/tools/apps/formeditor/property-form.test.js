/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  fromDataRef, loadFormRuntime, PropertySheet, DEFAULT_RUNTIME_URL,
} from '../../../../tools/apps/formeditor/editor/property-form.js';

const root = new URL('../../../../', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const dir = new URL('ue/models/form/', root);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const FIELD_TYPES = ['text-input', 'multiline-input', 'number-input', 'date-input', 'checkbox', 'checkbox-group', 'drop-down', 'radio-group'];

test('reads the property path of a dataRef', () => {
  assert.equal(fromDataRef('$.label.value'), 'label.value');
  assert.equal(fromDataRef('$.properties."fd:submit".actionName'), 'properties.fd:submit.actionName');
  assert.equal(fromDataRef('$.":type"'), ':type');
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
        assert.ok(!field.properties?.['fe:visibleWhen'], `${name}: ${field.name} uses fe:visibleWhen; use visible or rules.visible`);
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

const sheets = files.flatMap((name) => readJson(new URL(name, dir)).propertyForms
  .map(({ id, form }) => ({ name, id, form })));
const sheetOf = (id) => sheets.find((s) => s.id === id).form;
const field = (sheet, name) => sheet.tabs.flatMap((tab) => tab.fields).find((f) => f.name === name);

test('loads the runtime of the form block', async () => {
  assert.ok(DEFAULT_RUNTIME_URL.endsWith('/blocks/form/rules/model/afb-runtime.min.js'));
  const runtime = await loadFormRuntime();
  assert.equal(typeof runtime.createFormInstance, 'function');
});

test('every property form runs in the form runtime', async () => {
  const runtime = await loadFormRuntime();
  sheets.forEach(({ name, id, form }) => {
    const sheet = new PropertySheet(runtime, form, { name: 'item1', fieldType: id });
    assert.deepEqual(sheet.tabs.map((t) => t.label), form.items.map((p) => p.label.value), `${name}: ${id}`);
    assert.ok(sheet.tabs.every((t) => t.fields.every((f) => f.id && f.dataRef)), `${name}: ${id}`);
    const unbound = sheet.form.getState().items.flatMap((p) => p.items)
      .filter((f) => f.dataRef && !f.qualifiedName);
    assert.deepEqual(unbound, [], `${name}: ${id}`);
  });
});

test('a property sheet reads the item, applies rules and validates with the runtime', async () => {
  const runtime = await loadFormRuntime();
  const item = {
    name: 'p1', fieldType: 'panel', label: { value: 'Address' }, properties: { repeatable: false },
  };
  const before = structuredClone(item);
  let sheet = new PropertySheet(runtime, sheetOf('panel'), item);
  assert.equal(field(sheet, 'label_value').value, 'Address');
  const submit = new PropertySheet(runtime, sheetOf('form-settings'), { properties: { 'fd:submit': { actionName: 'spreadsheet' } } });
  assert.equal(submit.tabs.flatMap((t) => t.fields)
    .find((f) => f.dataRef === '$.properties."fd:submit".actionName').value, 'spreadsheet');
  assert.equal(field(sheet, 'fieldType').visible, false);
  assert.equal(field(sheet, 'minOccur').visible, false);

  sheet = new PropertySheet(runtime, sheetOf('panel'), { ...item, properties: { repeatable: true, variant: 'noButtons' } });
  assert.equal(field(sheet, 'minOccur').visible, true);
  assert.equal(field(sheet, 'maxOccur').visible, false);
  assert.equal(field(sheet, 'properties_repeatAddButtonLabel').visible, false);

  const name = field(sheet, 'name');
  assert.equal(sheet.validate(name, '$p'), 'Name cannot start with $');
  assert.ok(sheet.validate(name, ''), 'Name is required');
  assert.equal(sheet.validate(name, 'p2'), null);
  assert.deepEqual(item, before, 'the sheet never changes the item');
});
