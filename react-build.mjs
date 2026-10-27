// esbuild options for the pinned React production builds in third_party/.
import { join } from "node:path";

export function reactBuildOptions(root) {
  const tp = join(root, "third_party");
  return {
    alias: {
      react: join(tp, "react/cjs/react.production.js"),
      "react/jsx-runtime": join(tp, "react/cjs/react-jsx-runtime.production.js"),
      "react-dom": join(tp, "react-dom/cjs/react-dom.production.js"),
      "react-dom/client": join(tp, "react-dom/cjs/react-dom-client.production.js"),
      scheduler: join(tp, "scheduler/cjs/scheduler.production.js"),
    },
    jsx: "automatic",
  };
}
