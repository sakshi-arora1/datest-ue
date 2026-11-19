/*
 * Forms authored as DA Structured Content documents (/forms/contact). Their JSON document
 * ({ metadata: { schemaName }, data: <form definition> }) is served by the Structured Content
 * delivery endpoint: https://da-sc.adobeaem.workers.dev/<preview|live>/<org>/<site>/<path>.
 *
 * A site-relative, extensionless form link resolves on the site's aem.page host to the preview
 * content and on its aem.live host to the live content; the org and site come from the host name
 * (<ref>--<site>--<org>.aem.page). Delivery endpoint URLs can be linked directly too.
 */

export const DELIVERY_ORIGIN = 'https://da-sc.adobeaem.workers.dev';

/** The delivery endpoint URL of a form link; null when it is not a Structured Content form link. */
export function deliveryUrl(href, location = window.location) {
  const url = new URL(href, location.href);
  if (url.origin === DELIVERY_ORIGIN) return url.href;
  if (url.origin !== location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return null;
  const env = /^[^.]+\.aem\.(page|live)$/.exec(location.hostname)?.[1];
  const [, site, org, ...extra] = location.hostname.split('.')[0].split('--');
  if (!env || !site || !org || extra.length) return null;
  return `${DELIVERY_ORIGIN}/${env === 'page' ? 'preview' : 'live'}/${org}/${site}${url.pathname.replace(/\/$/, '')}`;
}

const documents = new Map();

/**
 * The JSON document of a Structured Content form link, or null when the link is not one or
 * there is no such document. Each document is fetched once per page.
 */
export function fetchStructuredContent(href, location = window.location) {
  const url = deliveryUrl(href, location);
  if (!url) return Promise.resolve(null);
  if (!documents.has(url)) {
    documents.set(url, fetch(url)
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((json) => (json?.metadata && json?.data && typeof json.data === 'object' ? json : null))
      .catch(() => null));
  }
  return documents.get(url);
}
