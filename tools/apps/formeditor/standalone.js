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
 * The Form Editor without DA: forms are stored in this browser (localStorage) and there is no
 * assistant. Register another FormStorage (or an Assistant) before mounting to use a different
 * backend; the registry picks the first available implementation of each contract.
 */
import { registry, FormStorage } from './editor/contract.js';
import { mountFormEditor } from './editor/form-editor.js';
import { newFormDocument } from './editor/crispr.js';
import createLocalStorage, { isLocalStorageAvailable } from './providers/local/storage.js';

registry.register(FormStorage, {
  name: 'Browser storage',
  isAvailable: () => isLocalStorageAvailable(),
  create: () => createLocalStorage(),
});

// a first form to start from, the first time the editor is opened in this browser
const storage = await registry.resolve(FormStorage);
const SAMPLE = '/forms/sample.json';
if (storage && !(await storage.read(SAMPLE))) {
  const { data, metadata } = newFormDocument({ title: 'Sample form' });
  data.items.push(
    {
      name: 'name', fieldType: 'text-input', label: { value: 'Name' }, required: true,
    },
    { name: 'email', fieldType: 'email', label: { value: 'Email' } },
    {
      name: 'submit', fieldType: 'button', label: { value: 'Submit' }, events: { click: ['submitForm()'] },
    },
  );
  await storage.write(SAMPLE, { metadata, data });
}

mountFormEditor(document.body, { storage });
