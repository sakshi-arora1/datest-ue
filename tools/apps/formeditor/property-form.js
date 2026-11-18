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
 * Property sheets of the Block Inspector as Crispr forms.
 *
 * A block's properties are described by a Crispr (Adaptive Form) definition: every tab of the
 * Universal Editor model becomes a panel, and every property becomes a field bound to the
 * property's JSON path with `dataRef` (for example `$.properties['fd:submit'].actionName`).
 * The Block Inspector reads values through `dataRef` and writes them back to the same path.
 *
 * Inspector-only hints that Crispr has no property for are kept under `properties` with an
 * `fe:` prefix: `fe:visibleWhen` (the UE JSONLogic condition) and `fe:richText`.
 */

const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `label.value` -> `$.label.value`; `properties.fd:submit.x` -> `$.properties['fd:submit'].x` */
export function toDataRef(path) {
  return `$${path.split('.').map((key) => (SIMPLE_KEY.test(key) ? `.${key}` : `['${key}']`)).join('')}`;
}

/** The inverse of toDataRef: a dot separated property path. */
export function fromDataRef(dataRef) {
  const keys = [...String(dataRef).replace(/^\$/, '').matchAll(/\.([A-Za-z0-9_$]+)|\['([^']+)'\]/g)]
    .map(([, simple, quoted]) => simple ?? quoted);
  return keys.join('.');
}

const fieldName = (path) => path.replace(/[^A-Za-z0-9_]/g, '_');

const optionsOf = (field) => (field.options || [])
  .map((o) => (typeof o === 'object' ? o : { name: String(o), value: o }));

function withOptions(item, field) {
  const options = optionsOf(field);
  return { ...item, enum: options.map((o) => o.value), enumNames: options.map((o) => o.name) };
}

/** Converts one UE model field to a Crispr field. */
export function toPropertyField(field) {
  const item = {
    name: fieldName(field.name),
    dataRef: toDataRef(field.name),
    label: { value: field.label || field.name },
  };
  const properties = {};
  switch (field.component) {
    case 'boolean':
      Object.assign(item, { fieldType: 'checkbox', type: 'boolean', enum: [true, false] });
      break;
    case 'select':
      Object.assign(item, withOptions({ fieldType: 'drop-down', type: 'string' }, field));
      break;
    case 'radio-group':
      Object.assign(item, withOptions({ fieldType: 'radio-group', type: 'string' }, field));
      break;
    case 'multiselect':
      Object.assign(item, withOptions({ fieldType: 'checkbox-group', type: 'string[]' }, field));
      break;
    case 'number':
      Object.assign(item, { fieldType: 'number-input', type: field.valueType === 'number' ? 'number' : 'string' });
      break;
    case 'date-time':
      Object.assign(item, { fieldType: 'date-input', type: 'string', format: 'date' });
      break;
    case 'richtext':
      Object.assign(item, { fieldType: 'multiline-input', type: 'string' });
      properties['fe:richText'] = true;
      break;
    default:
      Object.assign(item, field.multi
        ? { fieldType: 'multiline-input', type: 'string[]' }
        : { fieldType: 'text-input', type: 'string' });
  }
  if (field.required) item.required = true;
  if (field.value !== undefined) item.default = field.value;
  if (field.placeholder) item.placeholder = field.placeholder;
  if (field.description) item.description = field.description;
  if (field.validation?.regExp) {
    item.pattern = field.validation.regExp;
    if (field.validation.customErrorMsg) {
      item.constraintMessages = { pattern: field.validation.customErrorMsg };
    }
  }
  if (field.condition !== undefined) properties['fe:visibleWhen'] = field.condition;
  if (Object.keys(properties).length) item.properties = properties;
  return item;
}

/** Converts a UE component model to the Crispr form of its property sheet. */
export function modelToPropertyForm(model) {
  const panels = [];
  (model?.fields || []).forEach((field) => {
    if (field.component === 'tab') {
      panels.push({
        name: fieldName(field.name || field.label || `tab${panels.length + 1}`),
        fieldType: 'panel',
        label: { value: field.label || field.name },
        items: [],
      });
      return;
    }
    if (!field.name) return;
    if (!panels.length) {
      panels.push({
        name: 'basic', fieldType: 'panel', label: { value: 'Basic' }, items: [],
      });
    }
    panels[panels.length - 1].items.push(toPropertyField(field));
  });
  return {
    adaptiveform: '0.10.0',
    metadata: { grammar: 'json-formula-1.0.0', version: '1.0.0' },
    title: `${model?.id || 'Block'} properties`,
    properties: { 'fe:model': model?.id },
    items: panels,
  };
}
