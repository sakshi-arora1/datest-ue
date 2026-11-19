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
 * DA Structured Content documents. A form is stored in DA as a Structured Content document: an
 * HTML document (`/forms/contact.html`) in DA's wire format, whose `da-form` block names the
 * schema (`x-schema-name`). The DA Structured Content SDK (@adobe/da-sc-sdk) converts it to and
 * from the JSON document { metadata: { schemaName, title }, data }, which the editor edits.
 *
 * The SDK is passed in: DA's hosted copy in the browser (loadStructuredContentSdk), the npm
 * package in the unit tests.
 */

export const SDK_URL = 'https://da.live/nx/deps/da-sc-sdk/dist/index.js';

let sdkPromise;

/** Loads the DA Structured Content SDK that DA hosts (convertHtmlToJson, convertJsonToHtml). */
export function loadStructuredContentSdk(url = SDK_URL) {
  sdkPromise ??= import(url);
  return sdkPromise;
}

// the da-form block runs up to the next block, or to the end of the document when the data is empty
const DA_FORM = /<div class="da-form">([\s\S]*?)(?:<div class="|<\/main>|$)/;
const SCHEMA_ROW = /<h3>\s*x-schema-name\s*<\/h3>\s*<\/div>\s*<div>\s*<p>([^<]*)<\/p>/;

/**
 * The schema name of a Structured Content document, read from its `da-form` block, or null when
 * the HTML is not a Structured Content document (an ordinary page, for example).
 */
export function structuredContentSchema(html) {
  const block = DA_FORM.exec(String(html ?? ''))?.[1] ?? '';
  return SCHEMA_ROW.exec(block)?.[1].trim() || null;
}

/**
 * The JSON document of a Structured Content document. Throws when the HTML is not a Structured
 * Content document or cannot be converted.
 */
export function fromStructuredContentHtml(sdk, html) {
  if (!structuredContentSchema(html)) {
    throw new Error('The document is not a Structured Content document (it has no da-form block with a schema).');
  }
  const { json, error } = sdk.convertHtmlToJson({ html });
  if (error || !json) throw new Error(`The Structured Content document cannot be read: ${error}`);
  return json;
}

/** The DA wire-format HTML of a JSON document { metadata: { schemaName }, data }. */
export function toStructuredContentHtml(sdk, document) {
  if (!document?.metadata?.schemaName) throw new Error('The document has no metadata.schemaName.');
  const { html, error } = sdk.convertJsonToHtml({ json: document });
  if (error || typeof html !== 'string') throw new Error(`The document cannot be converted to Structured Content: ${error}`);
  return html;
}
