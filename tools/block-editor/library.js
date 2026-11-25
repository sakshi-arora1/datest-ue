import { config as libraryConfig } from './config.js';
import { normalizeBlockName, normalizeVariant, isMultiBlockConfigured } from './fields.js';

const libraries = new Map();
const descriptions = new WeakMap();
let dependencies;

export function configureLibrary(actions) {
  dependencies = actions;
}

const firstSheet = (json) => {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  const name = json?.[':names']?.[0];
  const sheet = name ? json[name] : Object.values(json || {})
    .find((value) => Array.isArray(value?.data));
  if (Array.isArray(sheet?.data)) return sheet.data;
  throw new Error('The block library index does not contain a data sheet.');
};

export function getBlockTableHtml(block) {
  const [name, ...variants] = block.className.split(' ');
  const rows = [...block.children];
  const maxCols = Math.max(1, ...rows.map((row) => row.children.length));
  const table = document.createElement('table');
  table.setAttribute('border', '1');
  const header = table.insertRow().insertCell();
  header.colSpan = maxCols;
  header.textContent = variants.length ? `${name} (${variants.join(', ')})` : name;
  rows.forEach((row) => {
    const tr = table.insertRow();
    [...row.children].forEach((column, index) => {
      const cell = tr.insertCell();
      if (row.children.length < maxCols && index === row.children.length - 1) cell.colSpan = maxCols - index;
      cell.innerHTML = column.innerHTML;
    });
  });
  return table;
}

export function parseVariants(source, path) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('img').forEach((image) => {
    if (image.getAttribute('src')?.startsWith('./')) {
      try { image.src = new URL(image.getAttribute('src').slice(2), `${new URL(path).origin}/`).href; } catch { /* relative source */ }
    }
  });
  const elements = [...doc.querySelectorAll('body > div, main > div')].flatMap((section) => [...section.children]);
  const blocks = [];
  let group;
  elements.forEach((element) => {
    if (element.classList.contains('library-container-start')) {
      group = document.createElement('div');
      group.dataset.isgroup = 'true';
      if (/^H[1-6]$/.test(element.previousElementSibling?.tagName || '')) group.dataset.groupheading = element.previousElementSibling.textContent;
    } else if (element.classList.contains('library-container-end') && group) {
      if (element.nextElementSibling?.classList.contains('library-metadata')) group.append(element.nextElementSibling.cloneNode(true));
      blocks.push(group);
      group = null;
    } else if (group) group.append(element.cloneNode(true));
    else if (element.tagName === 'DIV' && !element.classList.contains('library-metadata')) blocks.push(element);
  });
  return blocks.map((block) => {
    const previous = block.previousElementSibling?.classList.contains('library-metadata')
      ? block.previousElementSibling.previousElementSibling : block.previousElementSibling;
    const [name, ...variants] = block.className.split(' ');
    const item = { name: block.dataset.groupheading || (/^H[1-6]$/.test(previous?.tagName || '') ? previous.textContent : name), variants: variants.join(', ') || undefined };
    const metadata = (block.nextElementSibling?.classList.contains('library-metadata') && block.nextElementSibling)
      || (block.previousElementSibling?.classList.contains('library-metadata') && block.previousElementSibling)
      || block.querySelector('.library-metadata');
    [...(metadata?.children || [])].forEach((row) => {
      const key = row.children[0]?.textContent.trim().toLowerCase();
      const value = row.children[1];
      if (key === 'fields') item.fields = value?.querySelector('table')?.cloneNode(true) ?? value?.textContent.trim();
      else if (key && value?.textContent.trim()) item[key] = value.textContent.trim();
    });
    metadata?.remove();
    if (block.dataset.isgroup) {
      item.dom = document.createElement('div');
      [...block.children].forEach((child) => item.dom.append(child.tagName === 'DIV' ? getBlockTableHtml(child) : child.cloneNode(true)));
    } else item.dom = getBlockTableHtml(block);
    return item;
  });
}

function fetchLibraryResource(url) {
  // DA content needs authentication; public AEM hosts do not allow Authorization in CORS.
  return new URL(url, window.location.href).origin === 'https://content.da.live'
    ? dependencies.daFetch(url, { noRedirect: true })
    : fetch(url);
}

async function fetchJson(url) {
  const response = await fetchLibraryResource(url);
  if (!response.ok) throw new Error(`Unable to fetch ${url}: ${response.status}`);
  return response.json();
}

async function getBlockVariants(path) {
  const hosted = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'].some((suffix) => {
    try { return new URL(path).hostname.endsWith(suffix); } catch { return false; }
  });
  const response = await fetchLibraryResource(`${path}${hosted ? '.plain.html' : ''}`);
  if (!response.ok) throw new Error(`Unable to load block template ${path}: ${response.status}`);
  return parseVariants(await response.text(), path);
}

