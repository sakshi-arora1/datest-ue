# Form Picker

A DA library extension that embeds a form in a page. It lists the site's forms (JSON
documents with `"schemaName": "adaptive-form"`, the documents the
[Form Editor](../formeditor/README.md) edits) and inserts an **Embed Adaptive Form** block that
links the chosen form into the open document.

## How to use

1. In the DA document editor, open **Form Picker** from the library.
2. Pick a form. Search by title or path, and use ↑/↓ and Enter, or double-click.
3. Click **Insert form**. The block is inserted at the cursor and the library closes.

The inserted block, as in
[aem-boilerplate-forms](https://github.com/adobe-rnd/aem-boilerplate-forms/tree/main/blocks/embed-adaptive-form):

| embed-adaptive-form |
| --- |
| [/forms/contact.json](/forms/contact.json) |

The link is site-relative, so the page loads the form from the host that serves it.
`blocks/embed-adaptive-form` renders a form document (a `.json` link) with the form block when
the block scrolls into view; links to other pages still load as fragments.

Form fragments (`adaptive-form-fragment`) are not listed: they are parts of forms, not forms
to embed in a page.

## Configuring

Register the extension in the site's DA config sheet, **library** tab:

| title | path |
| --- | --- |
| `Form Picker` | `/app/{org}/{site}/tools/apps/formpicker/formpicker` |

The organization and site come from the document the library is opened from (or the
`/app/{org}/{site}/` path).

## Files

| File | Purpose |
| --- | --- |
| `formpicker.html` | Extension shell, importmap, DA SDK, and nx2 styles |
| `formpicker.js` | `<formpicker-app>` Lit component: list, search, insert |
| `formpicker.css` | Extension styles |
| `block.js` | Pure helpers: the Embed Adaptive Form block HTML |

It finds forms with the Forms Manager's scan (`../formsmanager/scan.js`), which reads every JSON
file of the site, so large sites take longer to load.

Unit tests: `npm test` (`test/tools/apps/formpicker/`).

## Limitations

- Edge Delivery Services does not preview or publish JSON documents yet (see the Form Editor's
  README), so the embedded form shows on `aem.page` and `aem.live` once it does.
