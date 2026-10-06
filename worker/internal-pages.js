// ============================================================
// Cintelis Workspace — Internal pages (staff only)
// ------------------------------------------------------------
// Business pages (the quoting calculator, the build margin dashboard) used to sit in public/, which made them
// readable by anyone at projects.cintelis.ai. They now live in
// internal-pages/, are bundled into the Worker as text, and are served only
// to signed-in Cintelis staff.
//
// The app keeps its session token in localStorage, so a plain navigation
// (a doc link, an <iframe>) carries no credentials. The flow is:
//   1. GET /internal/:name           → a stub page with no content. Its script
//                                      reads the token and asks for a ticket.
//   2. GET /api/internal-pages/:name/ticket (Bearer) → { url } with a
//                                      single-use ticket valid for 60 s.
//   3. GET /internal/:name?ticket=…  → the real page, served as a normal load.
// A used or expired ticket (say, on reload) gets the stub again, which simply
// fetches a new one. Old /<name>.html links 301 to /internal/<name>.
// ============================================================

// (This public snapshot ships placeholder pages in place of the real ones.)
import quotingCalculator from '../internal-pages/quoting-calculator.html';
import buildMargin from '../internal-pages/build-margin.html';
import { isCustomerUser } from './customers.js';

const PAGES = {
  'quoting-calculator': quotingCalculator,
  'build-margin': buildMargin,
};
const TICKET_TTL_SECONDS = 60;

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const PRIVATE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

const STUB = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Cintelis Workspace</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#6B778C;padding:24px;margin:0}</style></head>
<body><p id="m">Loading…</p><script>
(async function () {
  var m = document.getElementById('m');
  var name = location.pathname.split('/').filter(Boolean).pop();
  var token = null;
  try { token = localStorage.getItem('token'); } catch (e) {}
  if (!token) { m.innerHTML = 'Sign in to <a href="/">Cintelis Workspace</a> first, then open this page again.'; return; }
  try {
    var r = await fetch('/api/internal-pages/' + encodeURIComponent(name) + '/ticket', { headers: { Authorization: 'Bearer ' + token } });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.url) { m.textContent = r.status === 401 ? 'Your session has expired. Sign in again.' : (j.error || 'You do not have access to this page.'); return; }
    location.replace(j.url);
  } catch (e) { m.textContent = 'Could not load this page.'; }
})();
</script></body></html>`;

// Pre-auth: /internal/:name and the legacy /<name>.html paths. Returns null
// when the path is not one of ours.
export async function handleInternalPage(env, url) {
  const legacy = url.pathname.match(/^\/([a-z-]+)\.html$/);
  if (legacy && PAGES[legacy[1]]) {
    return Response.redirect(`${url.origin}/internal/${legacy[1]}`, 301);
  }
  const m = url.pathname.match(/^\/internal\/([a-z-]+)\/?$/);
  if (!m) return null;
  const name = m[1];
  if (!PAGES[name]) return new Response('Not found', { status: 404 });

  const ticket = url.searchParams.get('ticket');
  if (ticket && /^[0-9a-f]{32}$/.test(ticket)) {
    const key = `internal_page_ticket:${ticket}`;
    const stored = await env.KV.get(key);
    if (stored) {
      await env.KV.delete(key);
      if (stored === name) return new Response(PAGES[name], { headers: PRIVATE_HEADERS });
    }
  }
  return new Response(STUB, { headers: PRIVATE_HEADERS });
}

// GET /api/internal-pages/:name/ticket — behind requireAuth (GET so read-only
// viewers, who may not POST, can open the pages too). Customer users
// are already refused by enforceCustomerScope (not on its allowlist); the
// check here keeps that true if the allowlist ever widens.
export async function issueTicket(env, ctx, name) {
  if (isCustomerUser(ctx)) return jres({ error: 'Forbidden' }, 403);
  if (!PAGES[name]) return jres({ error: 'Not found' }, 404);
  const ticket = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`internal_page_ticket:${ticket}`, name, { expirationTtl: TICKET_TTL_SECONDS });
  return jres({ url: `/internal/${name}?ticket=${ticket}` });
}
