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
/* eslint-disable import/no-unresolved, no-console */

/*
 * The Form Editor as a DA app: the standalone editor (editor/) with the DA implementations of
 * its contracts (providers/da/). Forms are stored in the DA site the app is opened from, and the
 * assistant is the DA shell's Coworker chat when it is enabled for the site.
 */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { registry, FormStorage, Assistant } from './editor/contract.js';
import { mountFormEditor } from './editor/form-editor.js';
import createDaStorage from './providers/da/storage.js';
import createDaAssistant, { isDaAssistantAvailable } from './providers/da/assistant.js';

const NX = 'https://da.live/nx2';

function readSite(context) {
  const params = new URLSearchParams(window.location.search);
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appIndex = parts.indexOf('app');
  return {
    org: (context?.org || params.get('org') || (appIndex >= 0 ? parts[appIndex + 1] : '') || '').trim(),
    site: (context?.repo || params.get('site') || (appIndex >= 0 ? parts[appIndex + 2] : '') || '').trim(),
  };
}

// DA's design tokens (Spectrum 2 variables) and color scheme, which the editor's styles use
async function loadDaStyles() {
  try {
    const { loadStyle, getColorScheme } = await import(`${NX}/scripts/nx.js`);
    document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
    await loadStyle(`${NX}/styles/styles.css`);
  } catch (e) {
    console.warn('Failed to load DA styles:', e);
  }
}

const [sdk] = await Promise.all([DA_SDK, loadDaStyles()]);
const { org, site } = readSite(sdk.context);

registry.register(FormStorage, {
  name: 'DA source',
  isAvailable: () => Boolean(org && site),
  create: () => createDaStorage({ org, site }),
});
registry.register(Assistant, {
  name: 'DA Coworker',
  isAvailable: () => isDaAssistantAvailable(sdk),
  create: () => createDaAssistant(sdk),
});

if (document.readyState === 'loading') {
  await new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });
}
if (!org || !site) {
  document.body.textContent = 'Open the Form Editor from a site: /app/{org}/{site}/tools/apps/formeditor/formeditor';
} else {
  mountFormEditor(document.body);
}
