import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: false,
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      // Anchored with a trailing slash on purpose. A bare '/api' key is a
      // prefix match, so it also swallows '/api.ts' — the client module in
      // src/web — and proxies it to the backend, which answers with HTML. The
      // page then dies on a MIME type error with every request showing 200.
      // Invisible in production, where that file is bundled and never fetched.
      '^/api/': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
      // The public preview pages (/t/:id, /join/:code) and the capability probe
      // (/diag) are server-rendered by the backend. Without these, an invite
      // link opened during development hits Vite's SPA fallback and silently
      // loads the app instead of the page you are trying to test.
      '^/(t|join)/': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
      '^/(help|terms)': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
      '^/(diag|open)': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
});
