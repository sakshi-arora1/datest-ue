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
 * Finds the form documents of a site: lists every HTML document through the DA source API and reads
 * them a few at a time, keeping the Structured Content documents of a form schema. Shared by the
 * Forms Manager, the Form Picker and the Form Editor's DA storage.
 */
import { listFiles, getSource } from '../formeditor/providers/da/api.js';
import {
  loadStructuredContentSdk, structuredContentSchema, fromStructuredContentHtml,
} from '../formeditor/providers/da/structured-content.js';
import { FORM_SCHEMAS, describeForm } from '../formeditor/editor/crispr.js';
import { mapWithLimit } from './forms.js';

const CONCURRENCY = 6;

/**
 * Reports the form and form fragment documents of a DA site with onForm({ path, title, kind,
 * schemaName, fields, lastModified }): its Structured Content documents (`.html`) whose `da-form`
 * block names one of `schemas`. Paths are reported without extension (`/forms/contact`).
 */
export default async function scanForms(org, site, {
  schemas = Object.keys(FORM_SCHEMAS), onForm, onProgress, isCancelled = () => false,
  loadSdk = loadStructuredContentSdk,
} = {}) {
  const [files, sdk] = await Promise.all([listFiles(org, site, 'html', '/'), loadSdk()]);
  if (isCancelled()) return;
  const progress = { scanned: 0, total: files.length, unreadable: 0 };
  onProgress?.({ ...progress });
  await mapWithLimit(files, CONCURRENCY, async (file) => {
    let form = null;
    try {
      const source = await getSource(org, site, file.path);
      if (source && schemas.includes(structuredContentSchema(source.text))) {
        form = describeForm(fromStructuredContentHtml(sdk, source.text));
      }
    } catch {
      progress.unreadable += 1;
    }
    if (isCancelled()) return;
    progress.scanned += 1;
    if (form) onForm?.({ ...file, path: file.path.replace(/\.html$/i, ''), ...form });
    onProgress?.({ ...progress });
  });
}
