# Form Picker

A DA library extension that embeds a form in a page. It lists the site's forms (DA
Structured Content documents of the `adaptive-form` schema, the documents the
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
| [/forms/contact](/forms/contact) |

The link is site-relative, so the page loads the form for the host that serves it. When the
block scrolls into view, `blocks/embed-adaptive-form` reads the form's JSON document from the
Structured Content delivery endpoint (the preview content on `aem.page`, the live content on
`aem.live`) and renders it with the form block. Links that are not forms still load as
fragments, and `.json` links as form definitions.

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

It finds forms with the Forms Manager's scan (`../formsmanager/scan.js`), which reads every
document of the site, so large sites take longer to load.

Unit tests: `npm test` (`test/tools/apps/formpicker/`).

## Limitations

- Preview or publish the form document too: the delivery endpoint serves only previewed
  (`aem.page`) or published (`aem.live`) documents.
- On other hosts (local development, a custom domain), the delivery endpoint cannot be found
  from the host name; link the delivery endpoint URL instead (see the Form Editor's README).
