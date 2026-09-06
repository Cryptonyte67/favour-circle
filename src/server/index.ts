import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { createApi } from './api.js';
import { createPages } from './pages.js';
import { JsonStore } from './store.js';

const PORT = Number(process.env.PORT || 8787);

/**
 * Public origin this app is served from. The Nimiq Pay deeplink is built from
 * it, so it must be the real HTTPS host in production.
 */
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const store = new JsonStore(process.env.DATA_FILE || 'data/chore-circle.json');

const app = new Hono();

app.route('/api', createApi(store));
app.route('/', createPages(store, APP_URL));

app.get('/healthz', (c) => c.json({ ok: true }));

// In production the built client is served from the same origin, which keeps
// the mini app on a single HTTPS host with no CORS to configure.
const clientDir = 'dist/web';
if (existsSync(clientDir)) {
  app.use('/*', serveStatic({ root: clientDir }));
  app.get('/*', serveStatic({ path: `${clientDir}/index.html` }));
} else {
  app.get('/', (c) =>
    c.text('API is up. Run "npm run dev:web" for the client, or "npm run build" first.'),
  );
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[chore-circle] listening on http://localhost:${info.port}`);
  console.log(`[chore-circle] public origin: ${APP_URL}`);

  // Nimiq Pay deeplinks are built from APP_URL. Left as localhost they are
  // syntactically fine and completely useless on a phone, which is a confusing
  // way to lose an afternoon.
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(APP_URL)) {
    console.warn(
      [
        '[chore-circle] APP_URL is localhost, so invite links and Nimiq Pay',
        '               deeplinks will not work off this machine. To test on a',
        '               phone, expose the app over HTTPS and restart with',
        '               APP_URL set to that public origin.',
      ].join('\n'),
    );
  }
});
