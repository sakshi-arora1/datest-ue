# Form Editor

A DA app for editing Adaptive Forms that are stored as Crispr JSON in DA documents. It looks
and works like the DA canvas editor: a header with Preview / Layout / Content / Split views,
and a right panel with Blocks, Outline, and Block Inspector tabs. The Coworker chat panel
can be used next to it.

## How forms are stored

A form is the `form` block of a document. The block holds the form definition (Crispr JSON) in
`<pre><code>`, the same way Universal Editor on DA stores it (`ue/models/blocks/form.json`) and
the form block renders it (`blocks/form/form.js`). The editor:

- reads the JSON from the block's `<code>` and edits that JSON. Edits are applied by JSON
  path, so properties that the editor does not know about are kept.
- saves by writing the JSON back into the `<code>` of the latest version of the document.
  The rest of the document is kept as stored. If someone changed the form meanwhile, the save
  stops and asks whether to load their version or keep yours.
- keeps the storage format. A JSON string literal (double encoded) stays double encoded.

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

Selecting an item on the canvas opens this tab. The panel's split icon hides it and the same
icon in the editor header shows it again. Each property sheet is a Crispr form generated from the
component's model (`property-form.js`): every model tab is a panel, and every property is a
field bound to its JSON path with `dataRef` (for example
`$.properties['fd:submit'].actionName`). The Block Inspector draws that form and writes the
values to the bound paths. The palette and the properties therefore match what authors see in Universal Editor. Each item
also has a JSON tab, which is the only editor for items that match no component.

Undo/redo (⌘Z / ⇧⌘Z) and save (⌘S) work across all views. Delete/Backspace removes the
selected item.

## Coworker chat

In the DA shell, the chat panel is available to site apps when Experience Workspace chat is
enabled for the site (`ew.*` flags). If it is available, the Coworker panel is shown on the
left; the round Coworker button in the editor header shows or hides it, and ✕ in the panel
closes it (the choice is remembered). It is available in every view, Preview included; the
preview reloads when Coworker changes the form. Ask
Coworker sends the prompt with the document path and the selected item; unsaved changes are
saved first. **Open the conversation** opens the DA chat panel. When a chat turn completes, the
editor reloads the form if its stored version changed. Undo reverts that change locally. If
you have unsaved changes, it asks which version to keep instead. Without chat support, the
Coworker button and panel are hidden.

## Configuring

Register the app in the site's DA config sheet, **apps** tab:

| title | description | image | path |
| --- | --- | --- | --- |
| `Form Editor` | Edit Adaptive Forms | *(an icon URL)* | `/app/{org}/{site}/tools/apps/formeditor/formeditor` |

| Parameter | Required | Description |
| --- | --- | --- |
| `path` | No | Document to open, for example `/forms/contact`. Without it, the app lists the documents in `/forms/` and can create a new form there. |
| `block` | No | Which form block to edit, when the document has several (1-based). |

The app must run from the site (`/app/{org}/{site}/...`) because the component catalog and the
Preview view are loaded from the site's own code and configuration. The chat panel is offered
only to site apps.

## Files

| File | Purpose |
| --- | --- |
| `formeditor.html` | App shell, importmap, DA SDK, and nx2 styles |
| `formeditor.js` | `<formeditor-app>` Lit component: views, panels, editing, save, chat |
| `formeditor.css` | App styles |
| `crispr.js` | Pure helpers: read/write the form block, JSON paths, item tree operations, UE catalog rules |
| `catalog.js` | Loads the UE configuration as the component catalog |
| `property-form.js` | Converts UE component models to Crispr property forms for the Block Inspector |
| `api.js` | Authenticated DA source read, save, and listing |
| `preview.html`, `preview.js`, `preview.css` | Preview view: renders the form with `blocks/form` |
| `icons.js` | Icons |

Unit tests: `npm test` (`test/tools/apps/formeditor/`).

## Limitations

- The Layout view shows the form structure, not its final rendering; use Preview for that.
- Persistence uses the DA source API (`admin.da.live`), like the other apps in this project.
