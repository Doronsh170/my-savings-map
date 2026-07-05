// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// GitHub Pages serves the site from a sub-path (https://<user>.github.io/<repo>/)
// and can only host static files, so the Pages build (GITHUB_PAGES=true) needs a
// matching base + router basepath and a fully prerendered static output.
// Local dev and Lovable builds are unaffected.
const githubPages = process.env.GITHUB_PAGES === "true";
const base = process.env.GITHUB_PAGES_BASE ?? "/my-savings-map/";

export default defineConfig(
  githubPages
    ? {
        // preview.host keeps the prerender preview server on IPv4 — some CI
        // containers have no IPv6 and the default host fails with EAFNOSUPPORT.
        vite: { base, preview: { host: "127.0.0.1" } },
        tanstackStart: {
          router: { basepath: base.replace(/\/$/, "") },
          prerender: {
            enabled: true,
            crawlLinks: true,
            autoSubfolderIndex: true,
          },
        },
        nitro: false,
      }
    : {},
);
