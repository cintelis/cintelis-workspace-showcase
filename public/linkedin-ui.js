// ============================================================
// Cintelis Workspace — LinkedIn Ad Library UI
// Loaded as a regular <script> tag after app.js; uses state, api(),
// esc(), isAdmin(), toast helpers, and nav() from app.js.
//
// Two search modes against the worker proxy (/api/linkedin/*):
//   - Ads               -> /api/linkedin/ads
//   - Brand Partnerships -> /api/linkedin/brand-partnerships
// A shared admin OAuth connection is required first (admin-only Connect).
// ============================================================

(function () {
  state.linkedin = state.linkedin || {
    status: null,
    tab: 'ads',
    ads:   { results: null, start: 0, count: 12, total: null, lastQuery: null, loading: false },
    brand: { results: null, start: 0, count: 10, total: null, lastQuery: null, loading: false },
    posts: { items: null, loading: false },
    analytics: { snapshots: null, loading: false },
    comments: { items: null, loading: false },
  };
})();

function liIsAdmin() { return state.me && state.me.role === 'admin'; }
// Connect/disconnect (token management) is admin-only; posting/managing posts,
// analytics refresh, and comment replies are open to any logged-in user.
function liCanPost() { return !!(state && state.me); }

// ── Section entry points ─────────────────────────────────────
// "LinkedIn Ads" (Ad Library) and "LinkedIn Posts" (Community Management) are
// two separate Tools pages backed by two independent connections.
async function loadLinkedInStatus() {
  const status = await api('GET', '/api/linkedin/status');
  state.linkedin.status = status || { connected: false };
  return state.linkedin.status;
}

async function renderLinkedInAdLibrarySection() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading…</p></div></div>';
  await loadLinkedInStatus();
  if (!['ads', 'brand'].includes(state.linkedin.tab)) state.linkedin.tab = 'ads';
  renderAdsShell();
}
window.renderLinkedInAdLibrarySection = renderLinkedInAdLibrarySection;

async function renderLinkedInPostsSection() {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading…</p></div></div>';
  state.linkedin.compose = null; // fresh entry: drop any stale staged attachment
  await loadLinkedInStatus();
  if (!['publish', 'analytics', 'comments'].includes(state.linkedin.tab)) state.linkedin.tab = 'publish';
  renderPostsShell();
}
window.renderLinkedInPostsSection = renderLinkedInPostsSection;

// ── Shared shell helpers ─────────────────────────────────────
function liStatusLine(label, conn) {
  if (!conn || !conn.connected) return `${label}: not connected`;
  const s = conn.expired ? '<span style="color:var(--red);font-weight:600">expired — reconnect</span>' : 'connected';
  return `${label}: ${s}${conn.connected_by_email ? ' · ' + esc(conn.connected_by_email) : ''}`;
}
function liAdminBtns(purpose, conn) {
  if (!liIsAdmin()) return '';
  const connected = conn && conn.connected;
  return `<button class="btn btn-ghost btn-sm" type="button" onclick="linkedinConnect('${purpose}')">${connected ? 'Reconnect' : 'Connect'}</button>
    ${connected ? `<button class="btn btn-ghost btn-sm" style="color:var(--red)" type="button" onclick="linkedinDisconnect('${purpose}')">Disconnect</button>` : ''}`;
}
function liConnectCard(title, blurb, purpose, btnLabel) {
  return `<div class="page-section"><div class="card"><div class="card-body" style="text-align:center;padding:40px 24px">
    <h3 style="margin:0 0 8px">${esc(title)}</h3>
    <p style="color:var(--muted,#6B778C);max-width:560px;margin:0 auto 20px">${blurb}</p>
    ${liIsAdmin() ? `<button class="btn btn-primary" type="button" onclick="linkedinConnect('${purpose}')">${esc(btnLabel)}</button>` : ''}
  </div></div></div>`;
}

