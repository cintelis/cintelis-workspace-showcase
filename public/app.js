
const API = '';
const SECTION_TITLES = {
  overview: 'Overview',
  templates: 'Email Templates',
  contacts: 'Contacts',
  lists: 'Contact Lists',
  campaigns: 'Campaigns',
  logs: 'Sent Log',
  unsubs: 'Unsubscribes',
  pipeline: 'Deals',
  deal: 'Deal',
  crm_tasks: 'Tasks',
  workspace: 'Workspace',
  contact: 'Contact',
  companies: 'Companies',
  company: 'Company',
  account: 'My Account',
  users: 'Users',
  projects: 'Projects',
  docs: 'Docs',
  integrations: 'Integrations',
  feature_settings: 'Feature visibility',
  api_tokens: 'API Tokens',
  tools_build_margin: 'Build Margin',
  tools_quoting: 'Quoting',
  linkedin: 'LinkedIn Ads',
  linkedin_posts: 'LinkedIn Posts',
  roadmap: 'Roadmap',
  billing: 'Contract & Billing',
  customers: 'Customers'
};
const PRIMARY_MOBILE_SECTIONS = new Set(['workspace', 'contacts', 'pipeline', 'crm_tasks']);
// Customers get their own four; theirs are the sections the internal set hides.
const CUSTOMER_MOBILE_SECTIONS = new Set(['workspace', 'contacts', 'pipeline', 'crm_tasks', 'projects', 'docs', 'roadmap', 'billing']);
const SECONDARY_MOBILE_SECTIONS = ['templates', 'lists', 'campaigns', 'logs', 'unsubs'];
const REAL_ESTATE_TEMPLATE_SEED_KEY = 'crm_seed_ads_optimiser_real_estate_collection_v5';
const TEMPLATE_PREVIEW_WIDTH_KEY = 'crm_template_preview_width_v1';
const CONTACT_COLUMNS_KEY = 'crm_contact_columns_v1';
const CONTACT_PAGE_SIZE_KEY = 'crm_contact_page_size_v1';
const TEMPLATE_DESKTOP_BREAKPOINT = 960;
const CONTACT_PAGE_SIZE_DEFAULT = 25;
const CONTACT_TABLE_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'email', label: 'Email' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'stage', label: 'Stage' },
  { key: 'deal_value', label: 'Open deals' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'last_contacted', label: 'Last contacted' },
  { key: 'added', label: 'Added' }
];
const DEFAULT_CONTACT_COLUMNS = ['contact', 'email', 'title', 'company', 'phone', 'stage', 'added'];
const CONTACT_IMPORT_SAMPLE_CSV = [
  'email,first_name,last_name,title,company,phone,stage,deal_value,image_url',
  'john.smith@example.com,John,Smith,Sales Agent,Acme Realty,0400 000 000,lead,0,',
  'sarah.lee@example.com,Sarah,Lee,Property Manager,Harbour Property,0411 222 333,qualified,850000,https://example.com/sarah.jpg'
].join('\n');
const SEEDED_REAL_ESTATE_TEMPLATE_PREFIX = 'seed_ao_re_';
const TEMPLATE_PREVIEW_DEFAULTS = {
  name: 'Alex Morgan',
  first_name: 'Alex',
  last_name: 'Morgan',
  email: 'alex@example.com',
  company: 'Harbour Property Group',
  unsubscribe_url: 'https://app.adsoptimiser.com.au/unsubscribe-preview',
  physical_address: 'Ads Optimiser, Brisbane QLD'
};

// ── Theme bootstrap (must run before any rendering) ──────────
// Source of truth precedence: per-user preference from /api/me (set after
// login) > localStorage > prefers-color-scheme media query > 'dark' default.
// We apply the cached value immediately on script load to avoid a flash.
const THEME_KEY = 'theme';
function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = t === 'light'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21.64 13a1 1 0 0 0-1.05-.14 8 8 0 0 1-3.37.73 8.15 8.15 0 0 1-8.05-8 8.59 8.59 0 0 1 .25-2 1 1 0 0 0-1.34-1.16A10.14 10.14 0 0 0 12 22a10.21 10.21 0 0 0 9.79-7.69 1 1 0 0 0-.15-1.31z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1zm10-6a1 1 0 0 1-1 1h-2a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1zM5 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1zm14.07-7.07a1 1 0 0 1 0 1.41l-1.42 1.42a1 1 0 1 1-1.41-1.41l1.41-1.42a1 1 0 0 1 1.42 0zM7.76 16.24a1 1 0 0 1 0 1.41l-1.41 1.42A1 1 0 1 1 4.93 17.66l1.42-1.42a1 1 0 0 1 1.41 0zm11.31 1.41a1 1 0 0 1-1.41 1.42l-1.42-1.42a1 1 0 1 1 1.41-1.41zM7.76 7.76A1 1 0 0 1 6.35 6.35l-1.42-1.42a1 1 0 1 1 1.42-1.41l1.41 1.41a1 1 0 0 1 0 1.41z" fill="currentColor"/></svg>';
    btn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
  // Toggle login page logo for day/night
  const dayLogo = document.getElementById('login-logo-day');
  const nightLogo = document.getElementById('login-logo-night');
  if (dayLogo) dayLogo.style.display = t === 'light' ? '' : 'none';
  if (nightLogo) nightLogo.style.display = t === 'light' ? 'none' : '';
}
applyTheme(getInitialTheme());

// ── Resizable sidebar ─────────────────────────────────────────
// Drag the splitter between the sidebar and the content (180–480px, like the
// brainstorm-board notes layout); the width is remembered per browser.
const SIDEBAR_WIDTH_KEY = 'sidebar_width';
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 480, SIDEBAR_DEFAULT = 240;
function applySidebarWidth(w) {
  const px = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(w) || SIDEBAR_DEFAULT));
  document.documentElement.style.setProperty('--sidebar', px + 'px');
  return px;
}
try { const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)); if (saved) applySidebarWidth(saved); } catch {}
function startSidebarDrag(e) {
  e.preventDefault();
  const splitter = document.getElementById('sidebar-splitter');
  const layout = document.querySelector('.layout');
  const left = layout ? layout.getBoundingClientRect().left : 0;
  document.body.classList.add('sidebar-resizing');
  if (splitter) splitter.classList.add('dragging');
  let width = SIDEBAR_DEFAULT;
  const onMove = (ev) => { width = applySidebarWidth(ev.clientX - left); };
  const onUp = () => {
    document.body.classList.remove('sidebar-resizing');
    if (splitter) splitter.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); } catch {}
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
function resetSidebarWidth() {
  applySidebarWidth(SIDEBAR_DEFAULT);
  try { localStorage.removeItem(SIDEBAR_WIDTH_KEY); } catch {}
}
window.startSidebarDrag = startSidebarDrag;
window.resetSidebarWidth = resetSidebarWidth;
async function toggleTheme() {
  const next = (document.documentElement.dataset.theme === 'light') ? 'dark' : 'light';
  applyTheme(next);
  // Persist to user preferences if logged in. Fire-and-forget — local storage
  // already gives us the immediate change; the server is just for cross-device.
  if (token) api('PATCH','/api/me/preferences',{theme:next}).catch(() => {});
}

let token = localStorage.getItem('token');
let state = {
  me: null,
  users: [],
  templates: [],
  contacts: [],
  lists: [],
  campaigns: [],
  logs: [],
  stats: {},
  overview: {},
  unsubs: [],
  ui: {
    overviewRange: 'all',
    crmContactId: '',
    pipelineStage: 'lead',
    pipelineSearch: '',
    crmFilters: null,
    crmSort: null,
    crmCompanyId: '',
    companiesQuery: '',
    crmOpenChip: '',
    crmViewId: '',
    listModalId: '',
    listModalName: '',
    listModalMembers: [],
    listModalSearch: '',
    listModalOnlyUnlisted: false,
    listModalOnlyUntagged: false,
    contactsQuery: '',
    contactsTitle: '',
    contactTagsOpen: false,
    contactTagFilter: [],
    contactsPage: 1,
    contactsPageSize: getStoredContactPageSize(),
    contactColumns: getStoredContactColumns(),
    contactColumnsOpen: false,
    contactModalBase: null,
    contactModalReturnId: '',
    selectedTemplateId: '',
    templateDraft: null,
    templateLoading: false,
    templatePreviewWidth: clampTemplatePreviewWidth(parseInt(localStorage.getItem(TEMPLATE_PREVIEW_WIDTH_KEY) || '520', 10)),
    templateResizing: false
  }
};
let currentSection = 'overview';
let campaignEditingId = '';
let campaignModalMode = 'create';
let campaignScheduleDraft = {};
let listEditingId = '';
let contactsSearchTimer = null;
const ICONS = {
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.2 10.2 1 1 0 1 1 1.76-.96A5 5 0 1 0 8 7.7h1.5a1 1 0 1 1 0 2H5.8a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0v1.2A6.94 6.94 0 0 1 12 5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 3.3a2.3 2.3 0 0 1 3.2 3.2l-9.9 9.9-4.1.9.9-4.1 9.9-9.9zm1.8 1.4a.3.3 0 0 0-.4 0l-1.2 1.2 1.8 1.8L19 6.5a.3.3 0 0 0 0-.4l-1.4-1.4zM14.6 7.3l-7.8 7.8-.4 1.8 1.8-.4 7.8-7.8-1.4-1.4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a1 1 0 0 0-.95.68L7.8 4.5H5a1 1 0 1 0 0 2h.6l.9 11.1A2 2 0 0 0 8.5 19.5h7a2 2 0 0 0 2-1.9l.9-11.1H19a1 1 0 1 0 0-2h-2.8l-.25-.82A1 1 0 0 0 15 3H9zm.52 2h4.96l.15.5H9.37l.15-.5zm-.98 3.5a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2l.4 2.1a7.3 7.3 0 0 1 1.8.7l1.8-1.1 1.4 1.4-1.1 1.8c.3.6.5 1.2.7 1.8L21 11v2l-2.1.4a7.3 7.3 0 0 1-.7 1.8l1.1 1.8-1.4 1.4-1.8-1.1a7.3 7.3 0 0 1-1.8.7L13 21h-2l-.4-2.1a7.3 7.3 0 0 1-1.8-.7l-1.8 1.1-1.4-1.4 1.1-1.8a7.3 7.3 0 0 1-.7-1.8L3 13v-2l2.1-.4c.1-.6.4-1.2.7-1.8L4.7 7l1.4-1.4 1.8 1.1c.6-.3 1.2-.5 1.8-.7L11 3zm1 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 11.2 19.7 4.1c.9-.4 1.8.5 1.4 1.4l-7.1 16.3c-.4.9-1.7.8-1.9-.2l-1.1-5-5-1.1c-1-.2-1.1-1.5-.2-1.9zm3.6 1 4.2.9a1 1 0 0 1 .76.76l.9 4.2 5.1-11.7L7 12.2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3a2 2 0 0 0-2 2v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V8.4a2 2 0 0 0-.59-1.41l-2.4-2.4A2 2 0 0 0 13.6 4H9zm0 2h4v2a2 2 0 0 0 2 2h2v5h-2V8a2 2 0 0 0-2-2H9V5zm6 1.4L16.6 8H15V6.4zM6 8h7v9H6V8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1zm8 0a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 5.2a1 1 0 0 1 1.05.07l8 5.5a1.5 1.5 0 0 1 0 2.42l-8 5.5A1 1 0 0 1 8 17.9V6.1c0-.36.2-.7.52-.88.06-.01.12-.03.18-.02z"/></svg>',
  stepback: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 6.7a1 1 0 0 1 0 1.4L7.7 11H18a1 1 0 1 1 0 2H7.7l2.9 2.9a1 1 0 1 1-1.4 1.4l-4.6-4.6a1 1 0 0 1 0-1.4l4.6-4.6a1 1 0 0 1 1.4 0z"/></svg>',
  stepforward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.4 6.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 0 1-1.4-1.4l2.9-2.9H6a1 1 0 1 1 0-2h10.3l-2.9-2.9a1 1 0 0 1 0-1.4z"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v12h12V6H6zm2 9 2.4-3 1.8 2.2 2.6-3.2L18 15H8zm2-6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a1 1 0 1 1 2 0v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4zm-6 13a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3H5a2 2 0 0 0-2 2v6.2a2 2 0 0 0 .59 1.41l7.8 7.8a2 2 0 0 0 2.82 0l6.2-6.2a2 2 0 0 0 0-2.82l-7.8-7.8A2 2 0 0 0 11 3zm-3 4.5A1.5 1.5 0 1 1 8 10.5 1.5 1.5 0 0 1 8 7.5z"/></svg>'
};

function iconButton(icon, title, onclick, variant = 'ghost', options = {}) {
  const { disabled = false, extraClass = '' } = options;
  return `<button class="icon-btn icon-btn-${variant}${extraClass ? ' ' + extraClass : ''}" type="button" title="${esc(title)}" aria-label="${esc(title)}" onclick="${onclick}" ${disabled ? 'disabled' : ''}>${ICONS[icon] || ICONS.edit}<span class="screen-reader-only">${esc(title)}</span></button>`;
}

// ── Auth ──────────────────────────────────────────────────────
// /api/auth/login returns either {token} or {requires_totp, session_id}.
// On requires_totp we show the TOTP prompt and call /api/auth/totp/login
// (or /totp/login-backup) to promote the pending session into a real one.
let pendingTotpSessionId = null;

async function doLogin() {
  const u = document.getElementById('l-user').value;
  const p = document.getElementById('l-pass').value;
  const errEl = document.getElementById('l-err');
  errEl.style.display = 'none';
  const r = await api('POST','/api/auth/login',{email:u,password:p},false);
  if (r && r.token) {
    await onLoginSuccess(r.token);
  } else if (r && r.requires_totp && r.session_id) {
    pendingTotpSessionId = r.session_id;
    showTotpPrompt(false);
  } else {
    errEl.textContent = (r && r.error) || 'Invalid credentials. Try again.';
    errEl.style.display = 'block';
  }
}

async function submitTotpCode(useBackup) {
  const codeEl = document.getElementById('totp-code');
  const errEl = document.getElementById('totp-err');
  const code = codeEl ? codeEl.value : '';
  if (!code) { if (errEl) { errEl.textContent = 'Enter a code'; errEl.style.display='block'; } return; }
  if (errEl) errEl.style.display = 'none';
  const path = useBackup ? '/api/auth/totp/login-backup' : '/api/auth/totp/login';
  const r = await api('POST', path, { session_id: pendingTotpSessionId, code }, false);
  if (r && r.token) {
    pendingTotpSessionId = null;
    await onLoginSuccess(r.token);
  } else if (errEl) {
    errEl.textContent = (r && r.error) || 'Invalid code';
    errEl.style.display = 'block';
  }
}

