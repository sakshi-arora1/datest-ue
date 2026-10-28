/*
 * Universal Editor support for the form block on DA (Author Bus).
 *
 * The whole Adaptive Form definition is stored as JSON in the block's <pre><code>.
 * In UE every rendered field is annotated as its own resource (urn:fj:/form-<n>/items/<i>...)
 * on the "fj" connection. Requests for those resources are served by the UE form proxy
 * (ue/proxy), which edits the JSON in DA and returns the updated form block.
 */
const FORM_URN = 'urn:fj:';
// must differ from the block name "form", otherwise DA treats the block rows as items
const FIELDS_FILTER = 'form-fields';
const OOTB_TYPES_WITHOUT_MODEL = ['wizard', 'toggleable-link', 'modal'];

const LEGACY_FIELD_TYPES = {
  text: 'text-input',
  select: 'drop-down',
  tel: 'telephone-input',
  'text-area': 'multiline-input',
  file: 'file-input',
  date: 'date-input',
  number: 'number-input',
  radio: 'radio-group',
  heading: 'plain-text',
};

function getFormBlocks() {
  return [...document.querySelectorAll('main .form[data-aue-resource]')];
}

function readDefinition(block) {
  const code = block.querySelector('pre > code');
  if (!code) return null;
  try {
    return JSON.parse(code.textContent);
  } catch {
    return null;
  }
}

function getModel(fd) {
  if (fd[':type'] && !fd[':type'].startsWith('core/fd/components')
    && !OOTB_TYPES_WITHOUT_MODEL.includes(fd[':type'])) {
    return fd[':type'];
  }
  const fieldType = LEGACY_FIELD_TYPES[fd.fieldType] || fd.fieldType;
  if (fieldType === 'button') {
    const click = JSON.stringify(fd.events?.click || '');
    if (click.includes('submitForm')) return 'form-submit-button';
    if (click.includes('reset')) return 'form-reset-button';
    return 'form-button';
  }
  if (fieldType === 'image') return 'form-image';
  return fieldType;
}

// id/name of every field -> its index path in the form JSON
function indexFields(node, path = [], map = new Map()) {
  (node.items || []).forEach((item, i) => {
    const itemPath = [...path, i];
    if (item.id) map.set(item.id, { fd: item, path: itemPath });
    if (item.name && !map.has(item.name)) map.set(item.name, { fd: item, path: itemPath });
    indexFields(item, itemPath, map);
  });
  return map;
}

const resourceOf = (formIndex, path) => `${FORM_URN}/form-${formIndex}${path.map((i) => `/items/${i}`).join('')}`;

export function annotateForm(block, formIndex = getFormBlocks().indexOf(block)) {
  const formEl = block.querySelector('form');
  const def = readDefinition(block);
  if (!formEl || !def || formIndex < 0) return;

  // the raw JSON is edited field by field, so hide it from UE's content tree
  const code = block.querySelector('pre > code');
  [...code.attributes].filter((a) => a.name.startsWith('data-aue-'))
    .forEach((a) => code.removeAttribute(a.name));

  formEl.setAttribute('data-aue-resource', resourceOf(formIndex, []));
  formEl.setAttribute('data-aue-type', 'container');
  formEl.setAttribute('data-aue-filter', FIELDS_FILTER);
  formEl.setAttribute('data-aue-label', def.title || 'Form fields');

  const fields = indexFields(def);
  formEl.querySelectorAll('.field-wrapper[data-id]').forEach((wrapper) => {
    const match = fields.get(wrapper.dataset.id);
    if (!match) return;
    const { fd, path } = match;
    wrapper.setAttribute('data-aue-resource', resourceOf(formIndex, path));
    wrapper.setAttribute('data-aue-model', getModel(fd));
    wrapper.setAttribute('data-aue-label', fd.label?.value || fd.name || fd.id);
    if (fd.fieldType === 'panel') {
      wrapper.setAttribute('data-aue-type', 'container');
      wrapper.setAttribute('data-aue-behavior', 'component');
      wrapper.setAttribute('data-aue-filter', FIELDS_FILTER);
    } else {
      wrapper.setAttribute('data-aue-type', 'component');
    }
  });
}

function blockForResource(resource) {
  if (!resource) return null;
  if (resource.startsWith(FORM_URN)) {
    const m = resource.match(/^urn:fj:\/form-(\d+)/);
    return m ? getFormBlocks()[Number(m[1])] : null;
  }
  const el = document.querySelector(`[data-aue-resource="${resource}"]`);
  const block = el?.closest('.form[data-aue-resource]');
  return block?.getAttribute('data-aue-resource') === resource ? block : null;
}

function requestResources(request) {
  return [
    request?.target?.resource,
    request?.target?.container?.resource,
    request?.to?.container?.resource,
    request?.from?.container?.resource,
  ].filter(Boolean);
}

async function rerender(block, content) {
  const updated = new DOMParser().parseFromString(content, 'text/html');
  const json = updated.querySelector('pre > code')?.textContent;
  const code = block.querySelector('pre > code');
  if (!json || !code) return false;

  code.textContent = json;
  block.querySelector('pre').hidden = false;
  block.querySelector('form')?.remove();
  const { default: decorate } = await import('../../blocks/form/form.js');
  await decorate(block);
  annotateForm(block);
  return true;
}

function onContentChange(event) {
  const { request, response } = event.detail || {};
  const block = requestResources(request).map(blockForResource).find(Boolean);
  if (!block) return;

  event.preventDefault();
  event.stopPropagation();
  const content = response?.updates?.find((u) => u.content)?.content;
  (content ? rerender(block, content) : Promise.resolve(false))
    .then((applied) => { if (!applied) window.location.reload(); })
    .catch(() => window.location.reload());
}

export default function setupFormEditing() {
  ['aue:content-update', 'aue:content-patch', 'aue:content-add', 'aue:content-remove', 'aue:content-move']
    .forEach((type) => document.addEventListener(type, onContentChange, true));

  // annotate forms whenever the form block renders its <form>
  new MutationObserver((mutations) => {
    mutations.forEach(({ addedNodes }) => addedNodes.forEach((node) => {
      if (node.nodeName === 'FORM') {
        const block = node.closest('.form[data-aue-resource]');
        if (block) annotateForm(block);
      }
    }));
  }).observe(document, { childList: true, subtree: true });
}
