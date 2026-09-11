import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// No build-time variables are required: the dashboard talks to the API on its
// own origin unless VITE_API_BASE_URL says otherwise (see src/config/env.ts),
// which is what lets one prebuilt image serve any self-hosted domain.
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks cache independently of app code. One rule
        // decides the split: React and every library that imports React share
        // a chunk. Splitting them looked tidy but broke the first production
        // deploy with "Cannot read properties of undefined (reading
        // 'useLayoutEffect')": Radix's own dependencies (react-remove-scroll,
        // floating-ui's bindings) landed in a chunk that evaluated before the
        // React chunk had run. Only React-free libraries are split out.
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]chart\.js[\\/]/.test(id)) return "charts";
          if (/[\\/](simple-icons|@browser-logos)[\\/]/.test(id)) return "icons";
          return "vendor";
        },
      },
    },
  },
});
