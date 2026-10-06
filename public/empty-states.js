// ============================================================
// Cintelis Workspace — Empty States (Sprint 7)
// Reusable renderEmptyState() helper + a small named library
// of inline SVG icons. Loaded as a regular <script> after
// app.js; uses the global esc() helper from app.js at call
// time (safe by the time these helpers are used in practice).
//
// Public globals:
//   renderEmptyState(opts)  -> HTML string
//   EMPTY_STATE_ICONS       -> map of icon name -> SVG string
// ============================================================

// Each icon is a ~60x60 viewBox, uses currentColor so it inherits
// the surrounding text color. Keep paths simple and friendly.
const EMPTY_STATE_ICONS = {
  inbox: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 34 L20 14 H44 L54 34 V50 A4 4 0 0 1 50 54 H14 A4 4 0 0 1 10 50 Z"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M10 34 H22 L26 40 H38 L42 34 H54" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M20 14 L20 30 M44 14 L44 30" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
  </svg>`,

  folder: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 20 A3 3 0 0 1 11 17 H24 L29 22 H53 A3 3 0 0 1 56 25 V48 A3 3 0 0 1 53 51 H11 A3 3 0 0 1 8 48 Z"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M8 26 H56" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
  </svg>`,

  document: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M16 8 H40 L52 20 V54 A2 2 0 0 1 50 56 H16 A2 2 0 0 1 14 54 V10 A2 2 0 0 1 16 8 Z"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M40 8 V20 H52" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M22 30 H44 M22 38 H44 M22 46 H36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
  </svg>`,

  sprint: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14 10 V54" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M14 12 H48 L42 22 L48 32 H14 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="14" cy="10" r="2" fill="currentColor"/>
  </svg>`,

  kanban: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="8" y="12" width="14" height="40" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="25" y="12" width="14" height="40" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="42" y="12" width="14" height="40" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="11" y="16" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
    <rect x="11" y="26" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
    <rect x="28" y="16" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
    <rect x="45" y="16" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
    <rect x="45" y="26" width="8" height="6" rx="1" fill="currentColor" opacity="0.35"/>
  </svg>`,

  link: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M26 38 A10 10 0 0 1 26 24 L34 16 A10 10 0 0 1 48 30 L44 34"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M38 26 A10 10 0 0 1 38 40 L30 48 A10 10 0 0 1 16 34 L20 30"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  attachment: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M44 20 L22 42 A8 8 0 0 0 34 54 L52 36 A12 12 0 0 0 34 18 L16 36 A16 16 0 0 0 40 58"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  search: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="28" cy="28" r="16" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <line x1="40" y1="40" x2="54" y2="54" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  check: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <path d="M21 33 L29 41 L44 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  spark: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M32 10 L35 28 L52 32 L35 36 L32 54 L29 36 L12 32 L29 28 Z"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="50" cy="14" r="2" fill="currentColor"/>
    <circle cx="14" cy="50" r="2" fill="currentColor"/>
  </svg>`
};
window.EMPTY_STATE_ICONS = EMPTY_STATE_ICONS;

function renderEmptyState(opts) {
  const o = opts || {};
  const iconName = o.icon && EMPTY_STATE_ICONS[o.icon] ? o.icon : 'spark';
  const iconSvg = EMPTY_STATE_ICONS[iconName];
  const escFn = (typeof window.esc === 'function') ? window.esc : (s) => String(s == null ? '' : s);

  const title = o.title ? `<h3 class="empty-state-title">${escFn(o.title)}</h3>` : '';
  const bodyHtml = o.body ? `<p class="empty-state-body">${escFn(o.body)}</p>` : '';

  let action = '';
  if (o.actionLabel) {
    // actionOnClick is expected to be a short inline JS string like
    // "openCreateProject()". We escape it for the attribute; callers
    // should pass trusted strings (matches the pattern used elsewhere
    // in app.js for onclick handlers).
    const handler = o.actionOnClick ? escFn(o.actionOnClick) : '';
    action = `<button class="btn btn-primary empty-state-action" type="button" onclick="${handler}">${escFn(o.actionLabel)}</button>`;
  }

  return `
    <div class="empty-state">
      <div class="empty-state-icon">${iconSvg}</div>
      ${title}
      ${bodyHtml}
      ${action}
    </div>
  `;
}
window.renderEmptyState = renderEmptyState;
