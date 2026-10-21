const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 1, maxLength: 120 };
const dimension = maximum => ({ type: 'number', minimum: 0.1, maximum });
export const framePlanSchema = obj({
  name: { type: 'string', minLength: 1, maxLength: 80 },
  modelId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$', minLength: 1, maxLength: 80 },
  outerWidth: dimension(500), outerDepth: dimension(500), height: dimension(100), wall: dimension(249.5),
  assumptions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 240 } },
}, ['outerWidth', 'outerDepth', 'height']);
export const frameTools = [{
  name: 'jumpstart_preview_frame', title: 'Preview a rectangular spacer frame',
  description: 'Preview an editable open rectangular frame in millimeters. Width/depth/height are supplied dimensions; omitted wall defaults to 5 mm and is labelled assumed. Requires an opening of at least 1 mm on each axis. Fit remains unverified. Apply the resulting previewId through the existing transaction tool.',
  inputSchema: obj({ editorId: id, expectedRevision: id, includeImage: { type: 'boolean' }, plan: framePlanSchema }, ['expectedRevision', 'plan']),
}];
