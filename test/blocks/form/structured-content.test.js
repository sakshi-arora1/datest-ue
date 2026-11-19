/* eslint-disable import/no-relative-packages */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryUrl, fetchStructuredContent } from '../../../blocks/form/structured-content.js';

const at = (href) => new URL(href);
const SC = 'https://da-sc.adobeaem.workers.dev';

test('resolves a form link to the preview or live delivery endpoint of the site', () => {
  const page = at('https://main--datest-ue--sakshi-arora1.aem.page/products/shoe');
  assert.equal(deliveryUrl('/forms/contact', page), `${SC}/preview/sakshi-arora1/datest-ue/forms/contact`);
  const live = at('https://main--datest-ue--sakshi-arora1.aem.live/');
  assert.equal(deliveryUrl('https://main--datest-ue--sakshi-arora1.aem.live/forms/hr/onboarding', live), `${SC}/live/sakshi-arora1/datest-ue/forms/hr/onboarding`);
  assert.equal(deliveryUrl(`${SC}/live/o/s/forms/a`, at('http://localhost:3000/')), `${SC}/live/o/s/forms/a`);
});

test('leaves other links alone', () => {
  const page = at('https://main--datest-ue--sakshi-arora1.aem.page/');
  assert.equal(deliveryUrl('/forms/contact.json', page), null);
  assert.equal(deliveryUrl('https://example.com/forms/contact', page), null);
  assert.equal(deliveryUrl('/forms/contact', at('http://localhost:3000/')), null);
  assert.equal(deliveryUrl('/forms/contact', at('https://www.example.com/')), null);
});

test('fetches a Structured Content form document once', async (t) => {
  const page = at('https://main--datest-ue--sakshi-arora1.aem.page/');
  const doc = { metadata: { schemaName: 'adaptive-form' }, data: { items: [] } };
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(url);
    if (url.endsWith('/missing')) return new Response('', { status: 404 });
    return new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(await fetchStructuredContent('/forms/contact', page), doc);
  assert.deepEqual(await fetchStructuredContent('/forms/contact', page), doc);
  assert.equal(await fetchStructuredContent('/forms/missing', page), null);
  assert.equal(await fetchStructuredContent('/forms/contact.json', page), null);
  assert.deepEqual(calls, [`${SC}/preview/sakshi-arora1/datest-ue/forms/contact`, `${SC}/preview/sakshi-arora1/datest-ue/forms/missing`]);
});
