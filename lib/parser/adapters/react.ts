import type { AdapterFile, AdapterRoute, FrameworkAdapter } from "../framework";

// React on its own. There is no convention that reaches a file without an
// import — a component is imported by whatever renders it — so nothing here is
// an entry point and no route exists to recover. All this adapter offers is two
// role names read off the filename: a `use*` module is a hook, and a `.tsx` or
// `.jsx` module is a component.

const HOOK_NAME = /^use[A-Z0-9]/;
const COMPONENT_FILE = /\.(tsx|jsx)$/;
const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;

export const reactAdapter: FrameworkAdapter = {
  name: "react",

  detect(context) {
    return context.packages.has("react");
  },

  role(file: AdapterFile): string | null {
    const name = file.path.split("/").pop() ?? file.path;
    const base = name.replace(/\.[^./]+$/, "");
    if (SOURCE_FILE.test(file.path) && HOOK_NAME.test(base)) return "hook";
    if (COMPONENT_FILE.test(file.path)) return "component";
    return null;
  },

  routes(): AdapterRoute[] {
    return [];
  },
};
