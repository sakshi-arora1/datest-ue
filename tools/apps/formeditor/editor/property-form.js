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
 * Inspector-only hints that Crispr has no property for are kept under `properties` with an
 * `fe:` prefix: `fe:visibleWhen` (a JSONLogic condition on the item) and `fe:richText`.
 */

/** The property path a dataRef binds: `$.properties['fd:submit'].x` -> `properties.fd:submit.x` */
// eslint-disable-next-line import/prefer-default-export
export function fromDataRef(dataRef) {
  const keys = [...String(dataRef).replace(/^\$/, '').matchAll(/\.([A-Za-z0-9_$]+)|\['([^']+)'\]/g)]
    .map(([, simple, quoted]) => simple ?? quoted);
  return keys.join('.');
}
