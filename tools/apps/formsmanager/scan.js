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
 * Finds the form documents of a site: lists every JSON file through the DA source API and reads
 * them a few at a time. Shared by the Forms Manager and the Form Picker.
 */
import { listJsonFiles, getDocument } from '../formeditor/providers/da/api.js';
import { describeFormDocument, mapWithLimit } from './forms.js';

const CONCURRENCY = 6;

/**
 * Calls `onForm` for every form document found (with path, lastModified, schemaName, kind,
 * title and fields) and `onProgress` after each file. `isCancelled` stops reporting results
 * of a scan that was replaced by a newer one.
 */
export default async function scanForms(org, site, {
  schemas, onForm, onProgress, isCancelled = () => false,
} = {}) {
  const files = await listJsonFiles(org, site, '/');
  if (isCancelled()) return;
  const progress = { scanned: 0, total: files.length, unreadable: 0 };
  onProgress?.({ ...progress });
  await mapWithLimit(files, CONCURRENCY, async (file) => {
    let form = null;
    try {
      const doc = await getDocument(org, site, file.path);
      form = doc ? describeFormDocument(doc.text) : null;
    } catch {
      progress.unreadable += 1;
    }
    if (isCancelled()) return;
    progress.scanned += 1;
    if (form && (!schemas || schemas.includes(form.schemaName))) onForm?.({ ...file, ...form });
    onProgress?.({ ...progress });
  });
}
