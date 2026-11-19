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
 * Pure helpers of the Forms Manager: which JSON documents are forms. A form document is a
 * Structured Content document ({ metadata, data }) whose metadata.schemaName is one of
 * FORM_SCHEMAS. No DOM or network access: the module is shared with the Node unit tests.
 */
import { FORM_SCHEMAS, describeForm } from '../formeditor/editor/crispr.js';

export { FORM_SCHEMAS };

/**
 * Describes a JSON document if it is a form or form fragment document, otherwise returns null
 * (spreadsheets, bare JSON and documents of other schemas).
 */
export function describeFormDocument(text) {
  try {
    return describeForm(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Runs `task` over `items` with at most `limit` running at a time, in order of `items`. */
export async function mapWithLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
