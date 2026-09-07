/**
 * Cloudflare Worker entry point.
 *
 * The built client is served by the platform's static-asset handler; this
 * Worker owns the API, the public preview pages, the capability probe and the
 * help guide. Those paths are listed in `run_worker_first` in wrangler.toml,
 * so keep the two in step — a route added here but not there will be shadowed
 * by the asset handler's SPA fallback and silently return index.html.
 */

import { Hono } from 'hono';
import { createApi, type Env } from './api.js';
import { createDocs } from './docs.js';
import { createPages } from './pages.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));
app.route('/api', createApi());
app.route('/', createDocs());
app.route('/', createPages());

// The Worker is only reached for the paths listed in run_worker_first, so an
// unmatched request here is a real 404 — not a client-side route. The asset
// handler does SPA fallback for everything else. Serving the app shell from
// here instead made dead invite links return 200, which the smoke test caught.
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
