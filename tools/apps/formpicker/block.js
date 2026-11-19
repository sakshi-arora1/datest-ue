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
 * The Embed Adaptive Form block the Form Picker inserts into a DA document, as in
 * aem-boilerplate-forms (blocks/embed-adaptive-form): a block whose cell links the form. DA turns
 * a table whose first row names a block into that block. The link is site-relative, so the page
 * loads the form from the host that serves it (aem.page or aem.live); the block renders a form
 * document (.json) with the form block.
 */

export const BLOCK_NAME = 'embed-adaptive-form';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** `/forms/contact.json` with every path segment URL-encoded. */
export function formLink(path) {
  const clean = `/${String(path).replace(/^\/+/, '')}`;
  const json = /\.json$/i.test(clean) ? clean : `${clean}.json`;
  return json.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/** The HTML of an Embed Adaptive Form block that embeds the form document at `path`. */
export function toEmbedBlockHtml(path) {
  const href = escapeHtml(formLink(path));
  return `<table><tbody><tr><td><p>${BLOCK_NAME}</p></td></tr><tr><td><p><a href="${href}">${href}</a></p></td></tr></tbody></table>`;
}
