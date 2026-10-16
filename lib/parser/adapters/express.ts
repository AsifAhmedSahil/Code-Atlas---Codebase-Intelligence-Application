import type { AdapterFile, AdapterRoute, FrameworkAdapter } from "../framework";

// Express. Nothing in the syntax turns a file into a route: an Express app
// assembles its routes at run time from routers, variables and middleware
// chains, so no route can be recovered exactly and this adapter claims none. An
// Express repository gets roles and an empty route table.
//
// What an Express codebase does have is a folder layout: it is conventionally
// split by what each file is, and the folder name says which. Singular and
// plural are both accepted, because real repositories use both.

// Directory names that name a role. A segment has to match the whole name, so
// `src/controllers` is a controller directory while `src/old-controllers` is not.
const ROLE_BY_SEGMENT: Record<string, string> = {
  controller: "controller",
  controllers: "controller",
  route: "route",
  routes: "route",
  middleware: "middleware",
  middlewares: "middleware",
  service: "service",
  services: "service",
  repository: "repository",
  repositories: "repository",
  model: "model",
  models: "model",
  config: "config",
  configs: "config",
};

export const expressAdapter: FrameworkAdapter = {
  name: "express",

  detect(context) {
    return context.packages.has("express");
  },

  role(file: AdapterFile): string | null {
    // Every directory above the file is a candidate, nearest the repository
    // root first, so `src/controllers/admin/users.js` is a controller and a
    // `controllers` segment nested anywhere still names the role.
    const segments = file.path.split("/");
    segments.pop();
    for (const segment of segments) {
      const role = ROLE_BY_SEGMENT[segment.toLowerCase()];
      if (role) return role;
    }
    return null;
  },

  routes(): AdapterRoute[] {
    return [];
  },
};
