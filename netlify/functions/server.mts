// Netlify Function wrapping the TanStack Start SSR entry built into dist/server.
// All non-static requests are routed here via netlify.toml.
import type { Context } from "@netlify/functions";

// Import the built SSR entry. Netlify bundles the function with esbuild and
// follows this relative import, pulling the dist/server output into the bundle.
// @ts-expect-error - generated at build time
import handler from "../../dist/server/index.js";

export default async (request: Request, _context: Context): Promise<Response> => {
  return await (handler as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(
    request,
    {},
    {},
  );
};

export const config = {
  path: "/*",
  preferStatic: true,
};