async function load(org, site) {
  let sources;
  if (libraryConfig.library) sources = [libraryConfig.library];
  else {
    const { configs: fetched } = await dependencies.getEditorConfig();
    const configs = (fetched || []).filter((config) => config && !config.error).reverse();
    if (!configs.length) throw new Error(`Unable to load library configuration for ${org}/${site}.`);
    const rows = configs.flatMap((config) => config?.library?.data || []);
    const row = rows.find((entry) => entry.title?.trim().toLowerCase() === 'blocks'
      && (!entry.ref || entry.ref === 'main' || libraryConfig.ref === 'local' || entry.ref === libraryConfig.ref));
    if (!row) return { ext: null, blocks: [], options: [], editor: [] };
    sources = (row.path || '').split(',').map((path) => {
      const value = path.trim();
      if (!value.startsWith('/')) return value;
      return libraryConfig.ref === 'local' ? `${libraryConfig.live}${value}` : `https://${libraryConfig.ref}--${site}--${org}.aem.live${value}`;
    }).filter(Boolean);
  }
  const indexes = await Promise.all(sources.map(fetchJson));
  const blocks = indexes.flatMap(firstSheet).filter((entry) => entry.name && entry.path)
    .map((entry) => ({ ...entry, loadVariants: getBlockVariants(entry.path) }));
  // All variants are shared by fields, variant picker, and row templates.
  const results = await Promise.allSettled(blocks.map((block) => block.loadVariants));
  const warnings = results.flatMap((result, index) => (result.status === 'rejected' ? [{
    name: blocks[index].name,
    path: blocks[index].path,
    message: result.reason instanceof Error ? result.reason.message : String(result.reason),
  }] : []));
  const availableBlocks = blocks.filter((block, index) => results[index].status === 'fulfilled');
  // eslint-disable-next-line no-console -- Recoverable template failures are console-only.
  if (warnings.length) console.warn('Some block templates could not be loaded:', warnings);
  if (blocks.length && !availableBlocks.length) {
    throw new Error(`No block templates could be loaded. ${warnings.map((warning) => warning.message).join('; ')}`);
  }
  return {
    ext: { sources },
    blocks: availableBlocks,
    warnings,
    options: indexes.flatMap((index) => index.options?.data || []),
    editor: indexes.flatMap((index) => index.editor?.data || []),
  };
}

export function loadBlockLibrary(org, site) {
  if (!org || !site) return Promise.resolve({ ext: null, blocks: [], options: [], editor: [] });
  const key = `${org}/${site}`;
  if (!libraries.has(key)) {
    libraries.set(key, load(org, site).catch((error) => { libraries.delete(key); throw error; }));
  }
  return libraries.get(key);
}
export const loadBlockOptions = async (org, site) => (await loadBlockLibrary(org, site)).options;
export const isMultiBlock = async (org, site, name) => (
  isMultiBlockConfigured((await loadBlockLibrary(org, site)).editor, name)
);
export const resetBlockLibraryCache = () => libraries.clear();
export const resetBlockOptionsCache = resetBlockLibraryCache;

export async function getBlockFieldTemplate(blocks, name, variant, actions) {
  if (!descriptions.has(actions)) descriptions.set(actions, new Map());
  const cache = descriptions.get(actions);
  const variants = (await Promise.all(blocks.map(async (block) => (
    (await block.loadVariants).map((item) => ({ item, path: block.path }))
  )))).flat();
  const candidates = await Promise.all(variants.flatMap(({ item, path }) => {
    const tables = item.dom.tagName === 'TABLE' ? [item.dom]
      : [...item.dom.children].filter((child) => child.tagName === 'TABLE');
    return tables.map((dom) => ({ item: { ...item, dom }, path }));
  })
    .map(async (candidate) => {
      const html = candidate.item.dom.outerHTML;
      if (!cache.has(html)) {
        cache.set(html, actions.describeBlock({ html }).catch((error) => { cache.delete(html); throw error; }));
      }
      return { ...candidate, template: await cache.get(html) };
    }));
  return candidates.find(({ template }) => normalizeBlockName(template.name) === normalizeBlockName(name)
    && normalizeVariant(template.variant) === normalizeVariant(variant)) || null;
}

export async function getBlockVariantOptions(blocks, name) {
  const found = new Set();
  (await Promise.all(blocks.map((block) => block.loadVariants))).flat().forEach((item) => {
    const header = item.dom.tagName === 'TABLE' ? item.dom.rows[0]?.textContent.trim() : null;
    const match = (header || item.name || '').match(/^(.*\S)\s*\(([^)]+)\)\s*$/);
    const base = match?.[1] || (item.variants ? item.name : header || item.name);
    const variant = match?.[2] || item.variants;
    if (variant && normalizeBlockName(base) === normalizeBlockName(name)) found.add(variant);
  });
  return [...found];
}

export async function getBlockVariantChoices(blocks, name) {
  const choices = new Map();
  const items = (await Promise.all(blocks.map((block) => block.loadVariants))).flat();
  items.forEach((item) => {
    const header = item.dom.rows?.[0]?.textContent.trim() || '';
    const source = header.match(/^(.*\S)\s*\(([^)]+)\)\s*$/);
    if (!source || normalizeBlockName(source[1]) !== normalizeBlockName(name)) return;
    const display = item.name?.match(/^(.*\S)\s*\(([^)]+)\)\s*$/);
    const value = source[2].trim();
    choices.set(value, { value, label: display?.[2]?.trim() || value });
  });
  return [...choices.values()];
}

export async function getMultiBlockTemplateRow(org, site, name) {
  const { blocks } = await loadBlockLibrary(org, site);
  const match = (await Promise.all(blocks.map((block) => block.loadVariants))).flat().find((item) => {
    const header = item.dom.rows?.[0]?.textContent.trim() || item.name;
    return normalizeBlockName(header.replace(/\s*\([^)]*\)\s*$/, '')) === normalizeBlockName(name);
  });
  return match?.dom.rows?.[1] || null;
}
