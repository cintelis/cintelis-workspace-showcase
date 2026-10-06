// Canonical public origin of the deployed app. Every absolute link the Worker
// emits (emails, PDF footers, OAuth redirect URIs) is built
// from this so a domain move is a one-line change here plus the Cloudflare
// custom-domain binding.
export const PUBLIC_BASE_URL = 'https://projects.cintelis.ai';
export const PUBLIC_HOST = new URL(PUBLIC_BASE_URL).hostname;

// The public API host. Serves only /v1/* (mapped onto the /api/v1/* handlers
// in worker.js) — no SPA, no session endpoints — so customer integrations get
// a stable contract that can later move to its own Worker without a URL change.
export const API_BASE_URL = 'https://api.cintelis.ai';
export const API_HOST = new URL(API_BASE_URL).hostname;

// Hostnames that used to serve the app. Requests arriving on these are
// 301-redirected to PUBLIC_BASE_URL (path + query preserved). Empty: the app
// is served only on cintelis.ai. A host listed here must also be bound as a
// custom domain (routes in wrangler.toml) or the redirect never runs.
export const LEGACY_HOSTS = [];
