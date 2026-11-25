export const normalizeBlockName = (name) => (name || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
export const normalizeVariant = (value) => (value || '').split(',').map(normalizeBlockName).sort().join(',');
export const normalizeForSlashMenu = (value) => value?.toLowerCase().trim().replace(/\s+/g, '-');
export const targetKey = (target) => JSON.stringify(target);
export const sameTarget = (a, b) => !!a && !!b && a.attribute === b.attribute && a.index === b.index;

export function matchFieldCount(fields, count) {
  if (fields.length === count) return fields;
  const content = fields.filter((field) => field.type !== 'text' || field.value);
  return content.length === count && content.every((field) => field.type === 'image') ? content : fields;
}

export function buildBlockFieldDefinitions(match, { multi = false } = {}) {
  if (!match || !('fields' in match.item)) return [];
  const { item, template } = match;
  const rows = item.fields?.rows;
  if (!rows || rows[0]?.cells.length !== 1 || rows[0].textContent.trim().toLowerCase() !== 'fields') {
    throw new Error('Block fields metadata must be a table with a Fields header.');
  }
  if (rows.length !== (multi ? 2 : template.rows.length + 1) || (multi && !template.rows.length)) {
    throw new Error(multi
      ? `Multi-item block fields metadata rows must contain exactly two rows: a Fields header and one shared first-item row. The library's ${template.rows.length} sample items do not need separate metadata rows, and a first template item must exist.`
      : 'Block fields metadata rows do not match the library template.');
  }
  const definitions = [];
  [...rows].slice(1).forEach((row, rowIndex) => {
    const templateRow = template.rows[rowIndex];
    if (row.cells.length !== templateRow.cells.length) {
      throw new Error('Block fields metadata cells do not match the library template.');
    }
    [...row.cells].forEach((cell, cellIndex) => {
      const labels = cell.children.length
        ? [...cell.children].map((el) => el.textContent.trim()) : [cell.textContent.trim()];
      const fields = matchFieldCount(templateRow.cells[cellIndex].fields, labels.length);
      if (labels.length !== fields.length) throw new Error('Block field names do not match the library template content.');
      labels.forEach((label, fieldIndex) => {
        if (!label || label.toUpperCase() === 'IGNORE') return;
        definitions.push({
          key: `${rowIndex}-${cellIndex}-${fieldIndex}`,
          label,
          rowIndex,
          cellIndex,
          fieldIndex,
          type: fields[fieldIndex].type,
          multiline: fields[fieldIndex].multiline,
          itemMultiline: fields[fieldIndex].items?.map((entry) => entry.multiline),
          multi,
          rowCount: template.rows.length,
          cellCount: templateRow.cells.length,
          fieldCount: fields.length,
        });
      });
    });
  });
  return definitions;
}

export function resolveBlockFields(block, definitions, { itemIndex = 0 } = {}) {
  if (!block) return [];
  return definitions.map((definition) => {
    const rowIndex = definition.multi ? itemIndex : definition.rowIndex;
    const row = block.rows[rowIndex];
    const cell = row?.cells[definition.cellIndex];
    const fields = matchFieldCount(cell?.fields || [], definition.fieldCount);
    const field = fields[definition.fieldIndex];
    const matches = (definition.multi || block.rows.length === definition.rowCount)
      && row?.cells.length === definition.cellCount && fields.length >= definition.fieldCount
      && field?.type === definition.type;
    return {
      ...definition,
      ...(matches ? field : { value: '', readOnly: true }),
      key: matches && field.target ? targetKey(field.target) : `${rowIndex}-${definition.key}`,
      target: matches ? field.target : null,
      itemIndex: definition.multi ? itemIndex : undefined,
      multiline: definition.multiline || field?.multiline,
      items: matches && field.type === 'list' ? (field.items || []).map((entry, index) => ({
        ...entry,
        key: entry.target ? targetKey(entry.target) : `${rowIndex}-${definition.key}-item-${index}`,
        label: `Item ${index + 1}`,
        multiline: entry.multiline || definition.itemMultiline?.[index] || definition.itemMultiline?.[0],
      })) : [],
      error: matches ? '' : 'This field does not match the selected block structure.',
    };
  });
}

export function isMultiBlockConfigured(rows, name) {
  return (rows || []).some((row) => normalizeBlockName(row.block) === normalizeBlockName(name)
    && row.property?.toLowerCase().trim() === 'multi');
}

export function processBlockOptions(data) {
  const map = new Map();
  (data || []).forEach((row) => {
    if (!row.blocks || !row.key || !row.values) return;
    const values = row.values.split('|').map((entry) => {
      const [title, value] = entry.split('=').map((part) => part.trim());
      return { title, value: value || title };
    });
    row.blocks.split(',').forEach((name) => {
      const key = normalizeForSlashMenu(name);
      if (!map.has(key)) map.set(key, new Map());
      map.get(key).set(normalizeForSlashMenu(row.key), values);
    });
  });
  map.forEach((options, name) => {
    if (name !== 'all') {
      map.get('all')?.forEach((values, key) => {
        if (!options.has(key)) options.set(key, values);
      });
    }
  });
  const get = map.get.bind(map);
  map.get = (name) => get(normalizeForSlashMenu(name)) || get('all');
  return map;
}

const fieldLayout = (field) => [field.type, field.tagName, field.href !== undefined];
const cellLayout = (cell) => [cell.colspan, cell.rowspan, cell.fields.map(fieldLayout)];
const rowLayout = (row) => row.cells.map(cellLayout);
const blockLayout = (block) => [block.name, block.variant, block.rows.map(rowLayout)];

function fieldContent(field, edit) {
  const value = edit && targetKey(field.target) === targetKey(edit.target)
    ? { ...field, [edit.property]: edit.value } : field;
  return [fieldLayout(value), value.value, value.href, value.items?.map((item) => fieldContent(item, edit))];
}
const cellContent = (cell, edit) => cell.fields.map((field) => fieldContent(field, edit));
const rowContent = (row, edit) => [row.key, row.cells.map((cell) => cellContent(cell, edit))];
const blockContent = (block, edit) => [
  blockLayout(block), block.rows.map((row) => rowContent(row, edit)),
];

function samePosition(before, after, index, layout, content, edit) {
  if (before.length !== after.length || !before[index] || !after[index]) return false;
  if (before[index].key !== after[index].key) return false;
  const shape = JSON.stringify(layout(before[index]));
  if (shape !== JSON.stringify(layout(after[index]))) return false;
  const previous = before.map((entry) => JSON.stringify(content(entry, edit)));
  const current = after.map((entry) => JSON.stringify(content(entry)));
  if (previous[index] === current[index]) return true;
  if (previous.some((value, i) => i !== index && value === current[index])
    || current.some((value, i) => i !== index && value === previous[index])) return false;
  // Without stable keys, several changed siblings of the same shape may have been reordered.
  return before[index].key !== undefined || before.filter((entry, i) => (
    JSON.stringify(layout(entry)) === shape && previous[i] !== current[i]
  )).length === 1;
}

function snapshotField(snapshot, target) {
  const block = snapshot?.blocks?.find((entry) => sameTarget(entry.target, target));
  const fields = block?.rows[target.rowIndex]?.cells[target.cellIndex]?.fields || [];
  return fields.flatMap((field) => [field, ...(field.items || [])])
    .find((field) => targetKey(field.target) === targetKey(target));
}

function canIdentifyField(before, after, target, edit) {
  if (!before?.blocks || !after?.blocks || before.documentId !== after.documentId
    || after.editable === false || !sameTarget(before.selectedBlock, target)
    || !sameTarget(after.selectedBlock, target)) return false;
  const index = before.blocks.findIndex((block) => sameTarget(block.target, target));
  if (index !== after.blocks.findIndex((block) => sameTarget(block.target, target))
    || !samePosition(before.blocks, after.blocks, index, blockLayout, blockContent, edit)) return false;
  const previous = before.blocks[index];
  const current = after.blocks[index];
  if (!samePosition(previous.rows, current.rows, target.rowIndex, rowLayout, rowContent, edit)) {
    return false;
  }
  const previousCells = previous.rows[target.rowIndex].cells;
  const currentCells = current.rows[target.rowIndex].cells;
  if (!samePosition(previousCells, currentCells, target.cellIndex, cellLayout, cellContent, edit)) {
    return false;
  }
  const previousFields = previousCells[target.cellIndex].fields;
  const currentFields = currentCells[target.cellIndex].fields;
  if (!samePosition(previousFields, currentFields, target.fieldIndex, fieldLayout, fieldContent, edit)) {
    return false;
  }
  return target.itemIndex === undefined || samePosition(
    previousFields[target.fieldIndex].items || [],
currentFields[target.fieldIndex].items || [],
target.itemIndex,
fieldLayout,
fieldContent,
edit,
  );
}

export class EditorSession {
  constructor() {
    this.snapshot = null;
    this.drafts = new Map();
  }

  receive(snapshot) {
    if (this.snapshot?.documentId !== snapshot.documentId) this.drafts.clear();
    this.snapshot = snapshot;
  }

  capture(target, snapshot = this.snapshot) {
    if (!snapshot || !target) return null;
    const { documentId, revision, liveBlockSignature } = snapshot;
    return {
      documentId,
      revision,
      target,
      ...(liveBlockSignature === undefined ? {} : { liveBlockSignature }),
    };
  }

  draft(field, property, value) {
    const key = `${targetKey(field.target)}:${property}`;
    if (!this.drafts.has(key)) {
      this.drafts.set(key, {
        ...this.capture(field.target),
        snapshot: this.snapshot,
        property,
        base: field[property],
        layout: JSON.stringify(fieldLayout(field)),
      });
    }
    this.drafts.get(key).value = value;
    return key;
  }

  value(field, property) {
    return this.drafts.get(`${targetKey(field.target)}:${property}`)?.value ?? field[property];
  }

  _rebase(draft, edit) {
    const current = snapshotField(this.snapshot, draft.target);
    const unchanged = current
      ? !current.readOnly && JSON.stringify(fieldLayout(current)) === draft.layout
        && current[draft.property] === draft.base
        && canIdentifyField(draft.snapshot, this.snapshot, draft.target, edit)
      : this.snapshot === draft.snapshot && !this.snapshot?.blocks;
    if (unchanged) Object.assign(draft, this.capture(draft.target), { snapshot: this.snapshot });
    return unchanged;
  }

  edit(field, property, value) {
    const key = `${targetKey(field.target)}:${property}`;
    const draft = this.drafts.get(key);
    if (value === (draft?.base ?? field[property])) {
      if (!draft || draft.value === value) this.drafts.delete(key);
      return null;
    }
    if (!draft) return { key, request: this.capture(field.target), snapshot: this.snapshot };
    const unchanged = this._rebase(draft);
    return {
      key,
      draft,
      request: this.capture(draft.target, draft.snapshot),
      snapshot: draft.snapshot,
      conflict: !unchanged,
    };
  }

  acknowledge(edit, property, value) {
    const draft = this.drafts.get(edit.key);
    if (!draft || draft !== edit.draft) return false;
    const current = snapshotField(this.snapshot, draft.target);
    if (!current || current.readOnly || current[property] !== value
      || !canIdentifyField(edit.snapshot, this.snapshot, draft.target, {
        target: draft.target, property, value,
      })) return false;
    draft.base = value;
    Object.assign(draft, this.capture(draft.target), { snapshot: this.snapshot });
    if (draft.value === value) this.drafts.delete(edit.key);
    this.drafts.forEach((pending) => {
      if (pending === draft) return;
      const ownEdit = pending.revision === edit.request.revision
        && pending.liveBlockSignature === edit.request.liveBlockSignature
        ? { target: draft.target, property, value } : undefined;
      this._rebase(pending, ownEdit);
    });
    return true;
  }
}
