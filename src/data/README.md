# Model colour data

`model-colors.json` retains the source archive's physical paint, material,
terrain and export colour values, indexed by their RGB identity. These values
belong to model geometry and saved/exported content. They are independent of the
interface theme: choosing a dark interface must not repaint a user's model.
Interface surfaces, statuses and actions use the host CSS variables and shared
`mcp/tokens/ai-status.json` instead.
