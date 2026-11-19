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
 * Contracts between the standalone Form Editor and its host. A contract works like a Java
 * interface: it names the methods an implementation must have. Hosts register implementations
 * with a registry; the editor asks the registry for each contract and gets the first registered
 * implementation that is available. The editor itself depends on no host (DA or other).
 */

/** Defines a contract: its name, required methods and optional methods. */
export function defineContract(name, { methods = [], optional = [] } = {}) {
  return Object.freeze({ name, methods, optional });
}

/** Throws when `impl` does not implement every required method of `contract`. */
export function assertImplements(contract, impl, provider = 'implementation') {
  if (!impl || typeof impl !== 'object') {
    throw new TypeError(`${provider} of ${contract.name} is not an object.`);
  }
  const missing = contract.methods.filter((method) => typeof impl[method] !== 'function');
  if (missing.length) {
    throw new TypeError(`${provider} does not implement ${contract.name}: missing ${missing.join(', ')}.`);
  }
  return impl;
}

/**
 * Stores form documents. Paths are site-relative (`/forms/contact.json`); documents are plain
 * JSON objects in the Structured Content shape, { metadata: { schemaName }, data }.
 *
 *   describe(): { label }                     where the forms are, shown to authors
 *   read(path): { document, canWrite } | null  null when there is no document at `path`
 *   write(path, document): void                creates or replaces the document
 *   list({ onForm, onProgress, isCancelled }): void
 *     reports every form and form fragment document with onForm({ path, title, kind,
 *     schemaName, fields, lastModified }); onProgress({ scanned, total }) is optional
 */
export const FormStorage = defineContract('FormStorage', {
  methods: ['describe', 'read', 'write', 'list'],
});

/**
 * An AI assistant the author can ask to change the form (for example DA's Coworker).
 *
 *   ask(prompt): void                 sends a prompt
 *   onTurnCompleted(callback): unsubscribe
 *     callback({ status }) when the assistant finished a turn ('completed', 'aborted', 'error');
 *     the editor then reloads the form from storage
 *   open(): void                      optional; shows the assistant's conversation
 *   describe(): { name }              optional; the name shown to authors (default "Assistant")
 */
export const Assistant = defineContract('Assistant', {
  methods: ['ask', 'onTurnCompleted'],
  optional: ['open', 'describe'],
});

/**
 * Registered implementations of contracts. An implementation is registered with:
 *
 *   name         a label, for messages
 *   isAvailable  () => boolean | Promise<boolean>; defaults to available
 *   create       () => implementation | Promise<implementation>
 *   priority     higher is tried first (default 0); equal priorities keep their order
 */
export class Registry {
  #entries = new Map();

  register(contract, {
    name, isAvailable = () => true, create, priority = 0,
  }) {
    if (typeof create !== 'function') throw new TypeError(`${name} of ${contract.name} has no create().`);
    const entries = this.#entries.get(contract) || [];
    entries.push({
      name, isAvailable, create, priority, order: entries.length,
    });
    entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
    this.#entries.set(contract, entries);
    return this;
  }

  /** The first available implementation of `contract`, or null when none is available. */
  async resolve(contract) {
    const entries = this.#entries.get(contract) || [];
    const next = async (index) => {
      const entry = entries[index];
      if (!entry) return null;
      const available = await Promise.resolve().then(entry.isAvailable).catch(() => false);
      if (available) return assertImplements(contract, await entry.create(), entry.name);
      return next(index + 1);
    };
    return next(0);
  }

  /** Like resolve(), but throws when no implementation is available. */
  async require(contract) {
    const impl = await this.resolve(contract);
    if (!impl) throw new Error(`No ${contract.name} is available.`);
    return impl;
  }
}

/** The registry the editor uses unless it is given another one. */
export const registry = new Registry();