function showTotpPrompt(useBackup) {
  const label = useBackup ? 'Backup recovery code' : 'Authenticator code';
  const placeholder = useBackup ? 'xxxxx-xxxxx' : '123456';
  const inputType = useBackup ? 'text' : 'tel';
  const switchHtml = useBackup
    ? '<a href="javascript:void(0)" onclick="showTotpPrompt(false)">Use authenticator code instead</a>'
    : '<a href="javascript:void(0)" onclick="showTotpPrompt(true)">Use a backup code instead</a>';
  setModal(`
    <div class="modal-head"><div class="modal-title">Two-factor verification</div>
      <button class="modal-close" type="button" onclick="cancelTotpPrompt()">x</button></div>
    <div class="modal-body">
      <p style="margin:0 0 14px;color:var(--muted2);font-size:14px">Enter the ${esc(label.toLowerCase())} from your authenticator app to finish signing in.</p>
      <label>${esc(label)}</label>
      <input id="totp-code" type="${inputType}" inputmode="${useBackup?'text':'numeric'}" autocomplete="one-time-code" placeholder="${placeholder}" autofocus>
      <div class="login-err" id="totp-err" style="display:none;margin-top:10px"></div>
      <div style="margin-top:14px;font-size:13px">${switchHtml}</div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="cancelTotpPrompt()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitTotpCode(${useBackup?'true':'false'})">Verify</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('totp-code');
    if (el) {
      el.focus();
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') submitTotpCode(useBackup); });
    }
  }, 30);
}

function cancelTotpPrompt() {
  pendingTotpSessionId = null;
  closeModal();
}

async function onLoginSuccess(newToken) {
  token = newToken;
  localStorage.setItem('token', token);
  closeModal();
  document.getElementById('login').style.display = 'none';
  if (typeof destroyLoginBg === 'function') destroyLoginBg();
  document.getElementById('app').style.display = 'block';
  await refreshMe();
  if (!isCustomerUser() || customerFeature('crm')) {
    api('GET','/api/crm/stats').then(s => updateFollowUpBadges(s?.followups_due || 0));
  }
  if (!isCustomerUser()) {
    await seedRealEstateTemplate().catch(() => {});
  }
  await bootNav();
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && document.getElementById('login').style.display !== 'none') doLogin(); });
async function doLogout() {
  await api('POST','/api/auth/logout');
  localStorage.removeItem('token');
  location.reload();
}
async function init() {
  if (!token) return;
  const r = await api('GET','/api/auth/check');
  if (!r.ok) { localStorage.removeItem('token'); return; }
  document.getElementById('login').style.display = 'none';
  if (typeof destroyLoginBg === 'function') destroyLoginBg();
  document.getElementById('app').style.display = 'block';
  await refreshMe();
  if (!isCustomerUser() || customerFeature('crm')) {
    api('GET','/api/crm/stats').then(s => updateFollowUpBadges(s?.followups_due || 0));
  }
  if (!isCustomerUser()) {
    await seedRealEstateTemplate().catch(() => {});
  }
  // Sprint 5: kick off the bell badge poll
  if (typeof refreshUnreadCount === 'function') refreshUnreadCount();
  // The landing section may live in a later deferred script (workspace is in
  // crm-tasks-ui.js); a cached API answer can beat those scripts, so wait for
  // DOMContentLoaded, by which point every deferred script has executed.
  for (let i = 0; i < 100 && !window.__uiScriptsReady; i++) await new Promise(r => setTimeout(r, 50));
  await bootNav();
}

// First navigation after boot or login: the page the link pointed at (router.js
// restores it), else the default section.
async function bootNav() {
  if (typeof window.__restoreInitialRoute === 'function' && await window.__restoreInitialRoute()) return;
  nav(defaultSection());
}

// ── Current user (loaded on every login / init) ───────────────
async function refreshMe() {
  const r = await api('GET','/api/me');
  if (r && r.user) {
    state.me = r.user;
    state.me.mfa_enabled = !!r.mfa_enabled;
    state.me.backup_codes_remaining = Number(r.backup_codes_remaining || 0);
    // Sprint 6: load feature visibility flags so the nav can be filtered
    try {
      const ff = await api('GET','/api/app-settings/feature-visibility');
      if (ff && typeof ff === 'object' && !ff.error) state.featureFlags = ff;
    } catch (e) { /* keep defaults */ }
    applyRoleVisibility();
    // Sync theme from server preference if set — overrides localStorage
    // bootstrap so the user gets the same theme across devices.
    const prefTheme = state.me.preferences && state.me.preferences.theme;
    if (prefTheme === 'light' || prefTheme === 'dark') applyTheme(prefTheme);
  }
}
function isAdmin() { return state.me && state.me.role === 'admin'; }
// ── Multi-tenant helpers ──────────────────────────────────────
// A "customer user" belongs to a client company (users.customer_id set) and
// only sees that tenant's projects/docs/users/contract. Internal (Cintelis)
// users have customer_id null and see everything.
function isCustomerUser() { return !!(state.me && state.me.customer_id); }
function isInternalAdmin() { return !!(state.me && !isCustomerUser() && state.me.role === 'admin'); }
function customerFeature(key) {
  const f = state.me && state.me.customer && state.me.customer.features;
  if (!f || typeof f !== 'object') return true;
  return f[key] !== false;
}
// Where to land after login / on an empty hash.
function defaultSection() {
  // Workspace is home for everyone with CRM (sprint 16); Overview stays in the nav.
  if (!isCustomerUser()) return 'workspace';
  return customerFeature('crm') ? 'workspace' : 'projects';
}
window.isCustomerUser = isCustomerUser;
window.isInternalAdmin = isInternalAdmin;
window.customerFeature = customerFeature;
window.defaultSection = defaultSection;

function setNavDisplay(ids, visible) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }
}

function applyRoleVisibility() {
  const show = isAdmin() ? '' : 'none';
  const u1 = document.getElementById('nav-users'); if (u1) u1.style.display = show;
  const u2 = document.getElementById('more-users'); if (u2) u2.style.display = show;
  const i1 = document.getElementById('nav-integrations'); if (i1) i1.style.display = show;
  const i2 = document.getElementById('more-integrations'); if (i2) i2.style.display = show;
  const f1 = document.getElementById('nav-feature-settings'); if (f1) f1.style.display = show;
  const f2 = document.getElementById('more-feature-settings'); if (f2) f2.style.display = show;
  const t1 = document.getElementById('nav-api-tokens'); if (t1) t1.style.display = show;
  const t2 = document.getElementById('more-api-tokens'); if (t2) t2.style.display = show;
  // Update topbar avatar
  const avatarBtn = document.getElementById('topbar-avatar');
  if (avatarBtn && state.me) {
    const u = state.me;
    if (u.avatar_url) {
      avatarBtn.innerHTML = '<img src="' + esc(u.avatar_url) + '" onerror="this.parentNode.textContent=\'' + esc((u.display_name || u.email || '?').charAt(0).toUpperCase()) + '\'">';
    } else {
      avatarBtn.textContent = (u.display_name || u.email || '?').charAt(0).toUpperCase();
    }
  }
  if (isCustomerUser()) {
    applyCustomerVisibility();
  } else {
    applyFeatureVisibility();
    applyInternalVisibility();
  }
  hideEmptyNavGroups();
}

// Internal (Cintelis) users: the top-level Roadmap / Billing pages are
// customer-only (internal users have the per-project roadmap tab); the
// Customers admin page is for internal admins only.
function applyInternalVisibility() {
  setNavDisplay(['nav-roadmap','more-roadmap','nav-billing','more-billing'], false);
  setNavDisplay(['nav-customers','more-customers'], isInternalAdmin());
  const lbl = document.getElementById('nav-customer-name');
  if (lbl) lbl.style.display = 'none';
}

// Customer (tenant) users: hide everything outreach/CRM/tools/internal-admin,
// show only the tenant-facing sections their customer's feature flags allow.
function applyCustomerVisibility() {
  const hidden = [
    'nav-overview','more-overview',
    'nav-templates','more-templates',
    'nav-contacts','tab-contacts',
    'nav-lists','more-lists',
    'nav-campaigns','more-campaigns',
    'nav-logs','more-logs',
    'nav-unsubs','more-unsubs',
    'nav-pipeline','tab-pipeline',
    'nav-workspace','tab-workspace',
    'nav-crm_tasks','tab-crm_tasks',
    'nav-companies','more-companies',
    'nav-tools_build_margin','more-tools_build_margin',
    'nav-tools_quoting','more-tools_quoting',
    'nav-linkedin','more-linkedin',
    'nav-linkedin_posts','more-linkedin_posts',
    'nav-feature-settings','more-feature-settings',
    'nav-customers','more-customers'
  ];
  setNavDisplay(hidden, false);
  const admin = isAdmin();
  // The four primary mobile tabs are all internal sections, so without this a
  // customer on a phone gets a tab bar containing nothing but "More".
  setNavDisplay(['nav-projects','more-projects','tab-projects'], customerFeature('tasks'));
  setNavDisplay(['nav-docs','more-docs','tab-docs'], customerFeature('docs'));
  setNavDisplay(['nav-roadmap','more-roadmap','tab-roadmap'], customerFeature('roadmap'));
  setNavDisplay(['nav-billing','more-billing','tab-billing'], customerFeature('billing'));
  // Sprint 9: each customer has their own CRM and Outreach, gated by entitlement.
  setNavDisplay(['nav-workspace','tab-workspace','nav-crm_tasks','tab-crm_tasks','nav-contacts','tab-contacts','nav-companies','more-companies','nav-lists','more-lists','nav-pipeline','tab-pipeline'], customerFeature('crm'));
  setNavDisplay(['nav-templates','more-templates','nav-campaigns','more-campaigns','nav-logs','more-logs','nav-unsubs','more-unsubs'], customerFeature('outreach'));
  setNavDisplay(['nav-account','more-account'], true);
  setNavDisplay(['nav-users','more-users'], admin);
  setNavDisplay(['nav-integrations','more-integrations'], admin && customerFeature('integrations'));
  setNavDisplay(['nav-api-tokens','more-api-tokens'], admin && customerFeature('api_tokens'));
  // Small muted tenant label at the top of the sidebar.
  const lbl = document.getElementById('nav-customer-name');
  if (lbl) {
    const name = state.me.customer && state.me.customer.name;
    lbl.textContent = name || '';
    lbl.style.display = name ? '' : 'none';
  }
  // "Tools" is an internal word for Build Margin, Quoting and LinkedIn, none of
  // which a customer sees. What is left under it is their delivery plan and
  // their agreement, so the group says that instead.
  const toolsLabel = document.getElementById('nav-tools-label');
  if (toolsLabel) toolsLabel.textContent = 'Delivery';
}

// Sprint 6: hide top-level nav items based on per-role feature visibility.
// Admin always sees everything; only members and viewers can be restricted.
function applyFeatureVisibility() {
  if (!state.featureFlags || isAdmin()) return;
  const role = state.me && state.me.role;
  if (!role) return;
  const flags = state.featureFlags;
  const sectionMap = {
    outreach: ['nav-templates','nav-contacts','nav-lists','nav-campaigns','nav-logs','nav-unsubs','more-templates','more-lists','more-campaigns','more-logs','more-unsubs','tab-contacts'],
    crm:      ['nav-workspace','nav-crm_tasks','nav-companies','nav-pipeline','tab-workspace','tab-crm_tasks','tab-pipeline','more-companies'],
    tasks:    ['nav-projects','more-projects'],
    docs:     ['nav-docs','more-docs'],
  };
  for (const [feature, ids] of Object.entries(sectionMap)) {
    const allowed = flags[feature]?.[role] !== false;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = allowed ? '' : 'none';
    }
  }
}

// Hide group labels + dividers when all their child nav items are hidden.
function hideEmptyNavGroups() {
  const groups = [
    { divider: 'nav-outreach-divider', label: 'nav-outreach-label', items: ['nav-templates','nav-contacts','nav-lists','nav-campaigns','nav-logs','nav-unsubs'] },
    { divider: 'nav-crm-divider', label: 'nav-crm-label', items: ['nav-workspace','nav-crm_tasks','nav-companies','nav-pipeline'] },
    { divider: 'nav-tasks-divider', label: 'nav-tasks-label', items: ['nav-projects'] },
    { divider: 'nav-docs-divider', label: 'nav-docs-label', items: ['nav-docs'] },
    { divider: 'nav-tools-divider', label: 'nav-tools-label', items: ['nav-tools_build_margin','nav-tools_quoting','nav-linkedin','nav-linkedin_posts','nav-roadmap','nav-billing'] },
    { divider: 'nav-settings-divider', label: 'nav-settings-label', items: ['nav-account','nav-users','nav-integrations','nav-feature-settings','nav-api-tokens','nav-customers'] },
  ];
  for (const g of groups) {
    const anyVisible = g.items.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none';
    });
    const divEl = document.getElementById(g.divider);
    const lblEl = document.getElementById(g.label);
    if (divEl) divEl.style.display = anyVisible ? '' : 'none';
    if (lblEl) lblEl.style.display = anyVisible ? '' : 'none';
  }
}

// ── Topbar "+ Create" button (context-aware) ─────────────────
function updateTopbarCreate() {
  const btn = document.getElementById('topbar-create');
  if (!btn) return;
  const section = currentSection;
  const tab = state.ui && state.ui.tasksTab;
  const hasProject = state.ui && state.ui.tasksProjectId;
  const hasSpace = state.ui && state.ui.docsSpaceId;
  // Show on project detail pages and docs space pages
  if (section === 'projects' && hasProject) {
    btn.style.display = '';
    if (tab === 'sprints') { btn.textContent = '+ Create Sprint'; }
    else { btn.textContent = '+ Create Issue'; }
  } else if (section === 'docs' && hasSpace) {
    btn.style.display = '';
    btn.textContent = '+ Create Page';
  } else {
    btn.style.display = 'none';
  }
}
window.updateTopbarCreate = updateTopbarCreate;

function topbarCreate() {
  const section = currentSection;
  const tab = state.ui && state.ui.tasksTab;
  const hasProject = state.ui && state.ui.tasksProjectId;
  const hasSpace = state.ui && state.ui.docsSpaceId;
  if (section === 'projects' && hasProject && tab === 'sprints') {
    if (typeof openCreateSprint === 'function') openCreateSprint();
  } else if (section === 'projects' && hasProject) {
    if (typeof openCreateIssue === 'function') openCreateIssue();
  } else if (section === 'docs' && hasSpace) {
    if (typeof openCreatePage === 'function') openCreatePage('');
  }
}
window.topbarCreate = topbarCreate;

// ── API helper ────────────────────────────────────────────────
async function api(method, path, body, auth = true) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (auth && token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opts);
    return await r.json();
  } catch { return { error: 'Network error' }; }
}

// ── Navigation ────────────────────────────────────────────────
async function nav(section) {
  currentSection = section;
  closeMobileMenu();
  document.querySelectorAll('.nav-item, .mobile-tab, .mobile-sheet-item').forEach(el => el.classList.remove('active'));
  const navKey = section === 'contact' ? 'contacts' : section === 'company' ? 'companies' : section === 'deal' ? 'pipeline' : section;   // a record page lights up its list's nav item
  const sideNav = document.getElementById('nav-' + navKey);
  const mobileTab = document.getElementById('tab-' + navKey);
  const moreItem = document.getElementById('more-' + navKey);
  if (sideNav) sideNav.classList.add('active');
  if (mobileTab) mobileTab.classList.add('active');
  if (moreItem) {
    moreItem.classList.add('active');
    const moreTab = document.getElementById('tab-more');
    if (moreTab) moreTab.classList.add('active');
  } else if (!(isCustomerUser() ? CUSTOMER_MOBILE_SECTIONS : PRIMARY_MOBILE_SECTIONS).has(section)) {
    const moreTab = document.getElementById('tab-more');
    if (moreTab) moreTab.classList.add('active');
  }
  document.getElementById('page-title').textContent = SECTION_TITLES[section] || section;
  updateTopbarCreate();
  return renderSection(section);
}
async function refreshCurrent() { return nav(currentSection); }

// Segmented control ("Table | Board"). `options` = [{key,label}], `onPick` is
// the name of a global function that receives the picked key.
function renderSegmented(options, activeKey, onPick) {
  return `<div class="seg" role="tablist">${options.map(o => `
    <button type="button" role="tab" class="seg-btn ${o.key === activeKey ? 'active' : ''}" aria-selected="${o.key === activeKey}" onclick="${onPick}('${esc(o.key)}')">${esc(o.label)}</button>`).join('')}</div>`;
}
window.renderSegmented = renderSegmented;

function updateFollowUpBadges(count) {
  ['fu-badge', 'mobile-fu-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  });
}

function openMobileMenu() {
  document.getElementById('mobile-sheet-bg')?.classList.add('open');
  document.getElementById('mobile-sheet')?.classList.add('open');
}

function closeMobileMenu() {
  document.getElementById('mobile-sheet-bg')?.classList.remove('open');
  document.getElementById('mobile-sheet')?.classList.remove('open');
}

async function seedRealEstateTemplate() {
  if (localStorage.getItem(REAL_ESTATE_TEMPLATE_SEED_KEY) === '1') return;
  const seeded = await api('POST', '/api/templates/seed/real-estate');
  if (!seeded?.error) localStorage.setItem(REAL_ESTATE_TEMPLATE_SEED_KEY, '1');
}

function isSeededRealEstateTemplateId(id) {
  return String(id || '').startsWith(SEEDED_REAL_ESTATE_TEMPLATE_PREFIX);
}

function showTemplateMessage(message, kind = 'success') {
  const alertId = isDesktopTemplateWorkspace() ? 't-work-err' : 't-err';
  const alertClass = kind === 'success' ? 'alert-success' : 'alert-error';
  const el = document.getElementById(alertId);
  if (el) {
    showAlert(alertId, message, alertClass);
    return;
  }
  if (typeof toast === 'function') toast(message, alertClass === 'error' ? 'error' : 'info');
  else appAlert(message);
}

async function refreshSeededTemplates(selectedTemplateId = state.ui.selectedTemplateId) {
  const seeded = await api('POST', '/api/templates/seed/real-estate');
  if (seeded?.error) {
    showTemplateMessage(seeded.error || 'Unable to refresh seeded templates.');
    return;
  }
  localStorage.setItem(REAL_ESTATE_TEMPLATE_SEED_KEY, '1');
  await loadTemplates();
  if (selectedTemplateId && selectedTemplateId !== 'new') {
    await loadTemplateIntoWorkspace(selectedTemplateId, true);
  } else if (isDesktopTemplateWorkspace()) {
    renderTemplates();
  }
  if (!isDesktopTemplateWorkspace()) renderTemplates();
  showTemplateMessage(`Seeded templates refreshed${seeded.created_count ? ` (${seeded.created_count} created)` : ''}.`, 'success');
}

function isDesktopTemplateWorkspace() {
  return typeof window !== 'undefined' && window.innerWidth > TEMPLATE_DESKTOP_BREAKPOINT;
}

function clampTemplatePreviewWidth(value) {
  if (!Number.isFinite(value)) return 520;
  return Math.max(320, Math.min(760, value));
}

function createEmptyTemplateDraft() {
  return { id: '', name: '', subject: '', html_body: '' };
}

function mergeTemplatePreview(html) {
  return String(html || '')
    .replace(/\{\{first_name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.first_name)
    .replace(/\{\{last_name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.last_name)
    .replace(/\{\{name\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.name)
    .replace(/\{\{email\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.email)
    .replace(/\{\{company\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.company)
    .replace(/\{\{unsubscribe_url\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.unsubscribe_url)
    .replace(/\{\{physical_address\}\}/gi, TEMPLATE_PREVIEW_DEFAULTS.physical_address);
}

function getActiveTemplateDraft() {
  return state.ui.templateDraft || createEmptyTemplateDraft();
}

function renderTemplatePreviewPane() {
  const frame = document.getElementById('template-preview-frame');
  if (!frame) return;
  const draft = getActiveTemplateDraft();
  const previewHtml = draft.html_body?.trim()
    ? mergeTemplatePreview(draft.html_body)
    : `<!DOCTYPE html><html><body style="margin:0;padding:32px;font-family:Arial,sans-serif;background:#ffffff;color:#111827;"><p style="margin:0;font-size:15px;color:#6b7280;">Start writing template HTML to see the preview.</p></body></html>`;
  frame.srcdoc = previewHtml;
  const title = document.getElementById('template-workspace-title');
  const meta = document.getElementById('template-workspace-meta');
  if (title) title.textContent = draft.name || 'New Template';
  if (meta) meta.textContent = draft.subject || 'Preview uses sample merge values for first name, last name, full name, email, company, unsubscribe link, and address.';
}

async function loadTemplateIntoWorkspace(id, force = false) {
  if (!id) {
    state.ui.selectedTemplateId = 'new';
    state.ui.templateDraft = createEmptyTemplateDraft();
    state.ui.templateLoading = false;
    if (currentSection === 'templates') renderTemplates();
    return;
  }
  if (!force && state.ui.templateDraft?.id === id && state.ui.templateDraft.html_body) {
    state.ui.selectedTemplateId = id;
    if (currentSection === 'templates') renderTemplates();
    return;
  }
  state.ui.selectedTemplateId = id;
  state.ui.templateLoading = true;
  if (currentSection === 'templates') renderTemplates();
  const tmpl = await api('GET', `/api/templates/${id}`);
  if (tmpl?.error) {
    state.ui.templateLoading = false;
    return;
  }
  state.ui.templateDraft = {
    id: tmpl.id || '',
    name: tmpl.name || '',
    subject: tmpl.subject || '',
    html_body: tmpl.html_body || ''
  };
  state.ui.templateLoading = false;
  if (currentSection === 'templates') renderTemplates();
}

function createNewTemplateWorkspace() {
  state.ui.selectedTemplateId = 'new';
  state.ui.templateDraft = createEmptyTemplateDraft();
  state.ui.templateLoading = false;
  renderTemplates();
}

function updateTemplateWorkspaceField(field, value) {
  const draft = getActiveTemplateDraft();
  draft[field] = value;
  state.ui.templateDraft = draft;
  renderTemplatePreviewPane();
}

function startTemplateResize(event) {
  if (!isDesktopTemplateWorkspace()) return;
  event.preventDefault();
  state.ui.templateResizing = true;
}

// ── Sections ──────────────────────────────────────────────────
// Sections a customer (tenant) user can never open, and the ones that depend
// on a feature being enabled for their organisation (sprint 9: CRM and
// Outreach are per customer). router.js uses the same check for hash URLs.
const INTERNAL_ONLY_SECTIONS = new Set(['overview','tools_build_margin','tools_quoting','linkedin','linkedin_posts','feature_settings','customers']);
const CUSTOMER_FEATURE_SECTIONS = {
  contacts: 'crm', contact: 'crm', companies: 'crm', company: 'crm', lists: 'crm', pipeline: 'crm', deal: 'crm', followups: 'crm', crm_tasks: 'crm', workspace: 'crm', overview: 'crm',
  templates: 'outreach', campaigns: 'outreach', logs: 'outreach', unsubs: 'outreach',
};
function customerMayOpen(s) {
  if (!isCustomerUser()) return true;
  if (INTERNAL_ONLY_SECTIONS.has(s)) return false;
  const feature = CUSTOMER_FEATURE_SECTIONS[s];
  return feature ? customerFeature(feature) : true;
}
window.customerMayOpen = customerMayOpen;
async function renderSection(s) {
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty"><div class="empty-icon">...</div><p>Loading...</p></div>';
  if (!customerMayOpen(s)) { return nav(defaultSection()); }
  if (s === 'overview') { await loadOverview(); renderOverview(); }
  else if (s === 'templates') { await loadTemplates(); renderTemplates(); }
  else if (s === 'contacts') { await loadContacts(state.ui.contactsQuery); renderContacts(); }
  else if (s === 'contact') { await renderContactRecord(state.ui.crmContactId); }
  else if (s === 'crm_tasks') { await loadCrmTasks(); renderCrmTasks(); }
  else if (s === 'companies') { await loadCompanies(); renderCompanies(); }
  else if (s === 'company') { await renderCompanyRecord(state.ui.crmCompanyId); }
  else if (s === 'workspace') { await Promise.all([loadWorkspace(), loadCrmStats()]); renderWorkspace(); }
  else if (s === 'lists') { await Promise.all([loadLists(), loadContacts('', '')]); renderLists(); }
  else if (s === 'campaigns') { await Promise.all([loadCampaigns(), loadTemplates(), loadLists()]); renderCampaigns(); }
  else if (s === 'logs') { await loadLogs(); renderLogs(); }
  else if (s === 'unsubs') { await loadUnsubs(); renderUnsubs(); }
  else if (s === 'pipeline') { await Promise.all([loadDeals(), loadDealStats(), loadCrmStats()]); renderPipeline(); }
  else if (s === 'deal') { await renderDealRecord(state.ui.crmDealId); }
  else if (s === 'followups') { state.ui.crmTaskQueue = 'overdue'; return nav('crm_tasks'); }   // retired in sprint 16; old links land on Tasks
  else if (s === 'account') { await loadAccount(); renderAccount(); }
  else if (s === 'users') {
    if (!isAdmin()) { c.innerHTML = '<div class="empty"><p>Admin access required.</p></div>'; return; }
    await loadUsers(); renderUsers();
  }
  else if (s === 'projects') {
    if (typeof renderTasksSection === 'function') {
      await renderTasksSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'docs') {
    if (typeof renderDocsSection === 'function') {
      await renderDocsSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'integrations') {
    if (!isInternalAdmin()) { c.innerHTML = '<div class="empty"><p>Admin access required.</p></div>'; return; }
    if (typeof renderIntegrationsSection === 'function') {
      await renderIntegrationsSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'feature_settings') {
    if (!isInternalAdmin()) { c.innerHTML = '<div class="empty"><p>Admin access required.</p></div>'; return; }
    if (typeof renderFeatureSettingsSection === 'function') {
      await renderFeatureSettingsSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'api_tokens') {
    if (!isAdmin()) { c.innerHTML = '<div class="empty"><p>Admin access required.</p></div>'; return; }
    if (typeof renderApiTokensSection === 'function') {
      await renderApiTokensSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'tools_build_margin') {
    c.innerHTML = '<iframe src="/internal/build-margin" title="Build Margin" style="display:block;width:100%;height:calc(100vh - 120px);border:0;background:#0a0a0f;border-radius:8px"></iframe>';
  }
  else if (s === 'tools_quoting') {
    c.innerHTML = '<iframe src="/internal/quoting-calculator" title="Quoting" style="display:block;width:100%;height:calc(100vh - 120px);border:0;background:#fafaf7;border-radius:8px"></iframe>';
  }
  else if (s === 'linkedin') {
    if (typeof renderLinkedInAdLibrarySection === 'function') {
      await renderLinkedInAdLibrarySection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'linkedin_posts') {
    if (typeof renderLinkedInPostsSection === 'function') {
      await renderLinkedInPostsSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'roadmap') {
    if (typeof renderRoadmapPageSection === 'function') {
      await renderRoadmapPageSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'billing') {
    if (typeof renderBillingSection === 'function') {
      await renderBillingSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  else if (s === 'customers') {
    if (!isInternalAdmin()) { c.innerHTML = '<div class="empty"><p>Admin access required.</p></div>'; return; }
    if (typeof renderCustomersSection === 'function') {
      await renderCustomersSection();
    } else {
      c.innerHTML = '<div class="empty"><p>This page could not be loaded. Refresh the page, and let us know if it keeps happening.</p></div>';
    }
  }
  // Refresh unread count on every section change so the bell stays current
  if (typeof refreshUnreadCount === 'function') refreshUnreadCount();
}

// ── Loaders ───────────────────────────────────────────────────
async function loadOverview() {
  const params = new URLSearchParams();
  const range = state.ui.overviewRange || 'all';
  if (range !== 'all') params.set('range', range);
  const data = await api('GET', '/api/overview' + (params.size ? `?${params.toString()}` : '')) || {};
  state.overview = data;
  state.stats = data;
  state.logs = Array.isArray(data.recent_sends) ? data.recent_sends : [];
}
async function loadStats() { await loadOverview(); }
async function loadTemplates() { state.templates = await api('GET','/api/templates') || []; }
async function loadContacts(q = state.ui.contactsQuery || '', title = state.ui.contactsTitle || '') {
  state.ui.contactsQuery = q;
  state.ui.contactsTitle = title;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (title) params.set('title', title);
  const data = await api('GET','/api/contacts'+(params.size ? `?${params.toString()}` : '')) || [];
  state.contacts = Array.isArray(data) ? data.map(normalizeContactRecord) : [];
  const maxPage = Math.max(1, Math.ceil(state.contacts.length / state.ui.contactsPageSize));
  state.ui.contactsPage = Math.min(state.ui.contactsPage, maxPage);
}
async function loadLists() {
  const data = await api('GET','/api/lists');
  state.lists = Array.isArray(data) ? data : [];
}
async function loadCampaigns() { state.campaigns = await api('GET','/api/campaigns') || []; }
async function loadLogs() { state.logs = await api('GET','/api/logs?limit=200') || []; }
async function loadUnsubs() { state.unsubs = await api('GET','/api/unsubscribes') || []; }

function getStoredContactColumns() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTACT_COLUMNS_KEY) || '[]');
    const allowed = raw.filter(key => CONTACT_TABLE_COLUMNS.some(col => col.key === key));
    return allowed.length ? allowed : DEFAULT_CONTACT_COLUMNS.slice();
  } catch {
    return DEFAULT_CONTACT_COLUMNS.slice();
  }
}

function getStoredContactPageSize() {
  const value = parseInt(localStorage.getItem(CONTACT_PAGE_SIZE_KEY) || `${CONTACT_PAGE_SIZE_DEFAULT}`, 10);
  return [10, 25, 50, 100].includes(value) ? value : CONTACT_PAGE_SIZE_DEFAULT;
}

function splitFullName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function composeContactName(firstName, lastName, fallbackName = '') {
  const fullName = [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ').trim();
  return fullName || String(fallbackName || '').trim();
}

function parseTagInput(value) {
  return Array.from(new Set(String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)));
}

function normalizeContactRecord(contact) {
  const base = contact || {};
  const split = splitFullName(base.name);
  const firstName = String(base.first_name || '').trim() || split.first_name;
  const lastName = String(base.last_name || '').trim() || split.last_name;
  let tags = [];
  if (Array.isArray(base.tags)) tags = base.tags;
  else {
    try { tags = JSON.parse(base.tags || '[]'); } catch { tags = []; }
  }
  let listNames = [];
  if (Array.isArray(base.list_names)) listNames = base.list_names;
  else if (typeof base.list_names_json === 'string') {
    try { listNames = JSON.parse(base.list_names_json || '[]'); } catch { listNames = []; }
  }
  return {
    ...base,
    first_name: firstName,
    last_name: lastName,
    title: String(base.title || '').trim(),
    tags,
    list_names: listNames.map(name => String(name || '').trim()).filter(Boolean),
    list_count: Number(base.list_count || listNames.length || 0),
    image_url: String(base.image_url || '').trim(),
    name: composeContactName(firstName, lastName, base.name)
  };
}

function getContactDisplayName(contact) {
  return composeContactName(contact?.first_name, contact?.last_name, contact?.name) || contact?.email || 'Unnamed contact';
}

function getContactInitials(contact) {
  const parts = [contact?.first_name, contact?.last_name].map(part => String(part || '').trim()).filter(Boolean);
  if (parts.length) return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('');
  const fallback = String(contact?.name || contact?.email || '?').trim();
  return fallback.slice(0, 2).toUpperCase();
}

function renderContactAvatar(contact, large = false) {
  const className = `contact-avatar${large ? ' contact-avatar-lg' : ''}`;
  if (contact?.image_url) {
    return `<img src="${esc(contact.image_url)}" alt="${esc(getContactDisplayName(contact))}" class="${className}">`;
  }
  return `<div class="${className} contact-avatar-fallback">${esc(getContactInitials(contact))}</div>`;
}

function getVisibleContactColumns() {
  const columns = state.ui.contactColumns.filter(key => CONTACT_TABLE_COLUMNS.some(col => col.key === key));
  return columns.length ? columns : ['contact'];
}

function fmtDateShort(s) {
  if (!s) return '-';
  try {
    return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return s;
  }
}

// ── Overview ──────────────────────────────────────────────────
const OVERVIEW_RANGE_OPTIONS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' }
];

function getOverviewRangeLabel(range) {
  const match = OVERVIEW_RANGE_OPTIONS.find(option => option.value === range);
  return match ? match.label : 'All Time';
}

function getOverviewWonLabel(range) {
  if (range === '7d') return 'Won Last 7 Days';
  if (range === '30d') return 'Won Last 30 Days';
  if (range === 'month') return 'Won This Month';
  return 'Won All Time';
}

async function setOverviewRange(range) {
  if (!OVERVIEW_RANGE_OPTIONS.some(option => option.value === range) || state.ui.overviewRange === range) return;
  state.ui.overviewRange = range;
  if (currentSection !== 'overview') return;
  await loadOverview();
  renderOverview();
}

async function openOverviewAddContact() {
  await nav('contacts');
  openContactModal();
}

async function openOverviewNewCampaign() {
  await nav('campaigns');
  openCampaignModal();
}

async function openOverviewImportCsv() {
  await nav('contacts');
  openImportModal();
}

async function openOverviewNewTemplate() {
  await nav('templates');
  createNewTemplateWorkspace();
}

function trimOverviewText(value, limit = 96) {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + '...';
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return fmtDate(dateStr);
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (absMs < hour) return formatter.format(Math.round(diffMs / minute), 'minute');
  if (absMs < day) return formatter.format(Math.round(diffMs / hour), 'hour');
  if (absMs < week) return formatter.format(Math.round(diffMs / day), 'day');
  return formatter.format(Math.round(diffMs / week), 'week');
}

function getOverviewActivityLabel(type) {
  if (type === 'call') return 'Call logged';
  if (type === 'meeting') return 'Meeting booked';
  if (type === 'email') return 'Email sent';
  if (type === 'stage') return 'Stage changed';
  return 'Note added';
}

function getOverviewActivityGlyph(type) {
  if (type === 'call') return 'C';
  if (type === 'meeting') return 'M';
  if (type === 'email') return 'E';
  if (type === 'stage') return 'S';
  return 'N';
}

function renderOverviewTimeline(items) {
  if (!items.length) {
    return '<div class="overview-empty">No activity in this range.</div>';
  }
  return items.map(item => {
    const type = String(item.type || 'note').toLowerCase();
    const contactName = item.contact_name || item.contact_email || 'Unknown contact';
    const clickable = item.contact_id ? ` onclick="openDrawer('${item.contact_id}')"` : '';
    return `<div class="overview-timeline-item${item.contact_id ? ' overview-timeline-item-clickable' : ''}"${clickable}>
      <div class="overview-timeline-icon overview-timeline-icon-${type}">${getOverviewActivityGlyph(type)}</div>
      <div class="overview-timeline-copy">
        <div class="overview-timeline-top">
          <span class="overview-timeline-title">${getOverviewActivityLabel(type)}</span>
          <span class="overview-timeline-time">${formatRelativeTime(item.created_at)}</span>
        </div>
        <div class="overview-timeline-contact">${esc(contactName)}</div>
        <div class="overview-timeline-body">${esc(trimOverviewText(item.body || '-'))}</div>
      </div>
    </div>`;
  }).join('');
}

function renderOverviewFunnel(stages) {
  const rows = stages.length ? stages : ['lead', 'prospect', 'qualified', 'proposal'].map(stage => ({ stage, count: 0, value: 0 }));
  const maxCount = Math.max(...rows.map(row => Number(row.count || 0)), 1);
  return rows.map((row, index) => {
    const count = Number(row.count || 0);
    const value = Number(row.value || 0);
    const previous = index > 0 ? Number(rows[index - 1].count || 0) : 0;
    const conversion = index > 0 && previous > 0 ? Math.round((count / previous) * 100) : null;
    const width = count > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 0;
    return `<div class="overview-funnel-row">
      <div class="overview-funnel-copy">
        <div class="overview-funnel-stage">${esc(STAGE_LABELS[row.stage] || row.stage)}</div>
        <div class="overview-funnel-meta">${count} contact${count !== 1 ? 's' : ''}${value > 0 ? ` | ${fmtCurrency(value)}` : ''}</div>
      </div>
      <div class="overview-funnel-bar-wrap">
        <div class="overview-funnel-bar overview-funnel-bar-${row.stage}" style="width:${width}%"></div>
      </div>
      <div class="overview-funnel-side">
        <div class="overview-funnel-count">${count}</div>
        <div class="overview-funnel-conversion">${conversion === null ? 'Base' : `${conversion}%`}</div>
      </div>
    </div>`;
  }).join('');
}

function renderOverview() {
  const s = state.overview || state.stats || {};
  const recent = Array.isArray(s.recent_sends) ? s.recent_sends : [];
  const activity = Array.isArray(s.recent_activity) ? s.recent_activity : [];
  const stages = Array.isArray(s.pipeline_stages) ? s.pipeline_stages : [];
  const won = s.won || { count: 0, value: 0 };
  const lost = s.lost || { count: 0, value: 0 };
  const wonInRange = s.won_in_range || { count: 0, value: 0 };
  const avgDealSize = Number(won.count || 0) ? Number(won.value || 0) / Number(won.count || 1) : 0;
  const winRateBase = Number(won.count || 0) + Number(lost.count || 0);
  const winRate = winRateBase ? Math.round((Number(won.count || 0) / winRateBase) * 100) : 0;
  const overdue = Number(s.follow_ups_overdue || 0);
  const today = Number(s.follow_ups_today || 0);
  const hasAlert = overdue > 0 || today > 0;
  const range = s.range || state.ui.overviewRange || 'all';

  // Sprint 7: feature-aware Overview — hide CRM/Outreach sections for
  // non-admin users whose roles don't have access to those features.
  const role = state.me && state.me.role;
  const ff = state.featureFlags || {};
  const showOutreach = !isCustomerUser() && (isAdmin() || ff.outreach?.[role] !== false);
  const showCrm = !isCustomerUser() && (isAdmin() || ff.crm?.[role] !== false);
  const showTasks = isAdmin() || ff.tasks?.[role] !== false;
  const showDocs = isAdmin() || ff.docs?.[role] !== false;

  // Quick actions adapt based on visible features
  const quickActions = [];
  if (showOutreach) {
    quickActions.push('<button class="btn btn-primary" type="button" onclick="openOverviewAddContact()">+ Add Contact</button>');
    quickActions.push('<button class="btn btn-ghost" type="button" onclick="openOverviewNewCampaign()">+ New Campaign</button>');
    quickActions.push('<button class="btn btn-ghost" type="button" onclick="openOverviewImportCsv()">Import CSV</button>');
    quickActions.push('<button class="btn btn-ghost" type="button" onclick="openOverviewNewTemplate()">+ New Template</button>');
  }

  document.getElementById('content').innerHTML = `
  <div class="overview-stack">
    ${(showCrm && hasAlert) ? `<div class="dashboard-alert ${overdue > 0 ? 'dashboard-alert-danger' : 'dashboard-alert-warning'}">
      <div class="dashboard-alert-copy">
        <strong>${overdue} overdue</strong>
        <span>${today} due today</span>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" onclick="setCrmTaskQueue('overdue')">View tasks</button>
    </div>` : ''}

    ${quickActions.length ? `<div class="quick-actions">${quickActions.join('')}</div>` : ''}

    <div id="my-issues-widget"></div>

    ${showTasks ? `
    <div class="overview-widgets-grid">
      <div id="widget-active-sprints"></div>
      <div id="widget-due-soon"></div>
    </div>
    <div class="overview-widgets-grid">
      <div id="widget-team-workload"></div>
      <div id="widget-recent-activity"></div>
    </div>
    ` : ''}

    ${(showOutreach || showCrm) ? `
    <div class="overview-range-row">
      <div class="overview-range-label">Date Range</div>
      <div class="overview-range-pills">
        ${OVERVIEW_RANGE_OPTIONS.map(option => `
          <button
            class="btn btn-ghost btn-sm${range === option.value ? ' btn-active' : ''}"
            type="button"
            onclick="setOverviewRange('${option.value}')"
          >${option.label}</button>
        `).join('')}
      </div>
    </div>

    ${showOutreach ? `
    <div class="stats-grid stats-grid-overview">
      <div class="stat-card"><div class="stat-label">Active Contacts</div><div class="stat-val">${s.contacts || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Templates</div><div class="stat-val">${s.templates || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Live Campaigns</div><div class="stat-val">${s.campaigns || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Emails Sent (${getOverviewRangeLabel(range)})</div><div class="stat-val">${s.sent || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Pipeline Value</div><div class="stat-val" style="font-size:22px">${fmtCurrency(s.pipeline_value || 0)}</div></div>
    </div>
    ` : ''}

    ${showCrm ? `
    <div class="overview-metrics-grid">
      <div class="overview-metric-card">
        <div class="overview-metric-label">${getOverviewWonLabel(range)}</div>
        <div class="overview-metric-value">${fmtCurrency(wonInRange.value || 0)}</div>
        <div class="overview-metric-note">${wonInRange.count || 0} deal${Number(wonInRange.count || 0) !== 1 ? 's' : ''}</div>
      </div>
      <div class="overview-metric-card">
        <div class="overview-metric-label">Pipeline Value</div>
        <div class="overview-metric-value">${fmtCurrency(s.pipeline_value || 0)}</div>
        <div class="overview-metric-note">Open opportunities only</div>
      </div>
      <div class="overview-metric-card">
        <div class="overview-metric-label">Avg Deal Size</div>
        <div class="overview-metric-value">${fmtCurrency(avgDealSize)}</div>
        <div class="overview-metric-note">Across all won deals</div>
      </div>
      <div class="overview-metric-card">
        <div class="overview-metric-label">Win Rate</div>
        <div class="overview-metric-value">${winRate}%</div>
        <div class="overview-metric-note">${won.count || 0} won / ${lost.count || 0} lost</div>
      </div>
    </div>

    <div class="overview-panel">
      <div class="overview-panel-head">
        <div>
          <div class="overview-panel-title">Pipeline Funnel</div>
          <div class="overview-panel-note">Current stage counts and value across the active pipeline.</div>
        </div>
      </div>
      <div class="overview-funnel">${renderOverviewFunnel(stages)}</div>
    </div>
    ` : ''}

    <div class="overview-columns">
      ${showCrm ? `
      <div class="overview-panel">
        <div class="overview-panel-head">
          <div>
            <div class="overview-panel-title">Activity Timeline</div>
            <div class="overview-panel-note">Last 15 notes, calls, meetings, and sent emails in ${getOverviewRangeLabel(range).toLowerCase()}.</div>
          </div>
        </div>
        <div class="overview-timeline">${renderOverviewTimeline(activity)}</div>
      </div>
      ` : ''}

      ${showOutreach ? `
      <div class="overview-panel">
        <div class="overview-panel-head">
          <div>
            <div class="overview-panel-title">Recent Sends</div>
            <div class="overview-panel-note">Latest email activity for the selected range.</div>
          </div>
        </div>
        <div class="table-wrap stack-on-mobile overview-table-wrap">
          <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
          ${recent.length ? recent.map(l => `<tr>
            <td class="mono" data-label="Recipient" style="font-size:12px">${esc(l.contact_email || '-')}</td>
            <td data-label="Subject">${esc(l.subject || '-')}</td>
            <td data-label="Campaign">${esc(l.campaign_name || '-')}</td>
            <td data-label="Status"><span class="badge badge-${l.status}">${esc(l.status || '-')}</span></td>
            <td class="text-muted text-sm" data-label="Sent At">${fmtDate(l.sent_at)}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No emails sent in this range.</td></tr>'}
          </tbody></table>
        </div>
      </div>
      ` : ''}
    </div>
    ` : ''}
  </div>`;
  // Sprint 6: render the "My open issues" widget into the placeholder
  if (typeof renderMyIssuesWidget === 'function') renderMyIssuesWidget();
  // Dashboard widgets (Sprint 7+): active sprints, due soon, team workload, recent activity
  if (typeof renderDashboardWidgets === 'function') renderDashboardWidgets();
}

// ── Templates ─────────────────────────────────────────────────
function renderTemplates() {
  if (isDesktopTemplateWorkspace()) return renderTemplatesDesktop();
  return renderTemplatesMobile();
}

function renderTemplatesDesktop() {
  const t = state.templates;
  const selectedId = state.ui.selectedTemplateId;
  if (!selectedId && t[0]?.id) void loadTemplateIntoWorkspace(t[0].id);
  if (selectedId && selectedId !== 'new' && !t.some(x => x.id === selectedId) && t[0]?.id) void loadTemplateIntoWorkspace(t[0].id);
  if ((selectedId === 'new' || !selectedId) && !state.ui.templateDraft) state.ui.templateDraft = createEmptyTemplateDraft();
  const draft = selectedId === 'new'
    ? getActiveTemplateDraft()
    : state.ui.templateDraft?.id === selectedId
      ? getActiveTemplateDraft()
      : createEmptyTemplateDraft();
  const isLoading = state.ui.templateLoading && selectedId && selectedId !== 'new' && draft.id !== selectedId;
  document.getElementById('content').innerHTML = `
  <div class="template-workspace">
    <aside class="template-list-panel">
      <div class="template-list-head">
        <div>
          <div class="template-list-title">Templates</div>
          <div class="text-muted text-sm">${t.length} template${t.length!==1?'s':''}</div>
        </div>
        <div class="template-detail-actions">
          ${iconButton('refresh', 'Refresh seeded templates', 'refreshSeededTemplates()')}
          <button class="btn btn-primary btn-sm" onclick="createNewTemplateWorkspace()">+ New</button>
        </div>
      </div>
      <div class="template-list-body">
        ${t.length ? t.map(r => `
          <button class="template-list-item ${selectedId===r.id?'active':''}" type="button" onclick="loadTemplateIntoWorkspace('${r.id}')">
            <div class="template-list-name">${esc(r.name)}</div>
            <div class="template-list-subject">${esc(r.subject)}</div>
            <div class="template-list-date">${fmtDate(r.updated_at)}</div>
          </button>
        `).join('') : `<div class="template-list-empty">No templates yet. Start a new one to begin.</div>`}
      </div>
    </aside>
    <section class="template-detail-panel">
      <div class="template-detail-head">
        <div>
          <div class="template-detail-title" id="template-workspace-title">${draft.name || (selectedId === 'new' ? 'New Template' : 'Loading template...')}</div>
          <div class="template-detail-meta" id="template-workspace-meta">${draft.subject || 'Preview uses sample merge values for first name, last name, full name, email, company, unsubscribe link, and address.'}</div>
        </div>
        <div class="template-detail-actions">
          ${draft.id ? iconButton('refresh', 'Reset template', isSeededRealEstateTemplateId(draft.id) ? `refreshSeededTemplates('${draft.id}')` : `loadTemplateIntoWorkspace('${draft.id}', true)`) : ''}
          ${draft.id ? iconButton('trash', 'Delete template', `deleteTemplate('${draft.id}')`, 'ghost', { extraClass: 'icon-btn-danger' }) : ''}
          <button class="btn btn-primary" onclick="saveTemplate('${draft.id || ''}')">Save Template</button>
        </div>
      </div>
      <div class="template-workspace-main" id="template-workspace-main" style="--template-preview-width:${state.ui.templatePreviewWidth}px">
        <div class="template-editor-pane">
          <div class="form-group"><label>Template Name</label><input id="tw-name" value="${esc(draft.name)}" placeholder="e.g. AI Outreach - Intro" oninput="updateTemplateWorkspaceField('name', this.value)" ${isLoading?'disabled':''}></div>
          <div class="form-group"><label>Email Subject</label><input id="tw-subj" value="${esc(draft.subject)}" placeholder="Subject line..." oninput="updateTemplateWorkspaceField('subject', this.value)" ${isLoading?'disabled':''}></div>
          <div class="form-group template-editor-grow"><label>HTML Body <span class="text-muted text-sm">(use {{first_name}}, {{last_name}}, {{name}}, {{email}}, {{company}}, {{unsubscribe_url}}, {{physical_address}})</span></label><textarea id="tw-body" oninput="updateTemplateWorkspaceField('html_body', this.value)" ${isLoading?'disabled':''}>${esc(draft.html_body)}</textarea></div>
          <div class="alert alert-error" id="t-work-err"></div>
        </div>
        <div class="template-splitter" onmousedown="startTemplateResize(event)" title="Resize preview pane"></div>
        <div class="template-preview-pane">
          <div class="template-preview-head">
            <div>
              <div class="template-preview-title">Live Preview</div>
              <div class="template-preview-note">Desktop preview only. Email clients may still differ.</div>
            </div>
          </div>
          <div class="template-preview-canvas">
            <iframe id="template-preview-frame" class="template-preview-frame" sandbox="allow-same-origin"></iframe>
          </div>
        </div>
      </div>
    </section>
  </div>`;
  renderTemplatePreviewPane();
}

function renderTemplatesMobile() {
  const t = state.templates;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${t.length} template${t.length!==1?'s':''}</span></div>
    ${iconButton('refresh', 'Refresh seeded templates', 'refreshSeededTemplates()')}
    <button class="btn btn-primary" onclick="openTemplateModal()">+ New Template</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Name</th><th>Subject</th><th>Updated</th><th style="width:130px">Actions</th></tr></thead><tbody>
    ${t.length ? t.map(r=>`<tr>
      <td data-label="Name" style="font-weight:600">${esc(r.name)}</td>
      <td class="text-muted" data-label="Subject">${esc(r.subject)}</td>
      <td class="text-muted text-sm" data-label="Updated">${fmtDate(r.updated_at)}</td>
      <td data-label="Actions"><div class="table-actions">${iconButton('edit', 'Edit template', `editTemplate('${r.id}')`)}${iconButton('trash', 'Delete template', `deleteTemplate('${r.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No templates yet. Create your first.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openTemplateModal(tmpl) {
  const t = tmpl || { id:'', name:'', subject:'', html_body:'' };
  setModal(`<div class="modal-head"><h3>${t.id?'Edit Template':'New Template'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>Template Name</label><input id="t-name" value="${esc(t.name)}" placeholder="e.g. AI Outreach - Intro"></div>
    <div class="form-group"><label>Email Subject</label><input id="t-subj" value="${esc(t.subject)}" placeholder="Subject line..."></div>
    <div class="form-group"><label>HTML Body <span class="text-muted text-sm">(use {{first_name}}, {{last_name}}, {{name}}, {{email}}, {{company}})</span></label><textarea id="t-body" style="min-height:240px">${esc(t.html_body)}</textarea></div>
    <div class="alert alert-error" id="t-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTemplate('${t.id}')">Save Template</button>
    </div>
  </div>`);
}

async function editTemplate(id) {
  if (isDesktopTemplateWorkspace()) {
    await loadTemplateIntoWorkspace(id, true);
    return;
  }
  const tmpl = await api('GET', `/api/templates/${id}`);
  if (!tmpl?.error) openTemplateModal(tmpl);
}

async function saveTemplate(id) {
  const workspace = !!document.getElementById('tw-name');
  const name = (document.getElementById(workspace ? 'tw-name' : 't-name')?.value || '').trim();
  const subject = (document.getElementById(workspace ? 'tw-subj' : 't-subj')?.value || '').trim();
  const html_body = (document.getElementById(workspace ? 'tw-body' : 't-body')?.value || '').trim();
  const alertId = workspace ? 't-work-err' : 't-err';
  if (!name || !subject || !html_body) { showAlert(alertId,'All fields required'); return; }
  const r = id ? await api('PUT',`/api/templates/${id}`,{name,subject,html_body}) : await api('POST','/api/templates',{name,subject,html_body});
  if (r.error) { showAlert(alertId, r.error); return; }
  if (!workspace) closeModal();
  state.ui.templateDraft = { id: id || r.id || '', name, subject, html_body };
  state.ui.selectedTemplateId = id || r.id || 'new';
  await loadTemplates();
  if (workspace && (id || r.id)) await loadTemplateIntoWorkspace(id || r.id, true);
  else renderTemplates();
}

async function deleteTemplate(id) {
  if (!(await appConfirm('Delete this template?'))) return;
  await api('DELETE',`/api/templates/${id}`);
  await loadTemplates();
  if (isDesktopTemplateWorkspace()) {
    if (state.templates[0]?.id) await loadTemplateIntoWorkspace(state.templates[0].id, true);
    else {
      state.ui.selectedTemplateId = 'new';
      state.ui.templateDraft = createEmptyTemplateDraft();
      state.ui.templateLoading = false;
      renderTemplates();
    }
    return;
  }
  renderTemplates();
}

// ── Contacts ──────────────────────────────────────────────────
function renderContacts(q = state.ui.contactsQuery || '') {
  const ct = state.contacts;
  const selectedTitle = state.ui.contactsTitle || '';
  const selectedTags = (state.ui.crmFilters && state.ui.crmFilters.tags) || state.ui.contactTagFilter || [];
  const titleOptions = Array.from(new Set((state.contacts || []).map(contact => String(contact.title || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (selectedTitle && !titleOptions.includes(selectedTitle)) titleOptions.unshift(selectedTitle);
  const tagOptions = Array.from(new Set((state.contacts || []).flatMap(contact => Array.isArray(contact.tags) ? contact.tags : []).map(tag => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  for (const tag of selectedTags) {
    if (!tagOptions.includes(tag)) tagOptions.unshift(tag);
  }
  const columns = getVisibleContactColumns();
  // Sprint 12: the shared CRM filter model (chips, saved views) and sort.
  const filteredContacts = sortCrmRows(applyCrmFilters(ct));
  const total = filteredContacts.length;
  const pageSize = state.ui.contactsPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(state.ui.contactsPage, totalPages);
  state.ui.contactsPage = page;
  const start = total ? ((page - 1) * pageSize) + 1 : 0;
  const end = Math.min(total, page * pageSize);
  const rows = filteredContacts.slice(start ? start - 1 : 0, end);
  const columnMenu = CONTACT_TABLE_COLUMNS.map(col => `
    <label class="contact-column-option">
      <input type="checkbox" ${columns.includes(col.key) ? 'checked' : ''} onchange="toggleContactColumn('${col.key}', this.checked)">
      <span>${col.label}</span>
    </label>`).join('');
  const headers = columns.map(key => `<th class="th-sort" onclick="crmSort('${key}')">${CONTACT_TABLE_COLUMNS.find(col => col.key === key)?.label || key} ${crmSortIndicator(key)}</th>`).join('');
  const body = rows.length ? rows.map(c => `<tr class="contact-row" onclick="openContactRecord('${c.id}')">
      ${columns.map(key => renderContactTableCell(c, key)).join('')}
      <td data-label="Actions" onclick="event.stopPropagation()">
        <div class="table-actions contact-actions">
          <button class="icon-btn" title="Edit contact" aria-label="Edit contact" onclick="editContact('${c.id}')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.75L19 9.75 14.25 5 4 15.25V20zm12.06-13.94 1.88-1.88a1.5 1.5 0 0 1 2.12 0l1.76 1.76a1.5 1.5 0 0 1 0 2.12l-1.88 1.88-3.88-3.88z"/></svg>
          </button>
          <button class="icon-btn icon-btn-danger" title="Delete contact" aria-label="Delete contact" onclick="deleteContact('${c.id}')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 10h2v8H7v-8zm-1 10h12l1-13H5l1 13z"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('') : `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:var(--muted2);padding:28px">No contacts yet.</td></tr>`;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <input class="search-box" placeholder="Search or use tag:, company:, title: ..." value="${esc(q)}" oninput="queueContactsSearch(this.value)" style="max-width:340px">
    <div class="toolbar-meta" style="flex:1">
      <span class="text-muted text-sm">${total} contact${total!==1?'s':''}</span>
      <span class="text-muted text-sm">${start ? `Showing ${start}-${end}` : 'Showing 0'}</span>
      <label class="text-muted text-sm">Rows
        <select class="contact-page-size" onchange="setContactsPageSize(this.value)">
          ${[10,25,50,100].map(size => `<option value="${size}" ${pageSize===size?'selected':''}>${size}</option>`).join('')}
        </select>
      </label>
    </div>
    <select class="contact-page-size" onchange="setContactsTitleFilter(this.value)" style="min-width:180px">
      <option value="">All Functions</option>
      ${titleOptions.map(title => `<option value="${esc(title)}"${selectedTitle===title?' selected':''}>${esc(title)}</option>`).join('')}
    </select>
    <button class="btn btn-ghost" onclick="toggleContactColumnsMenu()">Columns</button>
    <button class="btn btn-ghost" onclick="openImportModal()">Import CSV</button>
    <button class="btn btn-primary" onclick="openContactModal()">+ Add Contact</button>
  </div>
  <div class="text-muted text-sm" style="margin:-8px 0 12px;line-height:1.6">Examples: <code>tag:luxury</code>, <code>company:lynx</code>, <code>title:&quot;sales agent&quot;</code>. Plain-text auto-search starts after 3 characters.</div>
  ${renderCrmToolbar('table')}
  ${state.ui.contactColumnsOpen ? `<div class="contact-column-panel">${columnMenu}</div>` : ''}
  <div class="table-wrap stack-on-mobile contacts-table-wrap">
    <table class="contacts-table"><thead><tr>${headers}<th style="width:76px">Actions</th></tr></thead><tbody>
    ${body}
    </tbody></table>
  </div>
  <div class="pagination-bar">
    <div class="pagination-meta">Page ${page} of ${totalPages}</div>
    <div class="pagination-actions">
      ${iconButton('stepback', 'Previous page', `setContactsPage(${page - 1})`, 'ghost', { disabled: page <= 1 })}
      ${iconButton('stepforward', 'Next page', `setContactsPage(${page + 1})`, 'ghost', { disabled: page >= totalPages })}
    </div>
  </div>`;
}

function renderContactTableCell(contact, key) {
  if (key === 'contact') {
    const name = getContactDisplayName(contact);
    const secondary = [contact.title, contact.phone || contact.email || '-'].map(value => String(value || '').trim()).filter(Boolean).join(' | ');
    return `<td data-label="Contact">
      <div class="contact-cell">
        ${renderContactAvatar(contact)}
        <div class="contact-copy">
          <div class="contact-primary">${esc(name)}</div>
          <div class="contact-secondary">${esc(secondary)}</div>
        </div>
      </div>
    </td>`;
  }
  if (key === 'email') return `<td data-label="Email" class="mono contact-email">${esc(contact.email || '-')}</td>`;
  if (key === 'title') return `<td data-label="Title" class="text-muted">${esc(contact.title || '-')}</td>`;
  if (key === 'company') return `<td data-label="Company" class="text-muted">${esc(contact.company || '-')}</td>`;
  if (key === 'phone') return `<td data-label="Phone">${esc(contact.phone || '-')}</td>`;
  if (key === 'stage') return `<td data-label="Stage"><span class="badge badge-${esc(contact.stage || 'draft')}">${esc(STAGE_LABELS?.[contact.stage] || contact.stage || 'Lead')}</span></td>`;
  if (key === 'added') return `<td data-label="Added" class="text-muted text-sm">${fmtDateShort(contact.created_at)}</td>`;
  if (key === 'deal_value') return `<td data-label="Open deals" class="text-sm">${contact.open_deal_value > 0 ? `${fmtCurrency(contact.open_deal_value)}${contact.open_deal_count > 1 ? ` <span class="text-muted">(${contact.open_deal_count})</span>` : ''}` : '<span class="text-muted">-</span>'}</td>`;
  if (key === 'follow_up') return `<td data-label="Follow-up" class="text-sm ${contact.follow_up_at && isOverdue(contact.follow_up_at) ? 'board-overdue' : ''}">${contact.follow_up_at ? fmtDateShort(contact.follow_up_at) : '<span class="text-muted">-</span>'}</td>`;
  if (key === 'last_contacted') return `<td data-label="Last contacted" class="text-muted text-sm">${contact.last_contacted_at ? fmtDateShort(contact.last_contacted_at) : 'Never'}</td>`;
  return `<td data-label="${esc(key)}">-</td>`;
}

function queueContactsSearch(q) {
  state.ui.contactsQuery = q;
  if (contactsSearchTimer) clearTimeout(contactsSearchTimer);
  const trimmed = String(q || '').trim();
  const hasOperator = /\b(tag|company|title):/i.test(trimmed);
  if (!trimmed) {
    contactsSearchTimer = setTimeout(() => {
      contactsSearchTimer = null;
      searchContacts('');
    }, 80);
    return;
  }
  if (!hasOperator && trimmed.length < 3) return;
  contactsSearchTimer = setTimeout(() => {
    contactsSearchTimer = null;
    searchContacts(q);
  }, 250);
}

async function searchContacts(q) {
  state.ui.contactsPage = 1;
  await loadContacts(q, state.ui.contactsTitle);
  renderContacts(q);
}

async function setContactsTitleFilter(title) {
  state.ui.contactsPage = 1;
  await loadContacts(state.ui.contactsQuery, title);
  renderContacts(state.ui.contactsQuery);
}

function toggleContactTagsMenu() {
  state.ui.contactTagsOpen = !state.ui.contactTagsOpen;
  renderContacts(state.ui.contactsQuery);
}

// Tag filtering lives in the shared CRM filter model since sprint 12.
function toggleContactTagFilter(tag, checked) { crmSetTag(tag, checked); }
function clearContactTagFilter() { crmSetTag('', false); state.ui.crmFilters.tags = []; state.ui.contactTagFilter = []; renderContacts(state.ui.contactsQuery); }

function toggleContactColumnsMenu() {
  state.ui.contactColumnsOpen = !state.ui.contactColumnsOpen;
  renderContacts(state.ui.contactsQuery);
}

function toggleContactColumn(key, checked) {
  const next = checked
    ? Array.from(new Set([...state.ui.contactColumns, key]))
    : state.ui.contactColumns.filter(item => item !== key);
  state.ui.contactColumns = next.length ? next : ['contact'];
  localStorage.setItem(CONTACT_COLUMNS_KEY, JSON.stringify(state.ui.contactColumns));
  renderContacts(state.ui.contactsQuery);
}

function setContactsPage(page) {
  const totalPages = Math.max(1, Math.ceil(state.contacts.length / state.ui.contactsPageSize));
  state.ui.contactsPage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  renderContacts(state.ui.contactsQuery);
}

function setContactsPageSize(value) {
  const next = [10, 25, 50, 100].includes(Number(value)) ? Number(value) : CONTACT_PAGE_SIZE_DEFAULT;
  state.ui.contactsPageSize = next;
  state.ui.contactsPage = 1;
  localStorage.setItem(CONTACT_PAGE_SIZE_KEY, String(next));
  renderContacts(state.ui.contactsQuery);
}

function openContactModal(c, options = {}) {
  const ct = normalizeContactRecord(c || { id:'', email:'', name:'', first_name:'', last_name:'', title:'', company:'', phone:'', linkedin:'', image_url:'' });
  state.ui.contactModalBase = ct;
  state.ui.contactModalReturnId = options.returnToDrawer || '';
  setModal(`<div class="modal-head"><h3>${ct.id?'Edit Contact':'Add Contact'}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="contact-upload-row">
      <div id="contact-image-preview">${renderContactAvatar(ct, true)}</div>
      <div style="flex:1">
        <div class="form-group" style="margin-bottom:10px">
          <label>Contact Image</label>
          <input id="c-image-url" type="hidden" value="${esc(ct.image_url || '')}">
          <input type="file" id="c-image-file" accept="image/*" style="display:none" onchange="readContactImage(this)">
          <div class="flex gap">
            ${iconButton('image', 'Upload image', 'triggerContactImageUpload()')}
            ${iconButton('trash', 'Remove image', 'clearContactImage()', 'ghost', { extraClass: 'icon-btn-danger' })}
          </div>
        </div>
        <div class="text-muted text-sm">Image is optional. A small headshot or agency photo works best.</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Email *</label><input id="c-email" type="email" value="${esc(ct.email)}" placeholder="contact@example.com" ${ct.id?'readonly':''} oninput="refreshContactImagePreview()"></div>
      <div class="form-group"><label>Phone</label><input id="c-phone" value="${esc(ct.phone || '')}" placeholder="0400 000 000"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>First Name</label><input id="c-first-name" value="${esc(ct.first_name || '')}" placeholder="First name" oninput="refreshContactImagePreview()"></div>
      <div class="form-group"><label>Last Name</label><input id="c-last-name" value="${esc(ct.last_name || '')}" placeholder="Last name" oninput="refreshContactImagePreview()"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Title</label><input id="c-title" value="${esc(ct.title || '')}" placeholder="Sales Agent"></div>
      <div class="form-group"><label>Company</label><input id="c-company" value="${esc(ct.company)}" placeholder="Company name"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Stage</label>
        <select id="c-stage">
          ${STAGE_ORDER.map(stage => `<option value="${stage}" ${(ct.stage || 'lead') === stage ? 'selected' : ''}>${esc(STAGE_LABELS[stage] || stage)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Tags</label>
      <input id="c-tags" value="${esc((ct.tags || []).join(', '))}" placeholder="luxury, qld, replied, source:csv">
      <div class="text-muted text-sm" style="margin-top:6px">Separate multiple tags with commas.</div>
    </div>
    <div class="form-group"><label>LinkedIn URL</label><input id="c-linkedin" value="${esc(ct.linkedin || '')}" placeholder="https://www.linkedin.com/in/..."></div>
    <div class="alert alert-error" id="c-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      ${ct.id ? '' : '<button class="btn btn-ghost" onclick="closeModal();openImportModal()">Bulk Import CSV</button>'}
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveContact('${ct.id}')">Save</button>
    </div>
  </div>`);
}

function editContact(id) {
  const contact = state.contacts.find(item => item.id === id);
  if (!contact) return;
  openContactModal(contact);
}

async function saveContact(id) {
  const email = document.getElementById('c-email')?.value.trim();
  const first_name = document.getElementById('c-first-name').value.trim();
  const last_name = document.getElementById('c-last-name').value.trim();
  const name = composeContactName(first_name, last_name);
  const title = document.getElementById('c-title').value.trim();
  const company = document.getElementById('c-company').value.trim();
  const stage = document.getElementById('c-stage')?.value || 'lead';
  const tags = parseTagInput(document.getElementById('c-tags')?.value || '');
  const phone = document.getElementById('c-phone').value.trim();
  const linkedin = document.getElementById('c-linkedin').value.trim();
  const image_url = document.getElementById('c-image-url').value.trim();
  const base = state.ui.contactModalBase || {};
  let r;
  if (id) {
    r = await api('PUT',`/api/contacts/${id}`,{
      name,
      first_name,
      last_name,
      title,
      company,
      stage,
      tags,
      phone,
      linkedin,
      follow_up_at: base.follow_up_at || null,
      image_url
    });
  } else {
    if (!email) { showAlert('c-err','Email required'); return; }
    r = await api('POST','/api/contacts',{ email, name, first_name, last_name, title, company, stage, tags, phone, linkedin, image_url });
  }
  if (r.error) { showAlert('c-err', r.error); return; }
  const returnId = state.ui.contactModalReturnId;
  closeModal();
  state.ui.contactModalBase = null;
  state.ui.contactModalReturnId = '';
  await loadContacts(state.ui.contactsQuery);
  if (currentSection === 'contacts') renderContacts(state.ui.contactsQuery);
  if (currentSection === 'pipeline') { await Promise.all([loadDeals(), loadDealStats(), loadCrmStats()]); renderPipeline(); }
  if (currentSection === 'overview') { await loadOverview(); renderOverview(); }
  if (currentSection === 'contact' && typeof renderContactRecord === 'function') { renderContactRecord(state.ui.crmContactId); return; }
  if (currentSection === 'company' && typeof renderCompanyRecord === 'function') { renderCompanyRecord(state.ui.crmCompanyId); return; }
  if (returnId) openDrawer(returnId);
}

async function deleteContact(id) {
  if (!(await appConfirm('Delete this contact?'))) return;
  await api('DELETE',`/api/contacts/${id}`);
  await loadContacts(state.ui.contactsQuery);
  renderContacts(state.ui.contactsQuery);
}

async function openImportModal() {
  if (!Array.isArray(state.lists) || !state.lists.length) {
    try { await loadLists(); } catch { state.lists = []; }
  }
  const lists = Array.isArray(state.lists) ? state.lists : [];
  const stageList = STAGE_ORDER.map(stage => `<code>${stage}</code>`).join(', ');
  const defaultBatchTag = `import:${new Date().toISOString().slice(0, 10)}`;
  const listOptions = lists.length
    ? `<option value="">Do not add to a list</option>${lists.map(list => `<option value="${list.id}">${esc(list.name)} (${list.cnt || 0} contacts)</option>`).join('')}`
    : '<option value="">No lists available yet</option>';
  setModal(`<div class="modal-head"><h3>Import Contacts (CSV)</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div style="margin-bottom:14px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2)">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">How CSV Import Works</div>
      <div class="text-muted text-sm" style="line-height:1.7">
        <div><strong>Required:</strong> <code>email</code></div>
        <div><strong>Optional:</strong> <code>first_name</code>, <code>last_name</code>, <code>name</code>, <code>title</code>, <code>company</code>, <code>phone</code>, <code>stage</code>, <code>deal_value</code>, <code>image_url</code></div>
        <div>If you provide <code>first_name</code> and <code>last_name</code>, the full <code>name</code> is built automatically during import.</div>
        <div>If you already have a single <code>name</code> column, that still works.</div>
        <div>Imported contacts are automatically tagged with <code>source:csv</code> plus your batch/import tags.</div>
        <div>Valid stage values: ${stageList}</div>
      </div>
    </div>
    <div class="form-group">
      <label>Example CSV Template</label>
      <textarea readonly style="min-height:110px;font-family:var(--font-mono);font-size:12px;opacity:.9">${esc(CONTACT_IMPORT_SAMPLE_CSV)}</textarea>
    </div>
    <div class="flex gap" style="margin:-4px 0 14px">
      <button class="btn btn-ghost btn-sm" onclick="loadContactImportExample()">Load Example Into Import Box</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadContactImportTemplate()">Download Example CSV</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Batch Tag</label><input id="csv-batch-tag" value="${esc(defaultBatchTag)}" placeholder="import:2026-03-27"></div>
      <div class="form-group"><label>Extra Tags</label><input id="csv-extra-tags" placeholder="luxury, qld, scraped"></div>
    </div>
    <div class="form-group">
      <label>Add Imported Contacts To Existing List</label>
      <select id="csv-list-id">${listOptions}</select>
    </div>
    <div class="form-group">
      <label>Or Create New List During Import</label>
      <input id="csv-new-list-name" placeholder="e.g. Luxury Agencies March 2026">
      <div class="text-muted text-sm" style="margin-top:6px;line-height:1.6">If you enter a new list name here, it will be created automatically and used instead of the selected list above.</div>
    </div>
    <div class="form-group"><label>Paste CSV or upload file</label>
      <textarea id="csv-data" placeholder="email,first_name,last_name,title,company,phone&#10;john@example.com,John,Smith,Sales Agent,Acme Corp,0400 000 000" style="min-height:180px"></textarea>
    </div>
    <input type="file" id="csv-file" accept=".csv" style="display:none" onchange="readCsv(this)">
    <div class="flex gap" style="margin-bottom:12px"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('csv-file').click()">Upload CSV file</button></div>
    <div class="alert alert-error" id="imp-err"></div>
    <div class="alert alert-success" id="imp-ok"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doImport()">Import</button>
    </div>
  </div>`);
}

function readCsv(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => { document.getElementById('csv-data').value = e.target.result; };
  r.readAsText(f);
}

function loadContactImportExample() {
  const input = document.getElementById('csv-data');
  if (input) input.value = CONTACT_IMPORT_SAMPLE_CSV;
}

function downloadContactImportTemplate() {
  const blob = new Blob([CONTACT_IMPORT_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'contacts-import-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function doImport() {
  const csv = document.getElementById('csv-data').value.trim();
  const batch_tag = document.getElementById('csv-batch-tag')?.value.trim() || '';
  const list_id = document.getElementById('csv-list-id')?.value || '';
  const new_list_name = document.getElementById('csv-new-list-name')?.value.trim() || '';
  const extra_tags = (document.getElementById('csv-extra-tags')?.value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
  if (!csv) { showAlert('imp-err','Paste CSV data first'); return; }
  const r = await api('POST','/api/contacts/import',{csv, batch_tag, extra_tags, list_id, new_list_name});
  if (r.error) { showAlert('imp-err',r.error); return; }
  const listNote = r.list_name ? `, linked ${r.linked || 0} to ${r.list_name}` : '';
  showAlert('imp-ok',`Imported ${r.imported} contacts, skipped ${r.skipped}${listNote}`,'alert-success');
  state.ui.contactsPage = 1;
  await Promise.all([
    loadContacts(state.ui.contactsQuery),
    list_id ? loadLists() : Promise.resolve()
  ]);
  if (currentSection === 'contacts') renderContacts(state.ui.contactsQuery);
  if (currentSection === 'lists') renderLists();
}

function triggerContactImageUpload() {
  document.getElementById('c-image-file')?.click();
}

function clearContactImage() {
  const imageInput = document.getElementById('c-image-url');
  if (imageInput) imageInput.value = '';
  refreshContactImagePreview();
}

function refreshContactImagePreview() {
  const preview = document.getElementById('contact-image-preview');
  if (!preview) return;
  const contact = {
    first_name: document.getElementById('c-first-name')?.value || '',
    last_name: document.getElementById('c-last-name')?.value || '',
    title: document.getElementById('c-title')?.value || '',
    email: document.getElementById('c-email')?.value || '',
    image_url: document.getElementById('c-image-url')?.value || ''
  };
  preview.innerHTML = renderContactAvatar(contact, true);
}

function readContactImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 320;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/jpeg', 0.82);
      const imageInput = document.getElementById('c-image-url');
      if (imageInput) imageInput.value = value;
      refreshContactImagePreview();
    };
    img.src = event.target?.result;
  };
  reader.readAsDataURL(file);
}

// ── Lists ─────────────────────────────────────────────────────
function renderLists() {
  const ls = state.lists;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div style="flex:1"></div>
    <button class="btn btn-primary" onclick="openListModal()">+ New List</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>List Name</th><th>Description</th><th>Members</th><th>Created</th><th style="width:220px">Actions</th></tr></thead><tbody>
    ${ls.length ? ls.map(l=>`<tr>
      <td data-label="List" style="font-weight:600">${esc(l.name)}</td>
      <td class="text-muted" data-label="Description">${esc(l.description)||'-'}</td>
      <td data-label="Members"><span class="badge badge-active">${l.cnt||0}</span></td>
      <td class="text-muted text-sm" data-label="Created">${fmtDate(l.created_at)}</td>
      <td data-label="Actions"><div class="table-actions">${iconButton('settings', 'Manage list', `viewList('${l.id}','${l.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')`)}
${iconButton('edit', 'Edit list', `openListModal('${l.id}')`)}${iconButton('trash', 'Delete list', `deleteList('${l.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No lists yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

function openListModal(id = '') {
  const list = id ? state.lists.find(item => item.id === id) : null;
  listEditingId = list?.id || '';
  const title = list ? 'Edit Contact List' : 'New Contact List';
  const submitLabel = list ? 'Save Changes' : 'Create List';
  setModal(`<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-group"><label>List Name *</label><input id="l-name" value="${esc(list?.name || '')}" placeholder="e.g. AI Startup Founders"></div>
    <div class="form-group"><label>Description</label><input id="l-desc" value="${esc(list?.description || '')}" placeholder="Optional description"></div>
    <div class="alert alert-error" id="l-err"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveList()">${submitLabel}</button>
    </div>
  </div>`);
}

async function saveList() {
  const name = document.getElementById('l-name').value.trim();
  const description = document.getElementById('l-desc').value.trim();
  if (!name) { showAlert('l-err','Name required'); return; }
  const method = listEditingId ? 'PUT' : 'POST';
  const path = listEditingId ? `/api/lists/${listEditingId}` : '/api/lists';
  const r = await api(method, path, {name,description});
  if (r.error) { showAlert('l-err',r.error); return; }
  listEditingId = '';
  closeModal(); await loadLists(); renderLists();
}

async function deleteList(id) {
  if (!(await appConfirm('Delete this list?'))) return;
  await api('DELETE',`/api/lists/${id}`);
  await loadLists(); renderLists();
}

async function viewList(id, name, options = {}) {
  if (!state.contacts.length) await loadContacts('', '');
  if (!state.lists.length) await loadLists();
  const rawMembers = await api('GET',`/api/lists/${id}/contacts`) || [];
  state.ui.listModalId = id;
  state.ui.listModalName = name;
  state.ui.listModalMembers = Array.isArray(rawMembers) ? rawMembers.map(normalizeContactRecord) : [];
  if (!options.preserveFilters) {
    state.ui.listModalSearch = '';
    state.ui.listModalOnlyUnlisted = false;
    state.ui.listModalOnlyUntagged = false;
  }
  renderListManager();
}

function getAvailableListContacts() {
  const members = state.ui.listModalMembers || [];
  const memberIds = new Set(members.map(m => m.id));
  let available = (state.contacts || []).filter(c => !memberIds.has(c.id));
  const q = String(state.ui.listModalSearch || '').trim().toLowerCase();
  if (state.ui.listModalOnlyUnlisted) {
    available = available.filter(contact => !(contact.list_names || []).length);
  }
  if (state.ui.listModalOnlyUntagged) {
    available = available.filter(contact => !(contact.tags || []).length);
  }
  if (q) {
    available = available.filter(contact => [
      contact.name,
      contact.email,
      contact.company,
      contact.title,
      ...(contact.list_names || []),
      ...(contact.tags || [])
    ].map(value => String(value || '').toLowerCase()).join(' ').includes(q));
  }
  return available;
}

function renderListManager() {
  const id = state.ui.listModalId;
  const name = state.ui.listModalName;
  const members = state.ui.listModalMembers || [];
  const available = getAvailableListContacts();
  const onlyUnlisted = !!state.ui.listModalOnlyUnlisted;
  const onlyUntagged = !!state.ui.listModalOnlyUntagged;
  setModal(`<div class="modal-head"><h3>List: ${esc(name)}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div style="margin-bottom:16px">
      <label style="font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.7px;display:block;margin-bottom:6px">Find contacts to add</label>
      <div class="flex gap" style="align-items:center;flex-wrap:wrap">
        <input class="search-box" style="max-width:none;flex:1;min-width:220px" placeholder="Search by contact, company, email, list, or tag..." value="${esc(state.ui.listModalSearch || '')}" oninput="setListModalSearch(this.value)">
        <button class="btn btn-ghost ${onlyUnlisted ? 'btn-active' : ''}" type="button" onclick="toggleListModalFilter('unlisted')">No Lists</button>
        <button class="btn btn-ghost ${onlyUntagged ? 'btn-active' : ''}" type="button" onclick="toggleListModalFilter('untagged')">No Tags</button>
      </div>
      <div class="text-muted text-sm" style="margin-top:8px">${available.length} available contact${available.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="table-wrap stack-on-mobile">
      <table><thead><tr><th>Contact</th><th>Company</th><th>Lists</th><th>Tags</th><th></th></tr></thead>
      <tbody id="list-members">
      ${available.length ? available.slice(0, 150).map(c=>`<tr>
        <td data-label="Contact">
          <div class="contact-cell">
            ${renderContactAvatar(c)}
            <div class="contact-copy">
              <div class="contact-primary">${esc(getContactDisplayName(c))}</div>
              <div class="contact-secondary">${esc(c.email || '-')}</div>
            </div>
          </div>
        </td>
        <td class="text-muted" data-label="Company">${esc(c.company || c.title || '-')}</td>
        <td data-label="Lists">${(c.list_names || []).length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${c.list_names.slice(0, 3).map(listName => `<span class="tag">${esc(listName)}</span>`).join('')}${c.list_names.length > 3 ? `<span class="tag">+${c.list_names.length - 3}</span>` : ''}</div>` : '<span class="text-muted text-sm">None</span>'}</td>
        <td data-label="Tags">${(c.tags || []).length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${c.tags.slice(0, 3).map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}${c.tags.length > 3 ? `<span class="tag">+${c.tags.length - 3}</span>` : ''}</div>` : '<span class="text-muted text-sm">None</span>'}</td>
        <td data-label="Actions"><div class="table-actions">${iconButton('plus', 'Add to list', `addContactToList('${id}','${c.id}')`, 'primary')}</div></td>
      </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:24px">No matching contacts available.</td></tr>'}
      </tbody></table>
    </div>
    ${available.length > 150 ? `<div class="text-muted text-sm" style="margin-top:10px">Showing first 150 matches. Narrow the search to refine the list.</div>` : ''}
    <div style="margin:18px 0 8px;font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.7px">Current Members</div>
    <div class="table-wrap stack-on-mobile">
      <table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th></th></tr></thead>
      <tbody id="list-members-current">
      ${members.length ? members.map(m=>`<tr><td class="mono" data-label="Email" style="font-size:12px">${esc(m.email)}</td><td data-label="Name">${esc(m.name)||'-'}</td><td class="text-muted" data-label="Company">${esc(m.company)||'-'}</td><td data-label="Actions"><div class="table-actions">${iconButton('trash', 'Remove from list', `removeFromList('${id}','${m.id}','${esc(name)}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div></td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:24px">No members yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>`);
}

function setListModalSearch(value) {
  state.ui.listModalSearch = value;
  renderListManager();
}

function toggleListModalFilter(kind) {
  if (kind === 'unlisted') state.ui.listModalOnlyUnlisted = !state.ui.listModalOnlyUnlisted;
  if (kind === 'untagged') state.ui.listModalOnlyUntagged = !state.ui.listModalOnlyUntagged;
  renderListManager();
}

async function addContactToList(listId, cid = '') {
  const contactId = cid || document.getElementById('add-contact')?.value;
  if (!contactId) return;
  await api('POST',`/api/lists/${listId}/contacts`,{contact_ids:[contactId]});
  await Promise.all([loadLists(), loadContacts(state.ui.contactsQuery, state.ui.contactsTitle)]);
  const list = state.lists.find(l=>l.id===listId);
  await viewList(listId, list?.name||'', { preserveFilters: true });
  if (currentSection === 'lists') renderLists();
}

async function removeFromList(listId, contactId, name) {
  await api('DELETE',`/api/lists/${listId}/contacts/${contactId}`);
  await Promise.all([loadLists(), loadContacts(state.ui.contactsQuery, state.ui.contactsTitle)]);
  const list = state.lists.find(l=>l.id===listId);
  await viewList(listId, list?.name||name, { preserveFilters: true });
  if (currentSection === 'lists') renderLists();
}

// ── Campaigns ─────────────────────────────────────────────────
function renderCampaigns() {
  const cs = state.campaigns;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${cs.length} campaign${cs.length!==1?'s':''}</span></div>
    <button class="btn btn-primary" onclick="openCampaignModal()">+ New Campaign</button>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Name</th><th>List</th><th>Type</th><th>Status</th><th style="width:260px">Actions</th></tr></thead><tbody>
    ${cs.length ? cs.map(c=>`<tr>
      <td data-label="Name" style="font-weight:600">${esc(c.name)}</td>
      <td class="text-muted" data-label="List">${esc(c.list_name||'-')}</td>
      <td data-label="Type"><span class="badge badge-draft" style="background:rgba(0,200,255,.08);color:var(--cyan)">${c.schedule_type}</span></td>
      <td data-label="Status"><span class="badge badge-${c.status}">${c.status}</span></td>
      <td data-label="Actions"><div class="table-actions">
        ${iconButton('settings', 'Manage campaign', `openCampaignModal('${c.id}')`)}
        ${iconButton('copy', 'Copy campaign', `copyCampaign('${c.id}')`)}
        ${c.status==='active'?iconButton('pause', 'Pause campaign', `setCampaignStatus('${c.id}','pause')`):''}
        ${c.status==='paused'||c.status==='draft'?iconButton('play', 'Activate campaign', `setCampaignStatus('${c.id}','activate')`, 'success'):''}
        ${iconButton('send', 'Send campaign now', `sendCampaignNow('${c.id}','${esc(c.name)}')`, 'primary')}
        ${iconButton('trash', 'Delete campaign', `deleteCampaign('${c.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted2);padding:32px">No campaigns yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

let campaignSteps = [{ template_id: '', delay_days: 0 }];

function openCampaignModal(id = '') {
  const campaign = id ? state.campaigns.find(item => item.id === id) : null;
  campaignModalMode = campaign ? 'edit' : 'create';
  campaignEditingId = campaign?.id || '';
  campaignScheduleDraft = { ...(campaign?.schedule_config || {}) };
  campaignSteps = campaign?.steps?.length
    ? campaign.steps.map(step => ({ template_id: step.template_id, delay_days: step.delay_days || 0 }))
    : [{ template_id: '', delay_days: 0 }];
  renderCampaignModal();
}

function copyCampaign(id) {
  const campaign = state.campaigns.find(item => item.id === id);
  if (!campaign) return;
  campaignModalMode = 'copy';
  campaignEditingId = '';
  campaignScheduleDraft = { ...(campaign.schedule_config || {}) };
  campaignSteps = campaign.steps?.length
    ? campaign.steps.map(step => ({ template_id: step.template_id, delay_days: step.delay_days || 0 }))
    : [{ template_id: '', delay_days: 0 }];
  renderCampaignModal({
    ...campaign,
    id: '',
    name: campaign.name ? `${campaign.name} Copy` : 'Campaign Copy'
  });
}

function renderCampaignModal(campaignOverride = null) {
  const campaign = campaignOverride || (campaignEditingId ? state.campaigns.find(item => item.id === campaignEditingId) : null);
  const title = campaignModalMode === 'edit' ? 'Manage Campaign' : campaignModalMode === 'copy' ? 'Copy Campaign' : 'New Campaign';
  const submitLabel = campaignModalMode === 'edit' ? 'Save Changes' : campaignModalMode === 'copy' ? 'Create Copy' : 'Create Campaign';
  const tOpts = state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const lOpts = state.lists.map(l=>`<option value="${l.id}"${campaign?.list_id===l.id?' selected':''}>${esc(l.name)} (${l.cnt||0} contacts)</option>`).join('');
  setModal(`<div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label>Campaign Name *</label><input id="ca-name" value="${esc(campaign?.name || '')}" placeholder="e.g. AI Outreach Q2"></div>
      <div class="form-group"><label>Contact List *</label><select id="ca-list"><option value="">- Select list -</option>${lOpts}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>From Name</label><input id="ca-from-name" value="${esc(campaign?.from_name || 'Nick | 365Soft Labs')}" placeholder="Sender name"></div>
      <div class="form-group"><label>From Email</label><input id="ca-from-email" value="${esc(campaign?.from_email || 'nick@365softlabs.com')}" placeholder="sender@example.com"></div>
    </div>
    <div class="form-group"><label>Schedule Type *</label>
      <select id="ca-type" onchange="renderScheduleFields()">
        <option value="immediate"${campaign?.schedule_type==='immediate'?' selected':''}>Send Immediately (on demand)</option>
        <option value="once"${campaign?.schedule_type==='once'?' selected':''}>Send Once - at a specific time</option>
        <option value="recurring"${campaign?.schedule_type==='recurring'?' selected':''}>Recurring - daily or weekly</option>
        <option value="drip"${campaign?.schedule_type==='drip'?' selected':''}>Drip Sequence - staggered multi-email</option>
      </select>
    </div>
    <div id="schedule-fields"></div>
    <div class="form-group" style="margin-top:4px">
      <label>Email Steps <span style="display:inline-flex;vertical-align:middle;margin-left:8px">${iconButton('plus', 'Add step', 'addStep()')}</span></label>
      <div class="steps-list" id="steps-list">${renderSteps(tOpts)}</div>
    </div>
    <div class="alert alert-error" id="ca-err"></div>
    <div class="flex gap" style="justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCampaign()">${submitLabel}</button>
    </div>
  </div>`);
  renderScheduleFields();
}

function renderScheduleFields() {
  const type = document.getElementById('ca-type')?.value;
  const c = document.getElementById('schedule-fields');
  if (!c) return;
  if (type === 'once') {
    c.innerHTML = `<div class="form-group"><label>Send At</label><input type="datetime-local" id="sch-send-at"></div>`;
    document.getElementById('sch-send-at').value = toDateTimeLocalValue(campaignScheduleDraft.send_at);
  } else if (type === 'recurring') {
    c.innerHTML = `<div class="form-row"><div class="form-group"><label>First Send</label><input type="datetime-local" id="sch-send-at"></div><div class="form-group"><label>Repeat every (days)</label><input type="number" id="sch-interval" value="7" min="1"></div></div>`;
    document.getElementById('sch-send-at').value = toDateTimeLocalValue(campaignScheduleDraft.next_run);
    document.getElementById('sch-interval').value = String(parseInt(campaignScheduleDraft.interval_days, 10) || 7);
  } else {
    c.innerHTML = '';
  }
}

function renderSteps(tOpts) {
  return campaignSteps.map((s,i)=>`<div class="step-item">
    <div class="step-num">${i+1}</div>
    <div style="flex:1">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group" style="margin-bottom:0"><label>Template</label><select onchange="campaignSteps[${i}].template_id=this.value"><option value="">- Select -</option>${tOpts.replace('value="'+s.template_id+'"','value="'+s.template_id+'" selected')}</select></div>
        <div class="form-group" style="margin-bottom:0"><label>${i===0?'Send immediately':'Delay (days after prev)' }</label><input type="number" value="${s.delay_days}" min="0" onchange="campaignSteps[${i}].delay_days=parseInt(this.value)||0" ${i===0?'disabled':''}></div>
      </div>
    </div>
    ${campaignSteps.length>1?iconButton('trash', 'Remove step', `removeStep(${i})`, 'ghost', { extraClass: 'icon-btn-danger' }):''}
  </div>`).join('');
}

function addStep() { campaignSteps.push({ template_id:'', delay_days:1 }); refreshSteps(); }
function removeStep(i) { campaignSteps.splice(i,1); refreshSteps(); }
function refreshSteps() {
  const tOpts = state.templates.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  document.getElementById('steps-list').innerHTML = renderSteps(tOpts);
}

async function saveCampaign() {
  const name = document.getElementById('ca-name').value.trim();
  const list_id = document.getElementById('ca-list').value;
  const schedule_type = document.getElementById('ca-type').value;
  const from_name = document.getElementById('ca-from-name').value.trim();
  const from_email = document.getElementById('ca-from-email').value.trim();
  if (!name || !list_id) { showAlert('ca-err','Campaign name and list are required'); return; }
  // Sync template selections from selects
  document.querySelectorAll('#steps-list select').forEach((sel,i)=>{ if(campaignSteps[i]) campaignSteps[i].template_id=sel.value; });
  if (campaignSteps.some(s=>!s.template_id)) { showAlert('ca-err','All steps need a template selected'); return; }
  let schedule_config = {};
  if (schedule_type==='once') {
    const sa = document.getElementById('sch-send-at')?.value;
    if (!sa) { showAlert('ca-err','Select a send time'); return; }
    schedule_config = { send_at: new Date(sa).toISOString() };
  } else if (schedule_type==='recurring') {
    const sa = document.getElementById('sch-send-at')?.value;
    const interval = parseInt(document.getElementById('sch-interval')?.value)||7;
    if (!sa) { showAlert('ca-err','Select a first send time'); return; }
    schedule_config = { next_run: new Date(sa).toISOString(), interval_days: interval };
  }
  const method = campaignEditingId ? 'PUT' : 'POST';
  const path = campaignEditingId ? `/api/campaigns/${campaignEditingId}` : '/api/campaigns';
  const r = await api(method, path, {name,list_id,schedule_type,schedule_config,steps:campaignSteps,from_name,from_email});
  if (r.error) { showAlert('ca-err',r.error); return; }
  campaignEditingId = '';
  campaignModalMode = 'create';
  campaignScheduleDraft = {};
  closeModal(); await loadCampaigns(); renderCampaigns();
}

async function sendCampaignNow(id, name) {
  if (!(await appConfirm(`Send campaign "${name}" to all contacts in the list right now?`, { title: 'Send campaign', confirmText: 'Send now' }))) return;
  const r = await api('POST',`/api/campaigns/${id}/send`);
  if (r.error) { toastError('Error: '+r.error); return; }
  toastSuccess(`Done! Sent: ${r.sent}, Skipped (unsubscribed): ${r.skipped||0}, Failed: ${r.failed}`);
  await loadCampaigns(); renderCampaigns();
}

async function setCampaignStatus(id, action) {
  await api('POST',`/api/campaigns/${id}/${action}`);
  await loadCampaigns(); renderCampaigns();
}

async function deleteCampaign(id) {
  if (!(await appConfirm('Delete this campaign?'))) return;
  await api('DELETE',`/api/campaigns/${id}`);
  await loadCampaigns(); renderCampaigns();
}

// ── Logs ──────────────────────────────────────────────────────
function renderLogs() {
  const l = state.logs;
  document.getElementById('content').innerHTML = `
  <div class="toolbar"><div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${l.length} entries</span></div></div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Recipient</th><th>Subject</th><th>Campaign</th><th>Template</th><th>Status</th><th>Sent At</th></tr></thead><tbody>
    ${l.length ? l.map(r=>`<tr>
      <td class="mono" data-label="Recipient" style="font-size:12px">${esc(r.contact_email)}</td>
      <td data-label="Subject" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.subject||'-')}</td>
      <td class="text-muted" data-label="Campaign">${esc(r.campaign_name||'-')}</td>
      <td class="text-muted" data-label="Template">${esc(r.template_name||'-')}</td>
      <td data-label="Status"><span class="badge badge-${r.status}">${r.status}${r.error?'<span title="'+esc(r.error)+'" style="cursor:help;margin-left:4px">(i)</span>':''}</span></td>
      <td class="text-muted text-sm" data-label="Sent At">${fmtDate(r.sent_at)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:32px">No sent emails yet.</td></tr>'}
    </tbody></table>
  </div>`;
}

// ── Unsubscribes ──────────────────────────────────────────────
function renderUnsubs() {
  const u = state.unsubs;
  document.getElementById('content').innerHTML = `
  <div class="toolbar">
    <div class="toolbar-meta" style="flex:1"><span class="text-muted text-sm">${u.length} unsubscribed</span></div>
    <span class="text-muted text-sm" style="font-style:italic">Managed by the email worker. <a href="https://365soft-email-worker.nick-598.workers.dev/unsubscribe" target="_blank" style="color:var(--cyan)">Open unsubscribe page</a></span>
  </div>
  <div class="table-wrap stack-on-mobile">
    <table><thead><tr><th>Email</th><th>Unsubscribed At</th><th>IP</th><th>Source</th></tr></thead><tbody>
    ${u.length ? u.map(c=>`<tr>
      <td class="mono" data-label="Email" style="font-size:12px">${esc(c.email)}</td>
      <td class="text-muted text-sm" data-label="Unsubscribed At">${fmtDate(c.unsubscribedAt||c.unsubscribed_at)}</td>
      <td class="text-muted text-sm mono" data-label="IP">${esc(c.ip||'-')}</td>
      <td class="text-muted text-sm" data-label="Source">${esc(c.source||'-')}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted2);padding:32px">No unsubscribes.</td></tr>'}
    </tbody></table>
  </div>`;
}

// ── Modal helpers ─────────────────────────────────────────────
// Every editor (campaign, template, contact, list...) opens in this one modal. It used to close
// on any click whose target was the backdrop, which also fires when a drag that started inside
// the form (selecting text in a field) is released over the backdrop, and on any stray click
// beside the dialog: either way the form vanished with whatever had been typed. Now the backdrop
// only counts when the press also started on it, and once anything has been typed, a backdrop
// click or Escape asks before discarding. The X, Cancel and Save buttons call closeModal()
// directly and are unchanged.
let modalDirty = false;
let modalPressOnBackdrop = false;
function setModal(html) {
  document.getElementById('modal-inner').innerHTML = html;
  document.getElementById('modal').classList.add('open');
  modalDirty = false;
}
function closeModal() { document.getElementById('modal').classList.remove('open'); modalDirty = false; }
/** For dismissals the user may not have meant: the backdrop and Escape. */
async function requestCloseModal() {
  if (!document.getElementById('modal').classList.contains('open')) return;
  if (modalDirty && !(await appConfirm('Discard your changes?', { confirmText: 'Discard' }))) return;
  closeModal();
}
document.getElementById('modal-inner').addEventListener('input', () => { modalDirty = true; });
document.getElementById('modal-inner').addEventListener('change', () => { modalDirty = true; });
document.getElementById('modal').addEventListener('mousedown', e => { modalPressOnBackdrop = e.target.id === 'modal'; });
document.getElementById('modal').addEventListener('click', e => {
  if (e.target.id === 'modal' && modalPressOnBackdrop) requestCloseModal();
  modalPressOnBackdrop = false;
});
document.addEventListener('mousemove', e => {
  if (!state.ui.templateResizing) return;
  const workspace = document.getElementById('template-workspace-main');
  if (!workspace) return;
  const rect = workspace.getBoundingClientRect();
  const maxWidth = Math.max(320, Math.min(760, rect.width - 360));
  const nextWidth = clampTemplatePreviewWidth(Math.min(maxWidth, rect.right - e.clientX));
  state.ui.templatePreviewWidth = nextWidth;
  workspace.style.setProperty('--template-preview-width', `${nextWidth}px`);
});
document.addEventListener('mouseup', () => {
  if (!state.ui.templateResizing) return;
  state.ui.templateResizing = false;
  localStorage.setItem(TEMPLATE_PREVIEW_WIDTH_KEY, String(state.ui.templatePreviewWidth));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  requestCloseModal();
  closeMobileMenu();
  closeDrawer();
});
window.addEventListener('resize', () => {
  if (currentSection === 'templates') renderTemplates();
});

// ── Utils ─────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtDate(s) { if(!s) return '-'; try { return new Date(s).toLocaleString('en-AU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return s; } }
function toDateTimeLocalValue(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function showAlert(id, msg, cls='alert-error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'alert ' + cls;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(()=>el.style.display='none', 4000);
}

// ── CRM ───────────────────────────────────────────────────────
const STAGE_LABELS = { lead:'Lead', prospect:'Prospect', qualified:'Qualified', proposal:'Proposal', won:'Won', lost:'Lost' };
const STAGE_ORDER = ['lead','prospect','qualified','proposal','won','lost'];

async function loadPipeline() { state.pipeline = await api('GET','/api/crm/pipeline') || {}; }
async function loadCrmStats() {
  state.crmStats = await api('GET','/api/crm/stats') || {};
  updateFollowUpBadges(state.crmStats?.followups_due || 0);
}
// ── Pipeline Board ────────────────────────────────────────────
// Sprint 12: the board is one card per contact with drag-between-stages and
// the shared filter model; it lives in crm-views-ui.js (renderCrmBoard).
function setPipelineStage(stage) {
  state.ui.pipelineStage = stage;
  renderPipeline();
}

function setPipelineSearch(value) {
  state.ui.pipelineSearch = String(value || '');
  renderPipeline();
}

function renderPipeline() { renderDealsBoard(); }

// Follow-ups page retired in sprint 16 — tasks (crm-tasks-ui.js) carry the queues now.

// ── Contact Drawer ────────────────────────────────────────────
let currentDrawerContactId = null;

async function openDrawer(contactId) {
  currentDrawerContactId = contactId;
  document.getElementById('drawer-bg').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-body').innerHTML = `<div class="empty"><div class="empty-icon">...</div><p>Loading...</p></div>`;
  document.getElementById('drawer-name').textContent = '...';
  document.getElementById('drawer-company').textContent = '';
  const d = await api('GET',`/api/crm/contact/${contactId}`);
  if (d.error) { document.getElementById('drawer-body').innerHTML = `<p style="color:var(--red)">${d.error}</p>`; return; }
  renderDrawerContent(d);
}

function renderDrawerContent(d) {
  const c = d.contact;
  document.getElementById('drawer-name').textContent = c.name || c.email;
  document.getElementById('drawer-company').textContent = [c.title, c.company].filter(Boolean).join(' | ');
  const openRec = document.getElementById('drawer-open-record');
  if (openRec) { openRec.style.display = ''; openRec.onclick = () => openContactRecord(c.id); }
  const tags = c.tags || [];
  document.getElementById('drawer-body').innerHTML = `
  <div class="drawer-section">
    <div class="drawer-control-row">
      <select class="stage-select" onchange="patchContact('${c.id}','stage',this.value)">
        ${STAGE_ORDER.map(s=>`<option value="${s}" ${c.stage===s?'selected':''}>${STAGE_LABELS[s]}</option>`).join('')}
      </select>
      <div class="drawer-inline-field">
        <span class="text-muted text-sm">Follow-up</span>
        <input class="drawer-inline-input" type="date" value="${(c.follow_up_at||'').split('T')[0]}" onchange="patchContact('${c.id}','follow_up_at',this.value?this.value+'T00:00:00Z':null)">
      </div>
    </div>
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Contact Info ${iconButton('edit', 'Edit contact', `openContactEditModal('${c.id}')`)}</div>
    <div class="info-grid">
      <div class="info-item"><label>Email</label><span class="mono" style="font-size:12px">${esc(c.email)}</span></div>
      <div class="info-item"><label>Title</label><span>${esc(c.title||'-')}</span></div>
      <div class="info-item"><label>Phone</label><span>${esc(c.phone||'-')}</span></div>
      <div class="info-item"><label>Company</label><span>${esc(c.company||'-')}</span></div>
      <div class="info-item"><label>LinkedIn</label>${c.linkedin?`<a href="${esc(c.linkedin)}" target="_blank" style="color:var(--cyan);font-size:12px">View Profile</a>`:'<span>-</span>'}</div>
      <div class="info-item"><label>Last Contacted</label><span class="text-sm">${c.last_contacted_at?fmtDate(c.last_contacted_at):'Never'}</span></div>
      <div class="info-item"><label>Added</label><span class="text-sm">${fmtDate(c.created_at)}</span></div>
    </div>
    ${tags.length?`<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${iconButton('tag', 'Edit tags', `editTags('${c.id}',${JSON.stringify(tags).replace(/'/g,'&#39;')})`)}</div>`
    :`<div style="margin-top:8px">${iconButton('tag', 'Add tags', `editTags('${c.id}',${JSON.stringify(tags)})`)}</div>`}
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Activity & Notes</div>
    <div class="drawer-note-entry">
      <select id="note-type" class="drawer-note-select">
        <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option>
      </select>
      <input id="note-input" class="drawer-note-input" placeholder="Log an activity or note..." onkeydown="if(event.key==='Enter')addNoteFromDrawer('${c.id}')">
      ${iconButton('plus', 'Add note', `addNoteFromDrawer('${c.id}')`, 'primary')}
    </div>
    <div id="notes-list">
    ${d.notes.length ? d.notes.map(n=>`<div class="note-item" id="note-${n.id}">
      <span class="note-type note-${n.type}">${n.type}</span>
      <div class="note-content">${esc(n.content)}</div>
      <div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px">
        <span class="note-date">${fmtDate(n.created_at)}</span>
        ${iconButton('trash', 'Delete note', `deleteNoteFromDrawer('${c.id}','${n.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}
      </div>
    </div>`).join('') : '<p class="text-muted text-sm">No notes yet.</p>'}
    </div>
  </div>

  <div class="drawer-section">
    <div class="drawer-section-title">Email History (${d.emails.length})</div>
    ${d.emails.length ? `<div class="table-wrap stack-on-mobile"><table>
      <thead><tr><th>Subject</th><th>Status</th><th>Sent At</th></tr></thead>
      <tbody>${d.emails.map(e=>`<tr>
        <td data-label="Subject" style="font-size:12px">${esc(e.subject||'-')}</td>
        <td data-label="Status"><span class="badge badge-${e.status}">${e.status}</span></td>
        <td class="text-muted text-sm" data-label="Sent At">${fmtDate(e.sent_at)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="text-muted text-sm">No emails sent yet.</p>'}
  </div>

  ${d.lists.length?`<div class="drawer-section"><div class="drawer-section-title">Lists</div><div style="display:flex;gap:6px;flex-wrap:wrap">${d.lists.map(l=>`<span class="badge badge-active">${esc(l)}</span>`).join('')}</div></div>`:''}
  `;
}

async function patchContact(id, field, value) {
  await api('PATCH',`/api/crm/contact/${id}`,{ [field]: value });
  await loadCrmStats();
  if (currentSection==='pipeline') {
    await Promise.all([loadDeals(), loadDealStats()]);
    renderPipeline();
  }
  if (currentSection==='crm_tasks') nav('crm_tasks');
  if (currentSection==='overview') {
    await loadOverview();
    renderOverview();
  }
}

async function addNoteFromDrawer(contactId) {
  const content = document.getElementById('note-input')?.value?.trim();
  const type = document.getElementById('note-type')?.value || 'note';
  if (!content) return;
  const r = await api('POST',`/api/crm/contact/${contactId}/notes`,{content,type});
  if (r.error) return;
  document.getElementById('note-input').value = '';
  // Prepend new note
  const nl = document.getElementById('notes-list');
  if (nl) {
    const div = document.createElement('div');
    div.className = 'note-item'; div.id = 'note-'+r.id;
    div.innerHTML = `<span class="note-type note-${r.type}">${r.type}</span><div class="note-content">${esc(r.content)}</div><div class="flex" style="justify-content:space-between;align-items:center;margin-top:4px"><span class="note-date">just now</span>${iconButton('trash', 'Delete note', `deleteNoteFromDrawer('${contactId}','${r.id}')`, 'ghost', { extraClass: 'icon-btn-danger' })}</div>`;
    nl.prepend(div);
  }
  if (currentSection === 'overview') {
    await loadOverview();
    renderOverview();
  }
}

async function deleteNoteFromDrawer(contactId, noteId) {
  await api('DELETE',`/api/crm/contact/${contactId}/notes/${noteId}`);
  const el = document.getElementById('note-'+noteId);
  if (el) el.remove();
  if (currentSection === 'overview') {
    await loadOverview();
    renderOverview();
  }
}

async function openContactEditModal(id) {
  const detail = await api('GET',`/api/crm/contact/${id}`);
  if (detail?.error) return;
  openContactModal(normalizeContactRecord(detail.contact), { returnToDrawer: id });
}

function editTags(id, tags) {
  setModal(`<div class="modal-head"><h3>Edit Tags</h3><button class="modal-close" onclick="closeModal()">x</button></div>
  <div class="modal-body">
    <p class="text-muted text-sm" style="margin-bottom:12px">Comma-separated tags, e.g: saas, founder, hot-lead</p>
    <div class="form-group"><label>Tags</label><input id="tag-input" value="${esc(tags.join(', '))}"></div>
    <div class="flex gap" style="justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTags('${id}')">Save</button>
    </div>
  </div>`);
}

async function saveTags(id) {
  const raw = document.getElementById('tag-input').value;
  const tags = raw.split(',').map(t=>t.trim()).filter(Boolean);
  await api('PATCH',`/api/crm/contact/${id}`,{tags});
  closeModal();
  openDrawer(id);
}

function closeDrawer() {
  document.getElementById('drawer-bg').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  currentDrawerContactId = null;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) <= new Date();
}

function fmtCurrency(v) {
  if (!v) return '$0';
  if (v >= 1000) return '$' + (v/1000).toFixed(v%1000===0?0:1) + 'k';
  return '$' + v.toLocaleString();
}

// ── Account section ───────────────────────────────────────────
async function loadAccount() {
  await refreshMe();
}

function renderAccount() {
  const c = document.getElementById('content');
  const u = state.me || {};
  const mfa = !!u.mfa_enabled;
  const remaining = Number(u.backup_codes_remaining || 0);
  c.innerHTML = `
    <div class="page-section">
      <div class="card">
        <div class="card-head"><div class="card-title">Profile</div></div>
        <div class="card-body">
          <div style="display:flex;gap:24px;align-items:center">
            <div style="flex-shrink:0;text-align:center">
              <div class="account-avatar" id="account-avatar">
                ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;display:block;border:0.5px solid var(--border)">` : `<div style="width:72px;height:72px;border-radius:50%;background:color-mix(in srgb,#6E5CCC 14%,transparent);color:#6E5CCC;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;border:0.5px solid rgba(110,92,204,0.15)">${esc((u.display_name || u.email || '?').charAt(0).toUpperCase())}</div>`}
              </div>
              <label style="margin-top:10px;display:inline-block;cursor:pointer;font-size:12px;color:#6E5CCC;font-weight:600;letter-spacing:-0.2px">
                Change photo
                <input type="file" accept="image/*" style="display:none" onchange="uploadAvatarFile(this.files[0])">
              </label>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:20px;font-weight:600;color:var(--text);letter-spacing:-0.3px;margin-bottom:2px">${esc(u.display_name || u.email || '')}</div>
              <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(u.email || '')}</div>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <span class="role-badge role-${esc(u.role || 'member')}" style="border-radius:100px">${esc(u.role || 'member')}</span>
                <span style="font-size:13px;color:var(--muted)">${mfa ? 'MFA enabled' : 'MFA not enabled'}${mfa && remaining ? ` · ${remaining} backup codes` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Change password</div></div>
        <div class="card-body">
          <div class="form-row">
            <div><label>Current password</label><input id="acc-pw-current" type="password" autocomplete="current-password"></div>
            <div><label>New password (min 8 chars)</label><input id="acc-pw-next" type="password" autocomplete="new-password"></div>
          </div>
          <div class="form-msg" id="acc-pw-msg"></div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="button" onclick="submitChangePassword()">Update password</button></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Two-factor authentication</div></div>
        <div class="card-body">
          ${mfa
            ? `<p style="margin:0 0 14px;color:var(--muted2);font-size:14px">Multi-factor authentication is currently <strong>enabled</strong>. You'll be prompted for a code from your authenticator app on every sign-in.</p>
               <div style="display:flex;gap:10px;flex-wrap:wrap">
                 <button class="btn btn-ghost" type="button" onclick="openRegenerateBackupCodes()">Regenerate backup codes</button>
                 <button class="btn btn-ghost" type="button" onclick="openDisableMfa()">Disable MFA</button>
               </div>`
            : `<p style="margin:0 0 14px;color:var(--muted2);font-size:14px">Add an extra layer of protection by requiring a one-time code from your authenticator app (Google Authenticator, Authy, 1Password, etc.) on each sign-in.</p>
               <button class="btn btn-primary" type="button" onclick="startMfaSetup()">Enable MFA</button>`}
        </div>
      </div>
    </div>
  `;
}

async function uploadAvatarFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toastError('Only image files are allowed'); return; }
  if (file.size > 5 * 1024 * 1024) { toastError('Avatar must be under 5 MB'); return; }
  const fd = new FormData();
  fd.append('file', file);
  const headers = {};
  const t = localStorage.getItem('token');
  if (t) headers['Authorization'] = 'Bearer ' + t;
  try {
    const res = await fetch('/api/me/avatar', { method: 'POST', headers, body: fd });
    const r = await res.json();
    if (r && r.ok && r.avatar_url) {
      state.me.avatar_url = r.avatar_url;
      const el = document.getElementById('account-avatar');
      if (el) el.innerHTML = `<img src="${esc(r.avatar_url)}?t=${Date.now()}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;display:block">`;
      toastSuccess('Avatar updated');
    } else {
      toastError((r && r.error) || 'Failed to upload avatar');
    }
  } catch (e) {
    toastError('Upload failed: ' + (e.message || e));
  }
}
window.uploadAvatarFile = uploadAvatarFile;

async function submitChangePassword() {
  const cur = document.getElementById('acc-pw-current').value;
  const next = document.getElementById('acc-pw-next').value;
  const msg = document.getElementById('acc-pw-msg');
  msg.className = 'form-msg';
  if (!cur || !next) { msg.textContent = 'Both fields are required'; msg.classList.add('form-msg-err'); return; }
  if (next.length < 8) { msg.textContent = 'New password must be at least 8 characters'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST','/api/auth/password/change',{current:cur,next});
  if (r && r.ok) {
    msg.textContent = 'Password updated.';
    msg.classList.add('form-msg-ok');
    document.getElementById('acc-pw-current').value = '';
    document.getElementById('acc-pw-next').value = '';
  } else {
    msg.textContent = (r && r.error) || 'Failed to update password';
    msg.classList.add('form-msg-err');
  }
}

// ── MFA enrolment flow ────────────────────────────────────────
async function startMfaSetup() {
  const r = await api('POST','/api/auth/totp/setup');
  if (!r || !r.secret) { toastError((r && r.error) || 'Failed to start MFA setup'); return; }
  const qrSvg = renderQrSvg(r.otpauth_uri);
  setModal(`
    <div class="modal-head"><div class="modal-title">Enable two-factor authentication</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <ol style="margin:0 0 16px 18px;padding:0;color:var(--muted);font-size:14px;line-height:1.7">
        <li>Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
        <li>Scan the QR code below, or enter the secret key manually</li>
        <li>Enter the 6-digit code from the app to confirm</li>
      </ol>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div class="qr-frame">${qrSvg}</div>
        <div style="flex:1;min-width:220px">
          <label style="font-size:12px;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em">Secret key</label>
          <div class="mono-block" style="margin-bottom:14px">${esc(r.secret)}</div>
          <label>Code from app</label>
          <input id="mfa-verify-code" type="tel" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="6">
          <div class="form-msg" id="mfa-verify-msg" style="margin-top:8px"></div>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitMfaVerify()">Verify &amp; enable</button>
    </div>
  `);
  setTimeout(() => { const el = document.getElementById('mfa-verify-code'); if (el) el.focus(); }, 30);
}

async function submitMfaVerify() {
  const code = document.getElementById('mfa-verify-code').value;
  const msg = document.getElementById('mfa-verify-msg');
  msg.className = 'form-msg';
  if (!code) { msg.textContent = 'Enter the code'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST','/api/auth/totp/verify',{code});
  if (r && r.ok && Array.isArray(r.backup_codes)) {
    showBackupCodesModal(r.backup_codes, true);
    await refreshMe();
  } else {
    msg.textContent = (r && r.error) || 'Invalid code';
    msg.classList.add('form-msg-err');
  }
}

function showBackupCodesModal(codes, fresh) {
  const heading = fresh ? 'MFA enabled — save your backup codes' : 'New backup codes generated';
  setModal(`
    <div class="modal-head"><div class="modal-title">${esc(heading)}</div>
      <button class="modal-close" type="button" onclick="closeBackupCodesModal()">x</button></div>
    <div class="modal-body">
      <p style="margin:0 0 14px;color:var(--amber);font-size:14px"><strong>Store these codes somewhere safe now.</strong> Each code can be used once if you lose access to your authenticator. They will not be shown again.</p>
      <div class="backup-grid">
        ${codes.map(c => `<div class="mono-block" style="text-align:center">${esc(c)}</div>`).join('')}
      </div>
      <div style="margin-top:14px;display:flex;gap:10px">
        <button class="btn btn-ghost" type="button" onclick="copyBackupCodes(${JSON.stringify(JSON.stringify(codes))})">Copy all</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-primary" type="button" onclick="closeBackupCodesModal()">I've saved them</button>
    </div>
  `);
}

function copyBackupCodes(serialized) {
  try {
    const codes = JSON.parse(serialized);
    navigator.clipboard.writeText(codes.join('\n'));
  } catch {}
}

function closeBackupCodesModal() {
  closeModal();
  if (currentSection === 'account') renderAccount();
}

function openDisableMfa() {
  setModal(`
    <div class="modal-head"><div class="modal-title">Disable two-factor authentication</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <p style="margin:0 0 14px;color:var(--muted2);font-size:14px">Enter a current authenticator code to disable MFA. All backup codes will also be removed.</p>
      <label>Current code</label>
      <input id="mfa-disable-code" type="tel" inputmode="numeric" placeholder="123456" maxlength="6" autofocus>
      <div class="form-msg" id="mfa-disable-msg" style="margin-top:8px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitDisableMfa()">Disable MFA</button>
    </div>
  `);
}

async function submitDisableMfa() {
  const code = document.getElementById('mfa-disable-code').value;
  const msg = document.getElementById('mfa-disable-msg');
  msg.className = 'form-msg';
  const r = await api('POST','/api/auth/totp/disable',{code});
  if (r && r.ok) {
    closeModal();
    await refreshMe();
    if (currentSection === 'account') renderAccount();
  } else {
    msg.textContent = (r && r.error) || 'Failed to disable';
    msg.classList.add('form-msg-err');
  }
}

async function openRegenerateBackupCodes() {
  if (!(await appConfirm('Regenerate backup codes? Any previous codes will stop working.'))) return;
  const r = await api('POST','/api/auth/backup-codes/regenerate');
  if (r && r.ok && Array.isArray(r.backup_codes)) {
    showBackupCodesModal(r.backup_codes, false);
    await refreshMe();
  } else {
    toastError((r && r.error) || 'Failed to regenerate backup codes');
  }
}

// QR rendering — relies on the qrcode-generator library loaded in index.html.
function renderQrSvg(text) {
  if (typeof qrcode !== 'function') return '<div class="form-msg form-msg-err">QR library failed to load</div>';
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ scalable: true, cellSize: 5, margin: 2 });
  } catch (e) {
    return `<div class="form-msg form-msg-err">${esc(String(e && e.message || e))}</div>`;
  }
}

// ── Users administration (admin only) ─────────────────────────
async function loadUsers() {
  const r = await api('GET','/api/users');
  state.users = (r && Array.isArray(r.users)) ? r.users : [];
}

function renderUsers() {
  const c = document.getElementById('content');
  const rows = state.users.map(u => {
    // Locking yourself out, or resetting your own MFA from the admin table
    // rather than My Account, is never what someone means to do.
    const isSelf = !!(state.me && state.me.id === u.id);
    return `
    <tr>
      <td>${esc(u.email)}${isSelf ? ' <span class="text-muted text-sm">(you)</span>' : ''}</td>
      <td>${esc(u.display_name || '')}</td>
      <td><span class="role-badge role-${esc(u.role)}">${esc(u.role)}</span></td>
      <td>${Number(u.active) === 1 ? 'Active' : '<span style="color:var(--muted2)">Disabled</span>'}</td>
      <td>${Number(u.mfa_enabled) === 1 ? 'On' : '<span style="color:var(--muted2)">Off</span>'}</td>
      <td style="color:var(--muted2);font-size:12px">${esc(u.last_login_at ? (typeof fmtDay === 'function' ? fmtDay(u.last_login_at) : String(u.last_login_at).slice(0, 10)) : 'never')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" type="button" onclick="openEditUser('${esc(u.id)}')">Edit</button>
        ${isSelf ? '' : `
          <button class="btn btn-ghost btn-sm" type="button" onclick="openResetUserPassword('${esc(u.id)}','${esc(u.email)}')">Reset PW</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="resetUserMfa('${esc(u.id)}','${esc(u.email)}')">Reset MFA</button>
          ${Number(u.active) === 1 ? `<button class="btn btn-ghost btn-sm" type="button" onclick="deactivateUser('${esc(u.id)}','${esc(u.email)}')">Deactivate</button>` : ''}
        `}
      </td>
    </tr>
  `; }).join('');
  const scopeNote = (typeof isCustomerUser === 'function' && isCustomerUser())
    ? 'People in your organisation who can sign in to this workspace.'
    : 'Everyone who can sign in, across Cintelis and its customers.';
  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions" style="justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0;font-size:20px">Users</h2>
          <div class="text-muted text-sm" style="margin-top:2px">${esc(scopeNote)}</div>
        </div>
        <button class="btn btn-primary" type="button" onclick="openCreateUser()">+ Add user</button>
      </div>
      <div class="card">
        <div class="card-body" style="padding:${rows ? '0' : '8px'}">
          ${rows ? `
          <table class="data-table">
            <thead><tr>
              <th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>MFA</th><th>Last login</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>` : (typeof renderEmptyState === 'function'
            ? renderEmptyState({ icon: 'inbox', title: 'No users yet', body: 'Add the people who need access to this workspace.', actionLabel: '+ Add user', actionOnClick: 'openCreateUser()' })
            : '<div class="empty"><p>No users yet.</p></div>')}
        </div>
      </div>
    </div>
  `;
}

function openCreateUser() {
  setModal(`
    <div class="modal-head"><div class="modal-title">Add user</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Email</label>
      <input id="nu-email" type="email" placeholder="person@example.com" autofocus>
      <label style="margin-top:10px">Display name</label>
      <input id="nu-name" type="text" placeholder="Jane Doe">
      <label style="margin-top:10px">Role</label>
      <select id="nu-role">
        <option value="member" selected>Member — read &amp; write</option>
        <option value="admin">Admin — full access incl. user management</option>
        <option value="viewer">Viewer — read only</option>
      </select>
      <label style="margin-top:10px">Initial password (min 8 chars)</label>
      <input id="nu-password" type="password" autocomplete="new-password">
      <div class="form-msg" id="nu-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitCreateUser()">Create user</button>
    </div>
  `);
}

async function submitCreateUser() {
  const email = document.getElementById('nu-email').value.trim();
  const display_name = document.getElementById('nu-name').value.trim();
  const role = document.getElementById('nu-role').value;
  const password = document.getElementById('nu-password').value;
  const msg = document.getElementById('nu-msg');
  msg.className = 'form-msg';
  if (!email) { msg.textContent = 'Email is required'; msg.classList.add('form-msg-err'); return; }
  if (!password || password.length < 8) { msg.textContent = 'Password must be at least 8 characters'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST','/api/users',{email,display_name,role,password});
  if (r && r.id) {
    closeModal();
    await loadUsers(); renderUsers();
  } else {
    msg.textContent = (r && r.error) || 'Failed to create user';
    msg.classList.add('form-msg-err');
  }
}

function openEditUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  setModal(`
    <div class="modal-head"><div class="modal-title">Edit user</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <label>Email</label>
      <input type="text" value="${esc(u.email)}" disabled>
      <label style="margin-top:10px">Display name</label>
      <input id="eu-name" type="text" value="${esc(u.display_name || '')}">
      <label style="margin-top:10px">Role</label>
      <select id="eu-role">
        <option value="member" ${u.role==='member'?'selected':''}>Member</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
      </select>
      <label style="margin-top:10px"><input id="eu-active" type="checkbox" ${Number(u.active)===1?'checked':''}> Account active</label>
      <div class="form-msg" id="eu-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitEditUser('${esc(id)}')">Save</button>
    </div>
  `);
}

async function submitEditUser(id) {
  const display_name = document.getElementById('eu-name').value.trim();
  const role = document.getElementById('eu-role').value;
  const active = document.getElementById('eu-active').checked ? 1 : 0;
  const r = await api('PATCH',`/api/users/${encodeURIComponent(id)}`,{display_name,role,active});
  if (r && r.ok) {
    closeModal();
    await loadUsers(); renderUsers();
  } else {
    const msg = document.getElementById('eu-msg');
    msg.className = 'form-msg form-msg-err';
    msg.textContent = (r && r.error) || 'Failed to update';
  }
}

function openResetUserPassword(id, email) {
  setModal(`
    <div class="modal-head"><div class="modal-title">Reset password — ${esc(email)}</div>
      <button class="modal-close" type="button" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <p style="margin:0 0 12px;color:var(--muted2);font-size:14px">Set a new password for this user. They should change it after their next login.</p>
      <label>New password (min 8 chars)</label>
      <input id="rp-password" type="password" autofocus autocomplete="new-password">
      <div class="form-msg" id="rp-msg" style="margin-top:10px"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" type="button" onclick="submitResetUserPassword('${esc(id)}')">Reset password</button>
    </div>
  `);
}

async function submitResetUserPassword(id) {
  const password = document.getElementById('rp-password').value;
  const msg = document.getElementById('rp-msg');
  msg.className = 'form-msg';
  if (!password || password.length < 8) { msg.textContent = 'Password must be at least 8 characters'; msg.classList.add('form-msg-err'); return; }
  const r = await api('POST',`/api/users/${encodeURIComponent(id)}/reset-password`,{password});
  if (r && r.ok) { closeModal(); }
  else { msg.textContent = (r && r.error) || 'Failed to reset'; msg.classList.add('form-msg-err'); }
}

async function resetUserMfa(id, email) {
  if (!(await appConfirm(`Reset MFA for ${email}? They will need to enrol again on their next login.`))) return;
  const r = await api('POST',`/api/users/${encodeURIComponent(id)}/reset-mfa`);
  if (r && r.ok) { await loadUsers(); renderUsers(); }
  else { toastError((r && r.error) || 'Failed to reset MFA'); }
}

async function deactivateUser(id, email) {
  if (!(await appConfirm(`Deactivate ${email}? Their existing sessions will be revoked immediately.`))) return;
  const r = await api('DELETE',`/api/users/${encodeURIComponent(id)}`);
  if (r && r.ok) { await loadUsers(); renderUsers(); }
  else { toastError((r && r.error) || 'Failed to deactivate'); }
}

init();
