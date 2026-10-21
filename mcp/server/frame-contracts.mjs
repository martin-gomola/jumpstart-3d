import { framePlanSchema } from "../shared/frame-schema.mjs";

const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 1, maxLength: 120 };
export const frameTools = [{
  name: 'jumpstart_preview_frame', title: 'Preview a rectangular spacer frame',
  description: 'Preview an editable open rectangular frame in millimeters. Width/depth/height are supplied dimensions; omitted wall defaults to 5 mm and is labelled assumed. Requires an opening of at least 1 mm on each axis. Fit remains unverified. Apply the resulting previewId through the existing transaction tool.',
  inputSchema: obj({ editorId: id, expectedRevision: id, includeImage: { type: 'boolean' }, plan: framePlanSchema }, ['expectedRevision', 'plan']),
}];
