/*
 * Handles Universal Editor requests for Adaptive Form fields that live in a form block's
 * inline JSON (<pre><code>) in a DA document.
 *
 * Resources:  urn:fj:/form-<n>                  -> the n-th form block of the page (container)
 *             urn:fj:/form-<n>/items/<i>/items/<j> -> a field (JSON pointer into the form JSON)
 * Connection: { name: 'fj', protocol: 'xwalk' } declared by the page; the DA document is
 *             derived from the DA connection ('ab', https://main--<site>--<org>.ue.da.live/<path>).
 *
 * Field properties use the AEM Forms model names (jcr:title, mandatoryMessage, ...) so the
 * existing form component models and templates can be reused unchanged.
 */
// eslint-disable-next-line import/extensions
import { fromJcr, setJcrProp, toJcr } from './mapping.mjs';

const DA_ADMIN = process.env.DA_ADMIN || 'https://admin.da.live';
const URN_PREFIX = 'urn:fj:';

export function isFormRequest(json) {
  const text = JSON.stringify(json.target || json.from || json.to || {});
  return text.includes(URN_PREFIX);
}

function findResources(json) {
  const resources = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    Object.entries(v).forEach(([k, val]) => {
      if (k === 'resource' && typeof val === 'string' && val.startsWith(URN_PREFIX)) resources.push(val);
      else walk(val);
    });
  };
  walk(json);
  return resources;
}

function parseResource(urn) {
  const path = urn.slice(URN_PREFIX.length);
  const m = path.match(/^\/form-(\d+)((?:\/items\/\d+)*)$/);
  if (!m) throw new Error(`unsupported resource ${urn}`);
  const pointer = m[2] ? m[2].split('/').filter(Boolean) : [];
  const indexes = [];
  for (let i = 0; i < pointer.length; i += 2) indexes.push(Number(pointer[i + 1]));
  return { formIndex: Number(m[1]), indexes };
}

function resourceFor(formIndex, indexes) {
  return `${URN_PREFIX}/form-${formIndex}${indexes.map((i) => `/items/${i}`).join('')}`;
}

function docFromConnection(connections) {
  // The DA ("ab") connection carries the page URL; the "fj" connection is static.
  const conn = (connections || []).find((c) => c.name === 'ab' || c.protocol === 'da')
    || (connections || []).find((c) => c.name === 'fj');
  if (!conn) throw new Error('missing DA connection');
  const url = new URL(conn.uri);
  const m = url.hostname.match(/^[^-]+--([^.]+?)--([^.]+?)\.(?:stage-)?ue\.da\.(?:live|page)$/);
  if (!m) throw new Error(`cannot derive DA document from ${conn.uri}`);
  const [, site, org] = m;
  let path = url.pathname.replace(/\.html$/, '');
  if (path.endsWith('/')) path += 'index';
  return { org, site, path };
}

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');

const encodeCode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function locateForm(html, formIndex) {
  const blockRe = /<div class="form(?:\s[^"]*)?">/g;
  let match;
  for (let i = 0; i <= formIndex; i += 1) {
    match = blockRe.exec(html);
    if (!match) throw new Error(`form block ${formIndex} not found in document`);
  }
  const codeStart = html.indexOf('<pre><code', match.index);
  const nextBlock = html.slice(match.index + 1).search(/<div class="form(?:\s[^"]*)?">/);
  if (codeStart < 0 || (nextBlock >= 0 && codeStart > match.index + 1 + nextBlock)) {
    throw new Error('form block does not contain a <pre><code> form definition');
  }
  const innerStart = html.indexOf('>', codeStart + '<pre><code'.length - 1) + 1;
  const innerEnd = html.indexOf('</code>', innerStart);
  const json = JSON.parse(decodeEntities(html.slice(innerStart, innerEnd)));
  return { json, innerStart, innerEnd };
}

async function readDoc(doc, auth) {
  const url = `${DA_ADMIN}/source/${doc.org}/${doc.site}${doc.path}.html`;
  const resp = await fetch(url, { headers: { authorization: auth } });
  if (!resp.ok) throw Object.assign(new Error(`DA read ${resp.status} ${url}`), { status: resp.status });
  return resp.text();
}

async function writeDoc(doc, auth, html) {
  const url = `${DA_ADMIN}/source/${doc.org}/${doc.site}${doc.path}.html`;
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  const resp = await fetch(url, { method: 'POST', headers: { authorization: auth }, body });
  if (!resp.ok) throw Object.assign(new Error(`DA write ${resp.status} ${url}`), { status: resp.status });
}

function containerOf(form, indexes) {
  let node = form;
  indexes.forEach((i) => {
    node = node.items?.[i];
    if (!node) throw new Error(`no item at ${indexes.join('/')}`);
  });
  return node;
}

function allNames(node, names = new Set()) {
  (node.items || []).forEach((it) => {
    if (it.name) names.add(it.name);
    if (it.id) names.add(it.id);
    allNames(it, names);
  });
  return names;
}

