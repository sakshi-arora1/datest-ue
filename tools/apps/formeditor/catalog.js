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
 * The component catalog of the editor is the site's Universal Editor configuration, so the
 * palette and the properties panel always match what authors get in UE:
 * - component-definition.json: palette entries (form-components group) and containers (filter)
 * - component-filters.json:    order of the palette (form-fields filter)
 * - component-models.json:     properties of each component, named by JSON path
 * - component-json-mappings.json: how a form item resolves to a component, new item defaults
 *
 * The property sheet of each component is a Crispr form generated from its model
 * (property-form.js), which the Block Inspector draws.
 */
import { resolveComponent } from './crispr.js';
import { modelToPropertyForm } from './property-form.js';

const FORM_GROUP = 'form-components';
const FORM_BLOCK = 'form';

async function fetchJson(name) {
  const resp = await fetch(new URL(`/${name}`, window.location.origin));
  if (!resp.ok) throw new Error(`Unable to load ${name} (HTTP ${resp.status}).`);
  return resp.json();
}

export default async function loadCatalog() {
  const [definition, models, filters, mappings] = await Promise.all([
    fetchJson('component-definition.json'),
    fetchJson('component-models.json'),
    fetchJson('component-filters.json'),
    fetchJson('component-json-mappings.json'),
  ]);
  const mapping = mappings.find((m) => m.block === FORM_BLOCK) || {};
  const group = definition.groups.find((g) => g.id === FORM_GROUP)?.components || [];
  const byId = new Map(group.map((c) => [c.id, c]));
  const filterIds = filters.find((f) => f.id === mapping.filter)?.components || [...byId.keys()];
  const components = filterIds.filter((id) => byId.has(id)).map((id) => ({
    id,
    title: byId.get(id).title,
    model: byId.get(id).model || id,
    container: Boolean(byId.get(id).filter),
  }));
  const componentIds = new Set(byId.keys());
  const rootModel = models.find((m) => m.id === mapping.root);
  const propertyForms = new Map();
  const propertyForm = (model) => {
    if (!model) return null;
    if (!propertyForms.has(model.id)) propertyForms.set(model.id, modelToPropertyForm(model));
    return propertyForms.get(model.id);
  };
  return {
    components,
    models,
    mapping,
    rootModel,
    rootPropertyForm: () => propertyForm(rootModel),
    resolve(item) {
      const id = resolveComponent(item, mapping, componentIds);
      return id ? components.find((c) => c.id === id) || null : null;
    },
    model(component) {
      return component ? models.find((m) => m.id === component.model) : null;
    },
    /** The Crispr form of a component's property sheet. */
    propertyForm(component) {
      return propertyForm(this.model(component));
    },
  };
}
