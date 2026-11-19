/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formLink, toEmbedBlockHtml } from '../../../../tools/apps/formpicker/block.js';

test('links the form document with a site-relative .json path', () => {
  assert.equal(formLink('/forms/contact.json'), '/forms/contact.json');
  assert.equal(formLink('forms/hr/onboarding'), '/forms/hr/onboarding.json');
  assert.equal(formLink('/forms/a b&c.json'), '/forms/a%20b%26c.json');
});

test('builds an Embed Adaptive Form block table holding the link', () => {
  assert.equal(
    toEmbedBlockHtml('/forms/contact.json'),
    '<table><tbody><tr><td><p>embed-adaptive-form</p></td></tr><tr><td><p><a href="/forms/contact.json">/forms/contact.json</a></p></td></tr></tbody></table>',
  );
  assert.ok(!toEmbedBlockHtml('/forms/"x<y>.json').includes('"x<'));
});
