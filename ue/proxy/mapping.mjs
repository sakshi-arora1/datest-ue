/*
 * Maps between AEM Forms component model property names (used by the UE property panel
 * and by the xwalk component templates) and the Adaptive Form (Crispr) JSON stored in DA.
 */

// model property -> [crispr path] (dot separated)
const DIRECT = {
  'jcr:title': 'label.value',
  description: 'description',
  tooltip: 'tooltip',
  placeholder: 'placeholder',
  name: 'name',
  type: 'type',
  fieldType: 'fieldType',
  required: 'required',
  readOnly: 'readOnly',
  enabled: 'enabled',
  visible: 'visible',
  enum: 'enum',
  enumNames: 'enumNames',
  default: 'default',
  pattern: 'pattern',
  minLength: 'minLength',
  maxLength: 'maxLength',
  minimum: 'minimum',
  maximum: 'maximum',
  minimumDate: 'minimum',
  maximumDate: 'maximum',
  maxFileSize: 'maxFileSize',
  accept: 'accept',
  minOccur: 'minOccur',
  maxOccur: 'maxOccur',
  dataRef: 'dataRef',
  displayFormat: 'displayFormat',
  value: 'value',
  mandatoryMessage: 'constraintMessages.required',
  minLengthMessage: 'constraintMessages.minLength',
  maxLengthMessage: 'constraintMessages.maxLength',
  minimumMessage: 'constraintMessages.minimum',
  maximumMessage: 'constraintMessages.maximum',
  validatePictureClauseMessage: 'constraintMessages.pattern',
  validateExpMessage: 'constraintMessages.validationExpression',
  acceptMessage: 'constraintMessages.accept',
  maxFileSizeMessage: 'constraintMessages.maxFileSize',
  orientation: 'properties.afs:layout.orientation',
};

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

const DATE_TYPES = ['date-input', 'date'];

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function set(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  });
  const last = keys.at(-1);
  if (value === undefined || value === null || value === '') delete o[last];
  else o[last] = value;
}

function coerce(prop, value) {
  if (value === undefined || value === null) return value;
  if (['required', 'readOnly', 'enabled', 'visible', 'hideTitle', 'multiSelect', 'repeatable'].includes(prop)) {
    return value === true || value === 'true';
  }
  if (['minLength', 'maxLength', 'minimum', 'maximum', 'maxFileSize', 'minOccur', 'maxOccur'].includes(prop)
    && value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (['enum', 'enumNames', 'accept'].includes(prop) && !Array.isArray(value)) {
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return value;
}

export function normalizeFieldType(fieldType) {
  return LEGACY_FIELD_TYPES[fieldType] || fieldType;
}

export function toJcr(item) {
  const data = {};
  Object.entries(DIRECT).forEach(([prop, path]) => {
    if (DATE_TYPES.includes(item.fieldType) && (prop === 'minimum' || prop === 'maximum')) return;
    if (!DATE_TYPES.includes(item.fieldType) && (prop === 'minimumDate' || prop === 'maximumDate')) return;
    const v = get(item, path);
    if (v !== undefined) data[prop] = v;
  });
  if (data.fieldType) data.fieldType = normalizeFieldType(data.fieldType);
  if (item.label?.visible === false) data.hideTitle = true;
  if (item.repeatable !== undefined) data.repeatable = item.repeatable;
  Object.entries(item.properties || {}).forEach(([k, v]) => {
    if (!k.startsWith('fd:') && k !== 'afs:layout' && data[k] === undefined) data[k] = v;
  });
  return data;
}

export function setJcrProp(item, prop, rawValue) {
  const value = coerce(prop, rawValue);
  if (prop === 'hideTitle') {
    set(item, 'label.visible', value ? false : undefined);
    return;
  }
  if (prop === 'repeatable') {
    set(item, 'repeatable', value || undefined);
    return;
  }
  const path = DIRECT[prop];
  if (path) {
    set(item, path, value);
  } else {
    set(item, `properties.${prop}`, value);
  }
}

export function fromJcr(template) {
  const item = {};
  Object.entries(template || {}).forEach(([prop, value]) => {
    if (prop.startsWith('sling:') || prop === 'jcr:primaryType') return;
    setJcrProp(item, prop, value);
  });
  return item;
}
