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
 * Property sheets of the Block Inspector are Crispr forms stored with their component, in
 * ue/models/form/<component>.json as "propertyForms" (merged into component-property-forms.json).
 * They are authored there directly. Each panel is a tab of the sheet, and each field is bound to
 * the property it edits with `dataRef`, for example `$.properties['fd:submit'].actionName`.
 *
 * A sheet runs in the Adaptive Forms runtime (blocks/form/rules/model/afb-runtime), with the
 * selected item as its data: the runtime resolves the values, the `visible` rules and the
 * validation (`required`, `pattern`, `constraintMessages`, ...). The editor draws the fields and
 * writes the accepted values into the item itself. `fe:richText` (under `properties`) keeps the
 * surrounding white space of a value.
 */

/** The runtime the site's form block uses, relative to this module. */
export const DEFAULT_RUNTIME_URL = new URL('../../../../blocks/form/rules/model/afb-runtime.min.js', import.meta.url).href;

/** Loads the Adaptive Forms runtime module (it exports createFormInstance). */
export async function loadFormRuntime(url = DEFAULT_RUNTIME_URL) {
  const runtime = await import(String(url));
  if (typeof runtime.createFormInstance !== 'function') {
    throw new Error(`${url} is not the Adaptive Forms runtime`);
  }
  return runtime;
}

/**
 * The property path a dataRef binds, in the runtime's syntax (names that are not identifiers are
 * double-quoted): `$.properties."fd:submit".x` -> `properties.fd:submit.x`
 */
export function fromDataRef(dataRef) {
  const keys = [...String(dataRef).replace(/^\$/, '').matchAll(/\.([A-Za-z0-9_$-]+)|\."((?:[^"\\]|\\.)*)"/g)]
    .map(([, simple, quoted]) => simple ?? JSON.parse(`"${quoted}"`));
  return keys.join('.');
}

/**
 * A property sheet running in the form runtime, with a copy of `item` as its data.
 * Build a new one when the item changes; the item itself is never modified.
 */
export class PropertySheet {
  constructor(runtime, sheet, item) {
    this.form = runtime.createFormInstance(
      { ...structuredClone(sheet), data: structuredClone(item ?? {}) },
      undefined,
      'error',
    );
  }

  /** The tabs of the sheet: its panels, with the runtime state of their bound fields. */
  get tabs() {
    return (this.form.getState().items || []).map((panel) => ({
      label: panel.label?.value || panel.name,
      fields: (panel.items || []).filter((field) => field.dataRef),
    }));
  }

  /**
   * Sets a field's value in the runtime and validates it. Returns the runtime's error message,
   * or null when the value is valid.
   */
  validate(field, value) {
    const model = this.form.getElement(field.id);
    if (!model) return null;
    model.value = value ?? null;
    if (model.valid !== false) return null;
    const label = field.label?.value || field.name;
    return model.getState().validationMessage || `${label} is not valid.`;
  }
}