// ── "LinkedIn Ads" shell (Ad Library) ────────────────────────
function renderAdsShell() {
  const c = document.getElementById('content');
  const st = state.linkedin.status || {};
  if (!st.connected) {
    c.innerHTML = liConnectCard('LinkedIn Ads',
      `Search LinkedIn's Ad Library for ad creatives and Brand Partnership posts. ${liIsAdmin() ? 'Connect once for the whole team.' : 'An admin needs to connect first.'}`,
      'adlib', 'Connect Ad Library');
    return;
  }
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:13px;color:var(--muted,#6B778C)">${liStatusLine('Ad Library', st)}</div>
        <div style="display:flex;gap:8px">${liAdminBtns('adlib', st)}</div>
      </div></div>
      <div class="tabs" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn ${state.linkedin.tab === 'ads' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="linkedinSetTab('ads')">Ads</button>
        <button class="btn ${state.linkedin.tab === 'brand' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="linkedinSetTab('brand')">Brand Partnerships</button>
      </div>
      <div id="li-panel"></div>
    </div>`;
  renderLinkedInPanel();
}

// ── "LinkedIn Posts" shell (Community Management) ─────────────
function renderPostsShell() {
  const c = document.getElementById('content');
  const cm = (state.linkedin.status || {}).cmapi || {};
  if (!cm.connected) {
    c.innerHTML = liConnectCard('LinkedIn Posts',
      `Publish to the company page, track analytics, and manage comments. ${liIsAdmin() ? 'Connect once as a page admin.' : 'An admin needs to connect first.'}`,
      'cmapi', 'Connect Community Management');
    return;
  }
  const canManage = !!cm.canManage;
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:13px;color:var(--muted,#6B778C)">${liStatusLine('Community Management', cm)}${cm.org_id ? ' · org ' + esc(cm.org_id) : ''}</div>
        <div style="display:flex;gap:8px">${liAdminBtns('cmapi', cm)}</div>
      </div></div>
      ${!canManage ? `<div class="card"><div class="card-body" style="font-size:13px;color:var(--muted,#6B778C)">
        Connected, but this token is missing the publishing scopes. ${liIsAdmin() ? 'Reconnect as a page admin to enable Publish, Analytics, and Comments.' : 'An admin needs to reconnect as a page admin.'}
      </div></div>` : `
      <div class="tabs" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn ${state.linkedin.tab === 'publish' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="linkedinSetTab('publish')">Publish</button>
        <button class="btn ${state.linkedin.tab === 'analytics' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="linkedinSetTab('analytics')">Analytics</button>
        <button class="btn ${state.linkedin.tab === 'comments' ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="linkedinSetTab('comments')">Comments</button>
      </div>
      <div id="li-panel"></div>`}
    </div>`;
  if (canManage) renderLinkedInPanel();
}

function linkedinSetTab(tab) {
  state.linkedin.tab = tab;
  if (tab === 'ads' || tab === 'brand') renderAdsShell();
  else renderPostsShell();
}
window.linkedinSetTab = linkedinSetTab;

function renderLinkedInPanel() {
  const panel = document.getElementById('li-panel');
  if (!panel) return;
  const tab = state.linkedin.tab;
  if (tab === 'publish')   { renderPublishTab(panel);   return; }
  if (tab === 'analytics') { renderAnalyticsTab(panel); return; }
  if (tab === 'comments')  { renderCommentsTab(panel);  return; }
  panel.innerHTML = tab === 'ads' ? adsFormHtml() : brandFormHtml();
  if (tab === 'ads') renderAdsResults();
  else renderBrandResults();
}

// ── Connect / disconnect ─────────────────────────────────────
async function linkedinConnect(purpose) {
  purpose = purpose || 'adlib';
  const r = await api('GET', '/api/linkedin/connect?purpose=' + encodeURIComponent(purpose));
  if (!r || r.error || !r.authorizeUrl) {
    toastError((r && r.error) || 'Could not start LinkedIn connection.');
    return;
  }
  // Open the OAuth flow in a popup; the callback page reloads this window.
  window.open(r.authorizeUrl, 'linkedin_oauth', 'width=600,height=720');
}
window.linkedinConnect = linkedinConnect;

async function linkedinDisconnect(purpose) {
  purpose = purpose || 'adlib';
  const label = purpose === 'cmapi' ? 'Community Management' : 'Ad Library';
  if (!(await appConfirm('Disconnect ' + label + '? It will be disabled until someone reconnects.'))) return;
  const r = await api('POST', '/api/linkedin/disconnect?purpose=' + encodeURIComponent(purpose));
  if (r && r.error) { toastError(r.error); return; }
  toastSuccess(label + ' disconnected.');
  if (purpose === 'cmapi') renderLinkedInPostsSection();
  else renderLinkedInAdLibrarySection();
}
window.linkedinDisconnect = linkedinDisconnect;

// ── Ads ──────────────────────────────────────────────────────
function adsFormHtml() {
  return `
    <div class="card" style="margin-bottom:14px"><div class="card-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <label style="font-size:12px;color:var(--muted,#6B778C)">Keyword
          <input id="li-ads-keyword" type="text" placeholder="e.g. health technology"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">Advertiser
          <input id="li-ads-advertiser" type="text" placeholder="e.g. LinkedIn"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">Payer
          <input id="li-ads-payer" type="text" placeholder="e.g. FixDex Inc."></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">Countries (ISO-2, comma-sep)
          <input id="li-ads-countries" type="text" placeholder="e.g. US, GB"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">From
          <input id="li-ads-from" type="date"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">To
          <input id="li-ads-to" type="date"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">Sort
          <select id="li-ads-sort">
            <option value="DESCENDING">Newest first</option>
            <option value="ASCENDING">Oldest first</option>
          </select></label>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" type="button" onclick="linkedinRunAds(true)">Search ads</button>
        <span id="li-ads-msg" style="font-size:12px;color:var(--muted,#6B778C)"></span>
      </div>
    </div></div>
    <div id="li-ads-results"></div>`;
}

async function linkedinRunAds(reset) {
  const a = state.linkedin.ads;
  if (reset) { a.start = 0; a.lastQuery = readAdsForm(); }
  const q = a.lastQuery || readAdsForm();
  const params = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set('start', String(a.start));
  params.set('count', String(a.count));

  a.loading = true; setMsg('li-ads-msg', 'Searching…');
  const r = await api('GET', '/api/linkedin/ads?' + params.toString());
  a.loading = false;
  if (r && r.error) { a.results = null; setMsg('li-ads-msg', liErrorText(r.error)); renderAdsResults(); return; }
  a.results = Array.isArray(r?.elements) ? r.elements : [];
  a.total = r?.paging?.total != null ? r.paging.total : null;
  setMsg('li-ads-msg', `${a.results.length} result${a.results.length === 1 ? '' : 's'}${a.total != null ? ' of ' + a.total : ''}`);
  renderAdsResults();
}
window.linkedinRunAds = linkedinRunAds;

function readAdsForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  return {
    keyword: g('li-ads-keyword'),
    advertiser: g('li-ads-advertiser'),
    payerName: g('li-ads-payer'),
    countries: g('li-ads-countries'),
    dateStart: g('li-ads-from'),
    dateEnd: g('li-ads-to'),
    sort: document.getElementById('li-ads-sort')?.value || 'DESCENDING',
  };
}

function renderAdsResults() {
  const box = document.getElementById('li-ads-results');
  if (!box) return;
  const a = state.linkedin.ads;
  if (a.results == null) { box.innerHTML = ''; return; }
  if (!a.results.length) {
    box.innerHTML = '<div class="empty"><p>No ads found for those filters.</p></div>';
    return;
  }
  box.innerHTML = a.results.map(adCardHtml).join('') + adsPagerHtml();
}

function adCardHtml(el) {
  const d = el.details || {};
  const adv = d.advertiser || {};
  const stats = d.adStatistics || {};
  const imp = stats.totalImpressions || {};
  const impText = (imp.from != null || imp.to != null)
    ? `${fmtNum(imp.from)}–${imp.to === 0 ? '1M+' : fmtNum(imp.to)} impressions`
    : '';
  const targeting = Array.isArray(d.adTargeting)
    ? d.adTargeting.slice(0, 6).map(t => `<span class="badge" style="background:#eef;color:#334;border-radius:10px;padding:2px 8px;font-size:11px;margin:2px">${esc(t.facetName || '')}${t.includedSegments?.length ? ': ' + esc(t.includedSegments.slice(0, 2).join(', ')) : ''}</span>`).join('')
    : '';
  return `
    <div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:600">
            ${adv.advertiserUrl ? `<a href="${esc(adv.advertiserUrl)}" target="_blank" rel="noopener">${esc(adv.advertiserName || 'Unknown advertiser')}</a>` : esc(adv.advertiserName || 'Unknown advertiser')}
          </div>
          <div style="font-size:12px;color:var(--muted,#6B778C);margin-top:2px">
            ${d.type ? esc(d.type) : ''}${adv.adPayer ? ' · Paid by ' + esc(adv.adPayer) : ''}
          </div>
        </div>
        <div style="text-align:right">
          ${el.isRestricted ? '<span class="badge" style="background:#fdecea;color:#c9372c;border-radius:10px;padding:2px 8px;font-size:11px">Restricted</span>' : ''}
          ${el.adUrl ? `<div style="margin-top:6px"><a class="btn btn-ghost btn-sm" href="${esc(el.adUrl)}" target="_blank" rel="noopener">View on LinkedIn</a></div>` : ''}
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted,#6B778C);margin-top:8px">
        ${impText ? esc(impText) : ''}
        ${stats.firstImpressionAt ? ' · First: ' + fmtLinkedInDate(stats.firstImpressionAt) : ''}
        ${stats.latestImpressionAt ? ' · Last: ' + fmtLinkedInDate(stats.latestImpressionAt) : ''}
      </div>
      ${targeting ? `<div style="margin-top:8px">${targeting}</div>` : ''}
      ${el.isRestricted && el.restrictionDetails ? `<div style="font-size:12px;color:#c9372c;margin-top:8px">${esc(el.restrictionDetails)}</div>` : ''}
    </div></div>`;
}

function adsPagerHtml() {
  const a = state.linkedin.ads;
  const prevDisabled = a.start <= 0 ? 'disabled' : '';
  const nextDisabled = (a.results && a.results.length < a.count) ? 'disabled' : '';
  return `<div style="display:flex;gap:8px;justify-content:center;margin:12px 0">
    <button class="btn btn-ghost btn-sm" type="button" ${prevDisabled} onclick="linkedinAdsPage(-1)">← Prev</button>
    <button class="btn btn-ghost btn-sm" type="button" ${nextDisabled} onclick="linkedinAdsPage(1)">Next →</button>
  </div>`;
}

function linkedinAdsPage(dir) {
  const a = state.linkedin.ads;
  a.start = Math.max(0, a.start + dir * a.count);
  linkedinRunAds(false);
}
window.linkedinAdsPage = linkedinAdsPage;

// ── Brand Partnerships ───────────────────────────────────────
function brandFormHtml() {
  return `
    <div class="card" style="margin-bottom:14px"><div class="card-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <label style="font-size:12px;color:var(--muted,#6B778C)">Keyword (required)
          <input id="li-bp-keyword" type="text" placeholder="e.g. dentist"></label>
        <label style="font-size:12px;color:var(--muted,#6B778C)">Date range
          <select id="li-bp-range">
            <option value="">Any (up to 1 year)</option>
            <option value="PAST_24H">Past 24 hours</option>
            <option value="PAST_WEEK">Past week</option>
            <option value="PAST_MONTH">Past month</option>
          </select></label>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" type="button" onclick="linkedinRunBrand(true)">Search posts</button>
        <span id="li-bp-msg" style="font-size:12px;color:var(--muted,#6B778C)"></span>
      </div>
    </div></div>
    <div id="li-bp-results"></div>`;
}

async function linkedinRunBrand(reset) {
  const b = state.linkedin.brand;
  const keyword = (document.getElementById('li-bp-keyword')?.value || '').trim();
  if (!keyword) { setMsg('li-bp-msg', 'Enter a keyword to search.'); return; }
  if (reset) { b.start = 0; b.lastQuery = { keyword, dateRange: document.getElementById('li-bp-range')?.value || '' }; }
  const q = b.lastQuery || { keyword, dateRange: '' };

  const params = new URLSearchParams();
  params.set('keyword', q.keyword);
  if (q.dateRange) params.set('dateRange', q.dateRange);
  params.set('start', String(b.start));
  params.set('count', String(b.count));

  setMsg('li-bp-msg', 'Searching…');
  const r = await api('GET', '/api/linkedin/brand-partnerships?' + params.toString());
  if (r && r.error) { b.results = null; setMsg('li-bp-msg', liErrorText(r.error)); renderBrandResults(); return; }
  b.results = Array.isArray(r?.elements) ? r.elements : [];
  b.total = r?.paging?.total != null ? r.paging.total : null;
  setMsg('li-bp-msg', `${b.results.length} post${b.results.length === 1 ? '' : 's'}${b.total != null ? ' of ' + b.total : ''}`);
  renderBrandResults();
}
window.linkedinRunBrand = linkedinRunBrand;

function renderBrandResults() {
  const box = document.getElementById('li-bp-results');
  if (!box) return;
  const b = state.linkedin.brand;
  if (b.results == null) { box.innerHTML = ''; return; }
  if (!b.results.length) { box.innerHTML = '<div class="empty"><p>No brand-partnership posts found.</p></div>'; return; }
  const list = b.results.map(el => `
    <div class="card" style="margin-bottom:8px"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div style="font-size:13px;word-break:break-all">${esc(el.postUrl || '')}</div>
      ${el.postUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(el.postUrl)}" target="_blank" rel="noopener">Open post</a>` : ''}
    </div></div>`).join('');
  const prevDisabled = b.start <= 0 ? 'disabled' : '';
  const nextDisabled = (b.total != null && b.start + b.count >= b.total) || (b.results.length < b.count) ? 'disabled' : '';
  box.innerHTML = list + `<div style="display:flex;gap:8px;justify-content:center;margin:12px 0">
    <button class="btn btn-ghost btn-sm" type="button" ${prevDisabled} onclick="linkedinBrandPage(-1)">← Prev</button>
    <button class="btn btn-ghost btn-sm" type="button" ${nextDisabled} onclick="linkedinBrandPage(1)">Next →</button>
  </div>`;
}

function linkedinBrandPage(dir) {
  const b = state.linkedin.brand;
  b.start = Math.max(0, b.start + dir * b.count);
  linkedinRunBrand(false);
}
window.linkedinBrandPage = linkedinBrandPage;

// ── Small helpers ────────────────────────────────────────────
function setMsg(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function fmtNum(n) { return n == null ? '' : Number(n).toLocaleString(); }
function fmtLinkedInDate(ms) { try { return new Date(Number(ms)).toLocaleDateString(); } catch { return ''; } }
function liErrorText(code) {
  switch (code) {
    case 'not_connected': return 'LinkedIn is not connected.';
    case 'reconnect_required': return 'The LinkedIn connection expired — an admin needs to reconnect.';
    case 'keyword_required': return 'Enter a keyword to search.';
    case 'linkedin_error': return 'LinkedIn rejected the request. Check filters and try again.';
    case 'upstream_error': return 'Could not reach LinkedIn. Try again shortly.';
    case 'body_required': return 'Enter some post text.';
    case 'post_and_message_required': return 'A reply needs a message.';
    case 'org_not_found': return 'Could not resolve the company page. Check the org vanity name.';
    case 'org_lookup_failed': return 'Could not look up the company page on LinkedIn.';
    case 'publish_failed': return 'LinkedIn rejected the post.';
    case 'reply_failed': return 'LinkedIn rejected the reply.';
    case 'already_published': return 'That post is already published.';
    case 'file_too_large': return 'File too large (docs ≤100MB, images ≤40MB).';
    case 'empty_file': return 'That file is empty.';
    case 'bad_type': return 'Unsupported file type.';
    case 'init_failed': case 'init_no_url': return 'LinkedIn rejected the upload request.';
    case 'upload_failed': case 'upload_rejected': return 'The file upload to LinkedIn failed.';
    default: return typeof code === 'string' ? code : 'Request failed.';
  }
}
function fmtDateTime(v) { try { return new Date(v).toLocaleString(); } catch { return String(v || ''); } }
// urn:li:share:123 / urn:li:ugcPost:123 → public feed-update URL
function linkedinPostUrl(urn) { return 'https://www.linkedin.com/feed/update/' + encodeURIComponent(urn) + '/'; }

// ============================================================
// Community Management tabs — Publish, Analytics, Comments
// (only shown when status.canManage; writes are admin-gated server-side too).
// ============================================================

// ── Publish ──────────────────────────────────────────────────
async function renderPublishTab(panel) {
  // Keep any staged attachment across tab switches — it's cleared only on
  // section entry (renderLinkedInPostsSection), on Remove, and after a
  // successful post. Reflect the current attachment in the rendered UI.
  const _m = state.linkedin.compose;
  const _attached = !!(_m && _m.mediaUrn);
  const _attachMsg = _attached ? ((_m.mediaType === 'image' ? '🖼 ' : '📎 ') + (_m.mediaTitle || 'attached')) : '';
  panel.innerHTML = `
    ${liCanPost() ? `<div class="card" style="margin-bottom:14px"><div class="card-body">
      <label style="font-size:12px;color:var(--muted,#6B778C)">Post text
        <textarea id="li-post-body" rows="4" placeholder="What do you want to share from the Totally Wild AI page?" style="width:100%"></textarea></label>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px;color:var(--muted,#6B778C)">Attach image or document
          <input id="li-post-file" type="file" accept="image/png,image/jpeg,image/gif,application/pdf,.pdf,.ppt,.pptx,.doc,.docx" onchange="linkedinUploadMedia(this)"></label>
        <span id="li-post-file-msg" style="font-size:12px;color:var(--muted,#6B778C)">${esc(_attachMsg)}</span>
        <button id="li-post-file-clear" class="btn btn-ghost btn-sm" type="button" style="${_attached ? '' : 'display:none'}" onclick="linkedinClearMedia()">Remove</button>
      </div>
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px;color:var(--muted,#6B778C)">Schedule for (optional)
          <input id="li-post-when" type="datetime-local"></label>
        <button class="btn btn-primary" type="button" onclick="linkedinPublishNow()">Publish now</button>
        <button class="btn btn-ghost" type="button" onclick="linkedinSchedulePost()">Schedule</button>
        <span id="li-post-msg" style="font-size:12px;color:var(--muted,#6B778C)"></span>
      </div>
    </div></div>` : ''}
    <div id="li-posts-list"><div class="empty"><p>Loading…</p></div></div>`;
  await loadLinkedInPosts();
}

async function loadLinkedInPosts() {
  const r = await api('GET', '/api/linkedin/posts');
  state.linkedin.posts.items = (r && r.posts) || [];
  renderLinkedInPostsList();
}

function renderLinkedInPostsList() {
  const box = document.getElementById('li-posts-list');
  if (!box) return;
  const items = state.linkedin.posts.items || [];
  if (!items.length) { box.innerHTML = '<div class="empty"><p>No posts yet.</p></div>'; return; }
  box.innerHTML = items.map(postRowHtml).join('');
}

function liStatusBadge(s) {
  const map = { published: '#0C66E4', scheduled: '#8270DB', draft: '#6B778C', failed: '#c9372c' };
  const color = map[s] || '#6B778C';
  return `<span class="badge" style="background:${color}1a;color:${color};border-radius:10px;padding:2px 8px;font-size:11px">${esc(s)}</span>`;
}

function postRowHtml(p) {
  const when = p.published_at ? 'Published ' + fmtDateTime(p.published_at)
    : p.scheduled_at ? 'Scheduled ' + fmtDateTime(p.scheduled_at)
    : 'Created ' + fmtDateTime(p.created_at);
  const url = p.post_urn ? linkedinPostUrl(p.post_urn) : null;
  const actions = liCanPost() ? `
    ${p.status !== 'published' ? `<button class="btn btn-ghost btn-sm" type="button" onclick="linkedinPublishExisting('${p.id}')">Publish now</button>` : ''}
    <button class="btn btn-ghost btn-sm" style="color:var(--red)" type="button" onclick="linkedinDeletePost('${p.id}')">Delete</button>` : '';
  return `<div class="card" style="margin-bottom:8px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--muted,#6B778C)">${liStatusBadge(p.status)} · ${esc(when)}</div>
      <div style="display:flex;gap:6px">
        ${url ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">View</a>` : ''}
        ${actions}
      </div>
    </div>
    <div style="margin-top:8px;white-space:pre-wrap">${esc(p.body)}</div>
    ${p.media_urn ? `<div style="font-size:12px;color:var(--muted,#6B778C);margin-top:6px">${p.media_type === 'image' ? '🖼' : '📎'} ${esc(p.media_title || (p.media_type === 'image' ? 'image' : 'document'))}</div>` : ''}
    ${p.error ? `<div style="font-size:12px;color:#c9372c;margin-top:6px">${esc(p.error)}</div>` : ''}
  </div></div>`;
}

// Merge any pending media attachment into a post payload.
function liMediaPayload() {
  const m = state.linkedin.compose;
  return (m && m.mediaUrn) ? { mediaType: m.mediaType, mediaUrn: m.mediaUrn, mediaTitle: m.mediaTitle } : {};
}
function liClearComposeForm() {
  const t = document.getElementById('li-post-body'); if (t) t.value = '';
  const w = document.getElementById('li-post-when'); if (w) w.value = '';
  linkedinClearMedia();
}

// Upload the chosen file to LinkedIn (via our worker) and stash the URN.
async function linkedinUploadMedia(input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  const type = /^image\//.test(f.type) ? 'image' : 'document';
  setMsg('li-post-file-msg', 'Uploading ' + f.name + '…');
  try {
    const r = await fetch(API + '/api/linkedin/media?type=' + type + '&filename=' + encodeURIComponent(f.name), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': f.type || 'application/octet-stream' },
      body: f,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      state.linkedin.compose = null;
      setMsg('li-post-file-msg', 'Upload failed: ' + liErrorText(d.error || ('HTTP ' + r.status)));
      return;
    }
    state.linkedin.compose = { mediaType: d.type, mediaUrn: d.urn, mediaTitle: d.title || f.name };
    setMsg('li-post-file-msg', (type === 'image' ? '🖼 ' : '📎 ') + f.name + ' attached');
    const clr = document.getElementById('li-post-file-clear'); if (clr) clr.style.display = '';
  } catch (e) {
    state.linkedin.compose = null;
    setMsg('li-post-file-msg', 'Upload error — try again.');
  }
}
window.linkedinUploadMedia = linkedinUploadMedia;

function linkedinClearMedia() {
  state.linkedin.compose = null;
  const f = document.getElementById('li-post-file'); if (f) f.value = '';
  setMsg('li-post-file-msg', '');
  const clr = document.getElementById('li-post-file-clear'); if (clr) clr.style.display = 'none';
}
window.linkedinClearMedia = linkedinClearMedia;

// True when a file is chosen in the picker but hasn't finished uploading
// (so its URN isn't staged yet) — guards against posting text-only by accident.
function liUploadIncomplete() {
  const f = document.getElementById('li-post-file');
  return !!(f && f.files && f.files.length && !(state.linkedin.compose && state.linkedin.compose.mediaUrn));
}

async function linkedinPublishNow() {
  const body = (document.getElementById('li-post-body')?.value || '').trim();
  const media = liMediaPayload();
  if (liUploadIncomplete()) { setMsg('li-post-msg', 'Attachment is still uploading (or it failed) — wait a moment or click Remove.'); return; }
  if (!body && !media.mediaUrn) { setMsg('li-post-msg', 'Enter some text or attach a file.'); return; }
  setMsg('li-post-msg', 'Publishing…');
  const r = await api('POST', '/api/linkedin/posts', { body, publishNow: true, ...media });
  if (r && r.error) { setMsg('li-post-msg', liErrorText(r.error)); toastError(liErrorText(r.error)); }
  else { setMsg('li-post-msg', 'Published.'); toastSuccess('Posted to LinkedIn.'); liClearComposeForm(); }
  await loadLinkedInPosts();
}
window.linkedinPublishNow = linkedinPublishNow;

async function linkedinSchedulePost() {
  const body = (document.getElementById('li-post-body')?.value || '').trim();
  const when = document.getElementById('li-post-when')?.value || '';
  const media = liMediaPayload();
  if (liUploadIncomplete()) { setMsg('li-post-msg', 'Attachment is still uploading (or it failed) — wait a moment or click Remove.'); return; }
  if (!body && !media.mediaUrn) { setMsg('li-post-msg', 'Enter some text or attach a file.'); return; }
  if (!when) { setMsg('li-post-msg', 'Pick a date/time, or use Publish now.'); return; }
  const scheduledAt = new Date(when).toISOString();
  const r = await api('POST', '/api/linkedin/posts', { body, scheduledAt, ...media });
  if (r && r.error) { toastError(liErrorText(r.error)); }
  else { toastSuccess('Scheduled.'); liClearComposeForm(); }
  await loadLinkedInPosts();
}
window.linkedinSchedulePost = linkedinSchedulePost;

async function linkedinPublishExisting(id) {
  const r = await api('POST', '/api/linkedin/posts/' + encodeURIComponent(id) + '/publish');
  if (r && r.error) toastError(liErrorText(r.error)); else toastSuccess('Published.');
  await loadLinkedInPosts();
}
window.linkedinPublishExisting = linkedinPublishExisting;

async function linkedinDeletePost(id) {
  if (!(await appConfirm('Delete this post? If it was published, it will be removed from LinkedIn too.'))) return;
  const r = await api('DELETE', '/api/linkedin/posts/' + encodeURIComponent(id));
  if (r && r.error) toastError(liErrorText(r.error)); else toastSuccess('Deleted.');
  await loadLinkedInPosts();
}
window.linkedinDeletePost = linkedinDeletePost;

// ── Analytics ────────────────────────────────────────────────
async function renderAnalyticsTab(panel) {
  panel.innerHTML = `
    <div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--muted,#6B778C)">Lifetime page metrics, snapshotted daily.</div>
      ${liCanPost() ? '<button class="btn btn-primary btn-sm" type="button" onclick="linkedinRefreshAnalytics()">Refresh now</button>' : ''}
    </div></div>
    <div id="li-analytics-body"><div class="empty"><p>Loading…</p></div></div>`;
  await loadLinkedInAnalytics();
}

async function loadLinkedInAnalytics() {
  const r = await api('GET', '/api/linkedin/analytics');
  state.linkedin.analytics.snapshots = (r && r.snapshots) || [];
  renderAnalyticsBody();
}

function liMetric(label, val) {
  return `<div class="card" style="flex:1;min-width:130px"><div class="card-body">
    <div style="font-size:22px;font-weight:700">${val == null ? '—' : fmtNum(val)}</div>
    <div style="font-size:12px;color:var(--muted,#6B778C)">${esc(label)}</div>
  </div></div>`;
}

function renderAnalyticsBody() {
  const box = document.getElementById('li-analytics-body');
  if (!box) return;
  const snaps = state.linkedin.analytics.snapshots || [];
  if (!snaps.length) { box.innerHTML = '<div class="empty"><p>No snapshots yet. Click “Refresh now”.</p></div>'; return; }
  const latest = snaps[0];
  const eng = latest.engagement != null ? (Number(latest.engagement) * 100).toFixed(2) + '%' : '—';
  const cards = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    ${liMetric('Followers', latest.follower_count)}
    ${liMetric('Page views', latest.page_views)}
    ${liMetric('Impressions', latest.impression_count)}
    ${liMetric('Clicks', latest.click_count)}
    <div class="card" style="flex:1;min-width:130px"><div class="card-body">
      <div style="font-size:22px;font-weight:700">${eng}</div>
      <div style="font-size:12px;color:var(--muted,#6B778C)">Engagement</div></div></div>
  </div>`;
  const rows = snaps.map(s => `<tr>
    <td>${esc(s.snapshot_date)}</td>
    <td style="text-align:right">${s.follower_count == null ? '—' : fmtNum(s.follower_count)}</td>
    <td style="text-align:right">${s.page_views == null ? '—' : fmtNum(s.page_views)}</td>
    <td style="text-align:right">${s.impression_count == null ? '—' : fmtNum(s.impression_count)}</td>
    <td style="text-align:right">${s.like_count == null ? '—' : fmtNum(s.like_count)}</td>
    <td style="text-align:right">${s.comment_count == null ? '—' : fmtNum(s.comment_count)}</td>
  </tr>`).join('');
  box.innerHTML = cards + `<div class="card"><div class="card-body" style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="text-align:left;color:var(--muted,#6B778C)">
        <th>Date</th><th style="text-align:right">Followers</th><th style="text-align:right">Page views</th>
        <th style="text-align:right">Impressions</th><th style="text-align:right">Likes</th><th style="text-align:right">Comments</th>
      </tr></thead><tbody>${rows}</tbody></table>
  </div></div>`;
}

async function linkedinRefreshAnalytics() {
  const r = await api('POST', '/api/linkedin/analytics/refresh');
  if (r && r.error) toastError(liErrorText(r.error)); else toastSuccess('Analytics refreshed.');
  await loadLinkedInAnalytics();
}
window.linkedinRefreshAnalytics = linkedinRefreshAnalytics;

// ── Comments ─────────────────────────────────────────────────
async function renderCommentsTab(panel) {
  panel.innerHTML = `
    <div class="card" style="margin-bottom:14px"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--muted,#6B778C)">Recent comments on your page's posts.</div>
      ${liCanPost() ? '<button class="btn btn-primary btn-sm" type="button" onclick="linkedinRefreshComments()">Refresh from LinkedIn</button>' : ''}
    </div></div>
    <div id="li-comments-list"><div class="empty"><p>Loading…</p></div></div>`;
  await loadLinkedInComments();
}

async function loadLinkedInComments() {
  const r = await api('GET', '/api/linkedin/comments');
  state.linkedin.comments.items = (r && r.comments) || [];
  renderCommentsList();
}

function renderCommentsList() {
  const box = document.getElementById('li-comments-list');
  if (!box) return;
  const items = state.linkedin.comments.items || [];
  if (!items.length) { box.innerHTML = '<div class="empty"><p>No comments ingested yet. Click “Refresh from LinkedIn”.</p></div>'; return; }
  box.innerHTML = items.map(commentRowHtml).join('');
}

function commentRowHtml(c) {
  const safeId = String(c.comment_urn).replace(/[^a-zA-Z0-9]/g, '');
  const when = c.created_time ? fmtLinkedInDate(c.created_time) : '';
  const replied = c.replied
    ? '<span class="badge" style="background:#0C66E41a;color:#0C66E4;border-radius:10px;padding:2px 8px;font-size:11px">replied</span>'
    : '';
  const replyUi = liCanPost() ? `
    <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
      <input id="li-reply-${safeId}" type="text" placeholder="Reply as the page…" style="flex:1">
      <button class="btn btn-ghost btn-sm" type="button" onclick="linkedinReply('${encodeURIComponent(c.post_urn)}','${encodeURIComponent(c.comment_urn)}','${safeId}')">Reply</button>
    </div>` : '';
  return `<div class="card" style="margin-bottom:8px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--muted,#6B778C)">${esc(c.actor || '')}${when ? ' · ' + esc(when) : ''}</div>
      ${replied}
    </div>
    <div style="margin-top:6px;white-space:pre-wrap">${esc(c.message || '')}</div>
    ${replyUi}
  </div></div>`;
}

async function linkedinReply(postUrnEnc, commentUrnEnc, safeId) {
  const input = document.getElementById('li-reply-' + safeId);
  const message = (input?.value || '').trim();
  if (!message) return;
  const r = await api('POST', '/api/linkedin/comments/reply', {
    postUrn: decodeURIComponent(postUrnEnc),
    commentUrn: decodeURIComponent(commentUrnEnc),
    message,
  });
  if (r && r.error) { toastError(liErrorText(r.error)); return; }
  toastSuccess('Reply posted.');
  await loadLinkedInComments();
}
window.linkedinReply = linkedinReply;

async function linkedinRefreshComments() {
  const r = await api('POST', '/api/linkedin/comments/refresh');
  if (r && r.error) toastError(liErrorText(r.error));
  else toastSuccess('Ingested ' + (r.ingested || 0) + ' new comment(s).');
  await loadLinkedInComments();
}
window.linkedinRefreshComments = linkedinRefreshComments;
