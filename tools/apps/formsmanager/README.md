# Forms Manager

A DA app that lists the forms of a site: every JSON document whose `metadata.schemaName` is
`adaptive-form` (a form) or `adaptive-form-fragment` (a form fragment). These are the
Structured Content JSON documents that the [Form Editor](../formeditor/README.md) edits:

```json
{ "metadata": { "schemaName": "adaptive-form", "title": "Contact" }, "data": { "...": "Crispr form" } }
```

## How to use

Open the app from a site. It scans the site's JSON documents and lists the forms and form
fragments with their path, title, type, number of fields and last change. Search by path or
title, filter by **Forms** or **Fragments**, and use **Edit** to open a document in the Form
Editor. **Rescan** lists the documents again.

## How it finds forms

1. Lists every `.json` file of the site through the DA source API
   (`GET /list/{org}/{site}/...`), recursively. Hidden folders such as `/.da` (DA
   configuration) are skipped.
2. Reads each file (`GET /source/{org}/{site}/{path}.json`), six at a time, and keeps the
   documents that have `metadata` and `data` objects and a `metadata.schemaName` of
   `adaptive-form` or `adaptive-form-fragment`. Spreadsheets, other schemas and files that are
   not valid JSON are left out.

The title is `metadata.title`, or else the form's `title`. Fields counts the items of the form
that are not panels, at every level.

Large sites take longer to scan, since every JSON file is read.

## Configuring

Register the app in the site's DA config sheet, **apps** tab:

| title | description | image | path |
| --- | --- | --- | --- |
| `Forms Manager` | List the forms and form fragments of the site | *(an icon URL)* | `/app/{org}/{site}/tools/apps/formsmanager/formsmanager` |

The app uses the organization and site of the `/app/{org}/{site}/` path (or the `org` and `site`
query parameters). **Edit** opens `/app/{org}/{site}/tools/apps/formeditor/formeditor` on the
same branch (`ref`) as the Forms Manager.

## Files

| File | Purpose |
| --- | --- |
| `formsmanager.html` | App shell, importmap, DA SDK, and nx2 styles |
| `formsmanager.js` | `<formsmanager-app>` Lit component: scan, filters, list |
| `formsmanager.css` | App styles |
| `forms.js` | Pure helpers: which JSON documents are forms, limited concurrency |
| `scan.js` | Lists and reads the site's JSON files to find the forms (also used by the Form Picker) |

It shares the DA source API module of the Form Editor (`../formeditor/api.js`).

Unit tests: `npm test` (`test/tools/apps/formsmanager/`).
