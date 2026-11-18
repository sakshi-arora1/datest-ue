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
/* eslint-disable import/no-unresolved */
import { html } from 'da-lit';

const PATHS = {
  chat: 'M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  undo: 'M7 5 3 9l4 4M3.5 9H12a4.5 4.5 0 0 1 0 9H9',
  redo: 'm13 5 4 4-4 4M16.5 9H8a4.5 4.5 0 0 0 0 9h3',
  edit: 'M13.5 3.5l3 3L7 16H4v-3z',
  coworker: 'M10 3h.01M10 17h.01M3 10h.01M17 10h.01M5 5h.01M15 15h.01M15 5h.01M5 15h.01M10 7h.01M10 13h.01M7 10h.01M13 10h.01',
  splitLeft: 'M3 4h14v12H3zM8 4v12',
  splitRight: 'M3 4h14v12H3zM12 4v12',
  up: 'm5 12 5-5 5 5',
  down: 'm5 8 5 5 5-5',
  copy: 'M7 7h9v10H7zM4 13V3h9',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11',
  drag: 'M8 5h.01M12 5h.01M8 10h.01M12 10h.01M8 15h.01M12 15h.01',
  lock: 'M6 9V6a4 4 0 0 1 8 0v3M5 9h10v8H5z',
  plus: 'M10 4v12M4 10h12',
  save: 'M4 4h10l2 2v10H4zM7 4v4h6V4M7 16v-5h6v5',
  close: 'm5 5 10 10M15 5 5 15',
  spark: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2',
};

// eslint-disable-next-line import/prefer-default-export
export const icon = (name, size = 18) => html`
  <svg class="icon" width=${size} height=${size} viewBox="0 0 20 20" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" stroke-width=${name === 'coworker' ? 2.6 : 1.6} stroke-linecap="round" stroke-linejoin="round">
    <path d=${PATHS[name]}></path>
  </svg>`;
