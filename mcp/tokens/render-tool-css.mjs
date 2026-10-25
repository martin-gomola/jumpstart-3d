import tokens from "./ai-status.json" with { type: "json" };
// Custom properties cannot be used in media-query conditions. Resolve only those
// conditions at build time; ordinary declarations retain live theme variables.
export function renderToolCss(css) {
  return css.replace(/@media([^{}]+)/g, condition => condition.replace(/var\(--ai-status-([\w]+)\)/g, (_, name) => {
    if (!tokens[name]) throw new Error(`Unknown tool media token: ${name}`);
    return tokens[name].$value;
  }));
}