function uniqueName(form, base) {
  const used = allNames(form);
  const clean = (base || 'field').replace(/[^A-Za-z0-9_]/g, '_');
  let name = clean;
  for (let n = 1; used.has(name); n += 1) name = `${clean}_${n}`;
  return name;
}

function findTemplate(json) {
  let template;
  const walk = (v) => {
    if (!v || typeof v !== 'object' || template) return;
    if (v.template && typeof v.template === 'object') { template = v.template; return; }
    Object.values(v).forEach(walk);
  };
  walk(json.content || json);
  const componentId = json.content?.name || json.content?.id || json.content?.model;
  return { template: template || {}, componentId };
}

function newItem(form, json) {
  const { template, componentId } = findTemplate(json);
  const item = fromJcr(template);
  item.fieldType = item.fieldType || 'text-input';
  const name = uniqueName(form, template.name || componentId || item.fieldType);
  item.id = name;
  item.name = name;
  if (componentId === 'form-submit-button') item.events = { click: 'submitForm()' };
  if (componentId === 'form-reset-button') item.events = { click: 'dispatch($form, \'reset\')' };
  if (item.fieldType === 'panel' && !item.items) item.items = [];
  return item;
}

function blockContent(resource, form) {
  const code = encodeCode(JSON.stringify(form, null, 2));
  return `<div class="form" data-aue-resource="${resource}"><div><div><pre><code>${code}</code></pre></div></div></div>`;
}

function ok(formIndex, form, extra = {}) {
  const resource = resourceFor(formIndex, []);
  const updates = [{ resource, content: blockContent(resource, form) }];
  return { status: 200, body: { updates, ...extra } };
}

export async function handleFormRequest(url, json, headers) {
  const op = url.split('?')[0].replace(/^\/+/, '');
  const auth = headers['x-fj-authorization'] || headers.authorization;
  const doc = docFromConnection(json.connections);
  const [primary] = findResources(json.target || json);
  const { formIndex, indexes } = parseResource(primary);

  const html = await readDoc(doc, auth);
  const { json: form, innerStart, innerEnd } = locateForm(html, formIndex);
  const save = async () => {
    const code = encodeCode(JSON.stringify(form, null, 2));
    await writeDoc(doc, auth, html.slice(0, innerStart) + code + html.slice(innerEnd));
  };

  switch (op) {
    case 'details': {
      if (!indexes.length) {
        return { status: 200, body: { data: { title: form.title || '', action: form.action || '' } } };
      }
      return { status: 200, body: { data: toJcr(containerOf(form, indexes)) } };
    }
    case 'update': {
      const target = indexes.length ? containerOf(form, indexes) : form;
      setJcrProp(target, json.target.prop, json.value);
      await save();
      return ok(formIndex, form);
    }
    case 'patch': {
      const target = indexes.length ? containerOf(form, indexes) : form;
      const ops = json.patch || json.value || [];
      ops.forEach(({ op: action, path, value }) => {
        const prop = path.replace(/^\//, '').replace(/~1/g, '/').replace(/~0/g, '~');
        setJcrProp(target, prop, action === 'remove' ? undefined : value);
      });
      await save();
      return ok(formIndex, form);
    }
    case 'add': {
      const parent = containerOf(form, indexes);
      parent.items = parent.items || [];
      const item = newItem(form, json);
      const before = findResources(json.target?.before || json.before || {})[0];
      let at = parent.items.length;
      if (before) at = parseResource(before).indexes.at(-1);
      parent.items.splice(at, 0, item);
      await save();
      return ok(formIndex, form, { resource: resourceFor(formIndex, [...indexes, at]) });
    }
    case 'remove': {
      const parentIdx = indexes.slice(0, -1);
      const parent = containerOf(form, parentIdx);
      parent.items.splice(indexes.at(-1), 1);
      await save();
      return ok(formIndex, form);
    }
    case 'move': {
      const resources = findResources(json);
      const from = parseResource(json.from?.component?.resource
        || json.target?.resource || resources[0]);
      const toContainer = parseResource(json.to?.container?.resource
        || json.target?.container?.resource
        || resourceFor(from.formIndex, from.indexes.slice(0, -1)));
      const beforeUrn = findResources(json.to?.before || json.before || {})[0];
      const srcParent = containerOf(form, from.indexes.slice(0, -1));
      const [item] = srcParent.items.splice(from.indexes.at(-1), 1);
      const dstParent = containerOf(form, toContainer.indexes);
      dstParent.items = dstParent.items || [];
      let at = dstParent.items.length;
      if (beforeUrn) {
        const b = parseResource(beforeUrn).indexes;
        at = b.at(-1);
        const sameParent = b.slice(0, -1).join('/') === from.indexes.slice(0, -1).join('/');
        if (sameParent && from.indexes.at(-1) < at) at -= 1;
      }
      dstParent.items.splice(at, 0, item);
      await save();
      return ok(formIndex, form);
    }
    default:
      return { status: 400, body: { error: `operation ${op} not supported for form fields` } };
  }
}
