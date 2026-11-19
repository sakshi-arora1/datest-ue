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
 * FormStorage (editor/contract.js) on DA: form documents are JSON documents of a DA site, read,
 * written and listed through the DA source API (admin.da.live).
 */
import { getDocument, saveDocument } from './api.js';
import scanForms from '../../../formsmanager/scan.js';

export default function createDaStorage({ org, site }) {
  return {
    describe() {
      return { label: `${org}/${site}`, kind: 'DA' };
    },

    async read(path) {
      const doc = await getDocument(org, site, path);
      if (!doc) return null;
      let document;
      try {
        document = JSON.parse(doc.text);
      } catch (e) {
        throw new Error(`The document is not valid JSON: ${e.message}`);
      }
      return { document, canWrite: doc.canWrite };
    },

    async write(path, document) {
      await saveDocument(org, site, path, `${JSON.stringify(document, null, 2)}\n`);
    },

    list(options) {
      return scanForms(org, site, options);
    },
  };
}
