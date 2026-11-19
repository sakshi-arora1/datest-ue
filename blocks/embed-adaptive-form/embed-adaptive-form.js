import { loadCSS } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

// a form document (/forms/contact.json) is rendered with the form block
async function loadFormDocument(href) {
  const base = window.hlx?.codeBasePath || '';
  const [{ default: decorateForm }] = await Promise.all([
    import('../form/form.js'),
    loadCSS(`${base}/blocks/form/form.css`),
  ]);
  const form = document.createElement('div');
  form.className = 'form block';
  form.dataset.blockName = 'form';
  const link = document.createElement('a');
  link.href = href;
  form.append(link);
  await decorateForm(form);
  return form;
}

export default function decorate(block) {
  // Create observer to load form when block enters viewport
  const observer = new IntersectionObserver(async (entries) => {
    const [entry] = entries;
    if (entry.isIntersecting) {
      // Disconnect observer after loading to prevent multiple loads
      observer.disconnect();

      const container = block.querySelector('a[href]');
      if (!container) return;
      // get the pathname from the href
      const { pathname } = new URL(container.href);
      if (pathname.endsWith('.json')) {
        block.replaceChildren(await loadFormDocument(container.href));
        return;
      }
      const form = await loadFragment(pathname);
      block.replaceChildren(form.children[0]);
    }
  });

  // Start observing the block
  observer.observe(block);
}
