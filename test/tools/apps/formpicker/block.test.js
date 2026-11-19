/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formLink, toEmbedBlockHtml } from '../../../../tools/apps/formpicker/block.js';

test('links the form document with its site-relative path', () => {
  assert.equal(formLink('/forms/contact'), '/forms/contact');
  assert.equal(formLink('/forms/contact.html'), '/forms/contact');
  assert.equal(formLink('forms/hr/onboarding'), '/forms/hr/onboarding');
  assert.equal(formLink('/forms/a b&c'), '/forms/a%20b%26c');
});

test('builds an Embed Adaptive Form block table holding the link', () => {
  assert.equal(
    toEmbedBlockHtml('/forms/contact'),
    '<table><tbody><tr><td><p>embed-adaptive-form</p></td></tr><tr><td><p><a href="/forms/contact">/forms/contact</a></p></td></tr></tbody></table>',
  );
  assert.ok(!toEmbedBlockHtml('/forms/"x<y>').includes('"x<'));
});
