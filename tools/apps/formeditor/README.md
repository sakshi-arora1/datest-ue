# Form Editor

A standalone editor for Adaptive Forms stored as Structured Content JSON documents, and a DA app
built on it. It looks and works like the DA canvas editor: a header with Preview / Layout /
Content / Split views, and a right panel with Blocks, Outline, and Block Inspector tabs. An
assistant (DA's Coworker in the DA app) can be used next to it.

The editor (`editor/`) depends on no host. It reads and writes forms through a storage
**contract** and talks to an optional assistant contract; each host provides implementations:

| Entry | Storage | Assistant |
| --- | --- | --- |
| `formeditor.html`: DA app | DA site, through the DA source API (`providers/da/`) | DA's Coworker chat (`providers/da/`) |
| `standalone.html`: no DA | This browser's `localStorage` (`providers/local/`) | None |

## Architecture

```text
formeditor/
  editor/              standalone editor: no DA (or other host) dependency
    form-editor.js       <form-editor> Lit element and mountFormEditor()
    contract.js          contracts (FormStorage, Assistant) and the registry
    crispr.js            form model and document helpers
    catalog.js           component catalog (the site's UE configuration)
    preview.*            Preview view (the site's form block)
    tokens.css           design tokens for hosts without DA's styles
  providers/
    da/                  DA implementations: storage (DA source API), assistant (Coworker)
    local/               localStorage implementation of the storage
  formeditor.html/.js  DA app: registers the DA providers, mounts the editor
  standalone.html/.js  standalone: registers the localStorage provider, mounts the editor
```

### Contracts

A contract works like a Java interface: it names the methods that an implementation must have
(`editor/contract.js`). Hosts register implementations with the registry. When the editor
starts, it asks the registry for each contract and gets the first registered implementation
that is available (`isAvailable()`), by `priority` and then by registration order. The editor
checks that the implementation has every required method.

**FormStorage** (required). Paths are site-relative, such as `/forms/contact.json`. Documents
are plain JSON objects (`{ metadata, data }`).

| Method | Returns | Description |
| --- | --- | --- |
| `describe()` | `{ label }` | Where the forms are, shown to authors (`org/site`, `this browser`) |
| `read(path)` | `{ document, canWrite }` or `null` | The document at `path`; `null` when there is none |
| `write(path, document)` | | Creates or replaces the document |
| `list({ schemas, onForm, onProgress, isCancelled })` | | Reports each form and form fragment document with `onForm({ path, title, kind, schemaName, fields, lastModified })` |

**Assistant** (optional; without one, the assistant panel and button are hidden).

| Method | Returns | Description |
| --- | --- | --- |
| `ask(prompt)` | | Sends a prompt about the open form |
| `onTurnCompleted(callback)` | unsubscribe function | `callback({ status })` when the assistant finished; the editor then reloads the form from storage |
| `open()` | | Optional: shows the conversation |
| `describe()` | `{ name }` | Optional: the name shown to authors (default `Assistant`) |

### Adding a storage

Write an object with the FormStorage methods, register it, and mount the editor:

```js
import { registry, FormStorage } from './editor/contract.js';
import { mountFormEditor } from './editor/form-editor.js';

registry.register(FormStorage, {
  name: 'My API',
  isAvailable: () => Boolean(window.MY_API_URL),
  create: () => ({
    describe: () => ({ label: 'My API' }),
    read: async (path) => { /* GET; return { document, canWrite } or null */ },
    write: async (path, document) => { /* PUT */ },
    list: async ({ onForm }) => { /* onForm({ path, title, kind, ... }) for each form */ },
  }),
});

mountFormEditor(document.body);
```

`mountFormEditor(container, options)` also accepts a `storage` and an `assistant` directly, and
these options:

| Option | Default | Description |
| --- | --- | --- |
| `path` | the `path` query parameter | Form document to open; without it, the editor lists the forms |
| `catalogUrl` | the site root | Folder URL of the `component-*.json` files |
| `previewUrl` | `editor/preview.html` | Preview page; `false` hides the Preview view |
| `syncUrl` | `true` | Keep the open form in the `path` query parameter |
| `registry` | the shared registry | Registry to resolve the contracts from |

The page that hosts the editor maps `lit` with an import map: DA's copy in `formeditor.html`,
jsDelivr's in `standalone.html`.

### Standalone

Open `/tools/apps/formeditor/standalone.html` from the site (for example with `aem up`, or on
`aem.page`). It needs no DA and no sign-in: forms are kept in the browser, and a sample form
is created the first time. The catalog and the Preview view come from the site that serves the
page.

## How forms are stored

Each form is a JSON document in DA, in any folder of the site, for example
`/forms/contact.json`. It uses the Structured
Content document shape: the document's `metadata` names its schema, and `data` holds the form
definition (Crispr JSON).

```json
{
  "metadata": { "schemaName": "adaptive-form", "title": "Contact" },
  "data": {
    "adaptiveform": "0.10.0",
    "title": "Contact",
    "items": [{ "name": "email", "fieldType": "email", "label": { "value": "Email" } }]
  }
}
```

This is the JSON storage format agreed for Structured Content (RFC "JSON storage format for
Structured Content", accepted 2026-11-05). The document is stored and read as JSON as it is, with
no conversion to HTML. The storage decides where documents live. The DA storage
(`providers/da/storage.js`) uses the DA source API (`admin.da.live`):

| Operation | Request |
| --- | --- |
| Read | `GET /source/{org}/{site}/{path}.json` |
| Save | `POST /source/{org}/{site}/{path}.json` with the JSON document (`application/json`) |
| List | `GET /list/{org}/{site}/...` (every `.json` file of the site, recursively; each is read to keep the form documents) |

The editor:

- edits `data` by JSON path, so properties that the editor does not know about are kept.
- saves into the latest version of the document. It keeps the document's `metadata` and any
  other top-level properties as stored. If someone changed the form meanwhile, the save stops
  and asks whether to load their version or keep yours.
- creates new forms as `{ metadata: { schemaName: "adaptive-form", title }, data }`, at the path
  you type (`/hr/onboarding`), or in `/forms/` when you type only a name.
- opens a bare Crispr JSON document too, and saves it in the document shape. It refuses
  spreadsheets (`:type: sheet`) and other JSON.

Form fragments are documents of the same shape with `"schemaName": "adaptive-form-fragment"`;
the editor opens them too and keeps their schema name. The
[Forms Manager](../formsmanager/README.md) lists the forms and fragments of a site.

To show a form on a page, insert it with the [Form Picker](../formpicker/README.md), which adds
an Embed Adaptive Form block linking the document (for example `/forms/contact.json`). The
block renders `data` with the form block (`blocks/form/form.js`), which also accepts such a
link directly.

## Views

| View | What it shows |
| --- | --- |
| Preview | The form as visitors get it, rendered by the site's form block with its rules, including unsaved changes. Submitting is disabled. |
| Layout | The form as a container card holding its items as cards; panels are containers too and can hold panels. Click the form or a panel anywhere outside its items to select it. Click a card to select it. The selected card has buttons to edit its title (or the text of a Text item) in place, move it up or down, duplicate it, or delete it. Double-clicking a card's title also edits it; Enter saves and Esc cancels. To insert a block between items, hover the gap between two cards (or inside a panel) and click **+**, or select an item and press **/** to insert after it; both open a searchable block menu (↑/↓, Enter, Esc). Empty panels show **Add a block**. Drag cards to move them (also into and out of panels), and drag blocks from the Blocks tab onto the canvas, or click a block to add it after the selected item. |
| Content | The form's JSON. Valid edits apply as you type. Invalid JSON is reported and not applied. |
| Split | Layout and Content side by side. |

The Outline tab lists the form's items as a tree. Drag a row to move the item: drop on the
top or bottom part of a row to place it before or after, or on the middle of a panel (or the
form) to move it inside. Alt+↑ / Alt+↓ moves the focused row up or down.

The Block Inspector tab shows the selected item's properties (or the form's settings). Its tabs
come from the site's Universal Editor configuration:

- `component-definition.json`: the components and which of them are containers
- `component-filters.json`: the order of the components
- `component-models.json`: the properties of each component
- `component-json-mappings.json`: how an item maps to a component, and the defaults of new items
- `component-property-forms.json`: the property sheet of each component, as a Crispr form

Selecting an item on the canvas opens this tab. The panel's split icon hides it and the same
icon in the editor header shows it again. Each property sheet is a Crispr form stored with its component: in
`ue/models/form/<component>.json`, next to `definitions`, `models` and `filters`, as
`"propertyForms": [{ "id": "<model id>", "form": { ... } }]`. It is authored there directly:
to change what the Block Inspector shows for a component, edit its property form, then run
`npm run build:json`, which merges the property forms into `component-property-forms.json`. The
editor loads that file as it is.

In a property form, every panel is a tab of the sheet, and every field is bound to the property
it edits with `dataRef` (for example `$.properties['fd:submit'].actionName`). The Block
Inspector draws the fields by `fieldType` (`text-input`, `multiline-input`, `number-input`,
`date-input`, `checkbox`, `checkbox-group`, `drop-down`, `radio-group`) and uses `required`,
`default`, `placeholder`, `description`, `enum`/`enumNames`, `pattern` and
`constraintMessages.pattern`. Two hints have no Crispr property and are kept under `properties`:
`fe:visibleWhen` (a JSONLogic condition on the item, such as
`{ "===": [{ "var": "properties.repeatable" }, true] }`) and `fe:richText`. A unit test checks
that every component has a valid property form and that `component-property-forms.json` is
up to date. The palette and the properties therefore match what authors see in Universal Editor. Each item
also has a JSON tab, which is the only editor for items that match no component.

Undo/redo (header buttons, ⌘Z / ⇧⌘Z or ⌘Y, Ctrl on Windows) and save (⌘S) work across all
views, Preview included. Every change is one step: property edits, inline text edits, adding,
inserting, duplicating, deleting, moving and dragging, JSON edits, and a Coworker change
that the editor loads. A new change clears the redo steps. Undoing back to the saved version
shows "All changes saved" again. In a text field, ⌘Z undoes typing in that field. Delete/Backspace removes the
selected item.

## Coworker chat (DA)

In the DA app, the assistant is DA's Coworker (`providers/da/assistant.js`). In the DA shell, the chat panel is available to site apps when Experience Workspace chat is
enabled for the site (`ew.*` flags). If it is available, the Coworker panel is shown on the
left; the round Coworker button in the editor header shows or hides it, and ✕ in the panel
closes it (the choice is remembered). It is available in every view, Preview included; the
preview reloads when Coworker changes the form. Ask
Coworker sends the prompt with the document path and the selected item; unsaved changes are
saved first. **Open the conversation** opens the DA chat panel. When a chat turn completes, the
editor reloads the form if its stored version changed. Undo reverts that change locally. If
you have unsaved changes, it asks which version to keep instead. Without chat support, the
Coworker button and panel are hidden.

## Tech stack

The editor is plain JavaScript modules (ES2022) served by the site, with no build step and no npm
runtime dependencies. The editor itself (`editor/`) depends on no host; only the DA entry
(`formeditor.html`, `formeditor.js`) and the DA providers (`providers/da/`) use DA.

| Layer | Technology | Where |
| --- | --- | --- |
| Host | Any page (`standalone.html`) or a DA app (`/app/{org}/{site}/...`, loaded in an iframe by the DA shell) | `standalone.html`, `formeditor.html` |
| Host integration | Contracts (`FormStorage`, `Assistant`) and a registry that resolves the first available implementation of each; the DA app uses the DA App SDK only in its entry and providers | `editor/contract.js`, `formeditor.js`, `standalone.js` |
| UI components | [Lit](https://lit.dev) 3.3 (lit-element 4.2, lit-html 3.3) as a bare `lit` import, mapped by the host page's import map; one `<form-editor>` custom element with shadow DOM | `editor/form-editor.js` |
| Styles | Spectrum 2 design tokens as CSS custom properties (DA's nx2 styles in the DA app, `editor/tokens.css` standalone); the editor's own stylesheet adopted as a constructable stylesheet; plain CSS with grid, container queries and `light-dark()` | `editor/form-editor.css`, `editor/tokens.css` |
| Icons | Inline SVG paths | `editor/icons.js` |
| State | Lit reactive properties; the form is a plain JSON object, every edit is a deep copy (`structuredClone`) pushed on an undo stack (100 steps) | `editor/form-editor.js` |
| Form model | Crispr (Adaptive Form JSON) with pure helpers: JSON paths, item tree operations, UE mapping rules, JSONLogic conditions | `editor/crispr.js` |
| Document format | Structured Content JSON documents (`{ metadata, data }`), stored as they are | `editor/crispr.js` |
| Persistence | A `FormStorage`: the DA source API (`admin.da.live`: `/source`, `/list`) through `daFetch`, which adds the IMS token; or the browser's `localStorage`, one JSON entry per document under a key prefix | `providers/da/`, `providers/local/` |
| Component catalog | The site's Universal Editor configuration (`component-*.json`), fetched from the site (`catalogUrl`) | `editor/catalog.js` |
| Property sheets | Crispr forms stored with the components (`ue/models/form/*.json`, merged into `component-property-forms.json` by `merge-json-cli`), bound with `dataRef` | `editor/catalog.js`, `editor/form-editor.js` |
| Drag and drop | Native HTML5 drag and drop | `editor/form-editor.js` |
| Preview | The site's own form block (`blocks/form`) and its rule engine (web worker), in a same-origin iframe, talking to the editor with `postMessage` (`previewUrl`) | `editor/preview.*` |
| Assistant | An `Assistant`: in the DA app, the DA shell chat panel (Experience Workspace chat), driven through the SDK; none standalone | `providers/da/assistant.js` |
| Tests | `node:test` and `node:assert`, run with Node 20 (`npm test`): the form model, property forms, contracts and registry, and the localStorage provider (against an in-memory Storage) | `test/tools/apps/formeditor/` |
| Linting | ESLint (`airbnb-base`) and Stylelint (`stylelint-config-standard`), as in the rest of the repo | `.eslintrc.js`, `.stylelintrc.json` |

What each entry loads from outside the site:

| Entry | Loads |
| --- | --- |
| `formeditor.html` (DA app) | Lit from DA (`https://da.live/deps/lit/dist/index.js`); the DA App SDK (`https://da.live/nx/utils/sdk.js`); DA's styles and color scheme (`https://da.live/nx2/`); `daFetch` and the DA admin endpoint (`https://da.live/nx/`); the DA source API (`https://admin.da.live`) |
| `standalone.html` | Lit 3.3.3 from jsDelivr (`https://cdn.jsdelivr.net/npm/lit@3.3.3/+esm`) |

To run the standalone editor without any CDN, map `lit` to a copy served by the site.

Browser support: a current Chrome, Edge, Firefox or Safari. The editor uses import maps,
constructable stylesheets, custom elements and shadow DOM, private class fields, `structuredClone`,
`Object.hasOwn`, container queries and `light-dark()`.

The Modern Form Editor research suggests React 19, TypeScript, dnd-kit, Zustand, Tailwind and Radix
for a standalone editor. This editor uses Lit and Spectrum 2 tokens instead, so that the same
code runs standalone and inside DA without a build, and looks like the DA canvas editor.

## Configuring

Register the app in the site's DA config sheet, **apps** tab:

| title | description | image | path |
| --- | --- | --- | --- |
| `Form Editor` | Edit Adaptive Forms | *(an icon URL)* | `/app/{org}/{site}/tools/apps/formeditor/formeditor` |

| Parameter | Required | Description |
| --- | --- | --- |
| `path` | No | Form document to open, for example `/forms/contact` (`.json` is added). Without it, the app lists the form and fragment documents of the whole site and can create a new form. |

The app must run from the site (`/app/{org}/{site}/...`) because the component catalog and the
Preview view are loaded from the site's own code and configuration. The chat panel is offered
only to site apps.

## Files

| File | Purpose |
| --- | --- |
| `formeditor.html`, `formeditor.js` | DA app: import map, DA SDK, DA styles; registers the DA providers and mounts the editor |
| `standalone.html`, `standalone.js` | Standalone page: import map, tokens; registers the localStorage provider and mounts the editor |
| `editor/form-editor.js` | `<form-editor>` Lit element (views, panels, editing, save, assistant) and `mountFormEditor()` |
| `editor/form-editor.css` | Editor styles |
| `editor/tokens.css` | Spectrum 2 design tokens for hosts without DA's styles |
| `editor/contract.js` | The `FormStorage` and `Assistant` contracts and the registry |
| `editor/crispr.js` | Pure helpers: form documents, JSON paths, item tree operations, UE catalog rules |
| `editor/catalog.js` | Loads the UE configuration as the component catalog |
| `editor/property-form.js` | Reads the property path of a `dataRef` |
| `editor/preview.html`, `.js`, `.css` | Preview view: renders the form with `blocks/form` |
| `editor/icons.js` | Icons |
| `providers/da/storage.js` | `FormStorage` on a DA site |
| `providers/da/assistant.js` | `Assistant` on DA's Coworker |
| `providers/da/api.js` | Authenticated DA source read, save, and listing (also used by the Forms Manager and Form Picker) |
| `providers/local/storage.js` | `FormStorage` in `localStorage` |

Unit tests: `npm test` (`test/tools/apps/formeditor/`), including the contracts, the registry
and the localStorage provider.

## Limitations

- The Layout view shows the form structure, not its final rendering; use Preview for that.
- Edge Delivery Services does not preview or publish JSON documents yet: today it accepts JSON
  only as spreadsheets. The EDS team agreed to support JSON documents
  ("Alignment with Edge Delivery Services: JSON documents for Structured Content"); until then
  a page cannot load a form document from `aem.page` or `aem.live`. The editor and its Preview
  view work without it.
- The documents have no `$schema` property yet: how EDS will tell JSON documents from sheets is
  still open, and a top-level `$schema` is one suggestion.
- DA's Structured Content editor (`da.live/form`) reads the HTML format today, so it does not
  open these documents.
- Forms in older pages, as a Form block with the JSON in `<pre><code>`, are not edited by this
  app; Universal Editor on DA still edits them.
