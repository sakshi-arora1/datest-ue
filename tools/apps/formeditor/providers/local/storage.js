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
 * FormStorage (editor/contract.js) in the browser: form documents are kept in a Web Storage
 * area (localStorage by default), one entry per document under `<prefix><path>`. It needs no
 * server, so the standalone editor can run anywhere.
 */
import { describeForm } from '../../editor/crispr.js';

const PREFIX = 'formeditor:doc:';

export function isLocalStorageAvailable(storage = window.localStorage) {
  try {
    const key = `${PREFIX}__probe`;
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export default function createLocalStorage({
  storage = window.localStorage, prefix = PREFIX, label = 'this browser',
} = {}) {
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key) => key?.startsWith(prefix));

  return {
    describe() {
      return { label, kind: 'Local' };
    },

    async read(path) {
      const text = storage.getItem(`${prefix}${path}`);
      if (text === null) return null;
      return { document: JSON.parse(text).document, canWrite: true };
    },

    async write(path, document) {
      storage.setItem(`${prefix}${path}`, JSON.stringify({ document, lastModified: new Date().toISOString() }));
    },

    async list({
      schemas, onForm, onProgress, isCancelled = () => false,
    } = {}) {
      const all = keys();
      all.forEach((key, index) => {
        if (isCancelled()) return;
        let entry = null;
        try {
          entry = JSON.parse(storage.getItem(key));
        } catch {
          entry = null;
        }
        const form = describeForm(entry?.document);
        if (form && (!schemas || schemas.includes(form.schemaName))) {
          onForm?.({ path: key.slice(prefix.length), lastModified: entry.lastModified, ...form });
        }
        onProgress?.({ scanned: index + 1, total: all.length, unreadable: 0 });
      });
    },
  };
}
