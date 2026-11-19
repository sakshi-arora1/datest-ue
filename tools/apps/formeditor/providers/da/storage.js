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
 * FormStorage (editor/contract.js) on DA: a form is a DA Structured Content document of the site,
 * `<path>.html` in DA's wire format, read, written and listed through the DA source API
 * (admin.da.live) and converted to and from its JSON document with the DA Structured Content
 * SDK (structured-content.js).
 */
import { getSource, saveSource } from './api.js';
import {
  loadStructuredContentSdk, fromStructuredContentHtml, toStructuredContentHtml,
} from './structured-content.js';
import { toDocPath } from '../../editor/crispr.js';
import scanForms from '../../../formsmanager/scan.js';

/** The source file of a document path: `/forms/contact` -> `/forms/contact.html`. */
export const sourcePath = (path) => `${toDocPath(path)}.html`;

export default function createDaStorage({ org, site, loadSdk = loadStructuredContentSdk }) {
  return {
    describe() {
      return { label: `${org}/${site}`, kind: 'DA' };
    },

    async read(path) {
      const [source, sdk] = await Promise.all([getSource(org, site, sourcePath(path)), loadSdk()]);
      if (!source) return null;
      return { document: fromStructuredContentHtml(sdk, source.text), canWrite: source.canWrite };
    },

    async write(path, document) {
      const sdk = await loadSdk();
      await saveSource(org, site, sourcePath(path), toStructuredContentHtml(sdk, document));
    },

    list(options) {
      return scanForms(org, site, { loadSdk, ...options });
    },
  };
}
