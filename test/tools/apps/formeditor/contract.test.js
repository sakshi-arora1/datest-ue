/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Registry, FormStorage, Assistant, assertImplements, defineContract,
} from '../../../../tools/apps/formeditor/editor/contract.js';

const storageImpl = (label) => ({
  describe: () => ({ label }), read: async () => null, write: async () => {}, list: async () => {},
});

test('checks that an implementation has the methods of its contract', () => {
  assert.equal(assertImplements(FormStorage, storageImpl('a')).describe().label, 'a');
  assert.throws(() => assertImplements(FormStorage, { read() {} }), /missing describe, write, list/);
  assert.throws(() => assertImplements(Assistant, null), /not an object/);
  const contract = defineContract('X', { methods: ['a'], optional: ['b'] });
  assert.ok(assertImplements(contract, { a() {} }));
});

test('resolves the first available implementation, by priority then order', async () => {
  const registry = new Registry()
    .register(FormStorage, { name: 'off', isAvailable: () => false, create: () => storageImpl('off') })
    .register(FormStorage, { name: 'broken', isAvailable: () => { throw new Error('x'); }, create: () => storageImpl('broken') })
    .register(FormStorage, { name: 'first', create: () => storageImpl('first') })
    .register(FormStorage, { name: 'second', isAvailable: async () => true, create: async () => storageImpl('second') });
  assert.equal((await registry.resolve(FormStorage)).describe().label, 'first');
  registry.register(FormStorage, { name: 'preferred', priority: 10, create: () => storageImpl('preferred') });
  assert.equal((await registry.resolve(FormStorage)).describe().label, 'preferred');
  assert.equal(await registry.resolve(Assistant), null);
  await assert.rejects(registry.require(Assistant), /No Assistant is available/);
  registry.register(Assistant, { name: 'bad', create: () => ({ ask() {} }) });
  await assert.rejects(registry.resolve(Assistant), /missing onTurnCompleted/);
});
