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
 * Preview view of the Form Editor: renders the current (also unsaved) definition with the
 * site's own form block, rules included, the way visitors get it. The editor loads this page
 * in a same-origin iframe and posts the definition once; a new definition reloads the page so
 * that the rule engine starts fresh. Submitting is blocked: requests other than GET are not sent,
 * and get an empty success response so the form's after-submit behaviour can be previewed.
 */
import '../../../scripts/aem.js';

const block = document.querySelector('.form.block');

function note(text, className = 'fe-preview-note') {
  return Object.assign(document.createElement('p'), { className, textContent: text });
}

async function render(definition) {
  const code = document.createElement('code');
  code.textContent = JSON.stringify(definition);
  const pre = document.createElement('pre');
  pre.append(code);
  block.replaceChildren(pre);
  try {
    const { default: decorate } = await import('../../../blocks/form/form.js');
    await decorate(block);
  } catch (error) {
    block.replaceChildren(note(`The form cannot be previewed: ${error.message}`, 'fe-preview-error'));
  }
}

function showBlocked() {
  if (!block.querySelector('.fe-preview-note')) {
    block.prepend(note('Submitting is disabled in the preview: nothing was sent.'));
  }
}

const { fetch: originalFetch } = window;
window.fetch = (input, init = {}) => {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return originalFetch(input, init);
  showBlocked();
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
};

const { send: originalSend, open: originalOpen } = XMLHttpRequest.prototype;
XMLHttpRequest.prototype.open = function open(method, ...rest) {
  this.feMethod = String(method).toUpperCase();
  return originalOpen.call(this, method, ...rest);
};
XMLHttpRequest.prototype.send = function send(...args) {
  if (this.feMethod === 'GET' || this.feMethod === 'HEAD') return originalSend.apply(this, args);
  showBlocked();
  this.abort();
  return undefined;
};

// a native submit (forms without rules) is stopped before the form's own handler
block.addEventListener('submit', (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  showBlocked();
}, true);

window.addEventListener('message', ({ data, origin, source }) => {
  if (origin !== window.location.origin || source !== window.parent) return;
  if (data?.type === 'render' && data.definition) render(data.definition);
});

window.parent.postMessage({ source: 'formeditor-preview', type: 'ready' }, window.location.origin);
