// ============================================================
// Cintelis Workspace — Feature visibility settings UI (Sprint 6)
// Admin-only Settings page. Checkbox grid: which top-level
// features (outreach / crm / tasks / docs) are visible to
// members and viewers. Loaded as a regular <script> tag after
// app.js; uses state, api(), esc() from app.js.
// ============================================================

(function () {
  state.featureSettings = state.featureSettings || null;
})();

// ── Feature labels ───────────────────────────────────────────
const FEATURE_LABELS = {
  outreach: { name: 'Outreach', desc: 'Templates, Contacts, Lists, Campaigns, Sent Log, Unsubscribes' },
  crm:      { name: 'CRM',      desc: 'Pipeline, Follow-ups' },
  tasks:    { name: 'Tasks',    desc: 'Projects, Sprints, Board' },
  docs:     { name: 'Docs',     desc: 'Spaces, Pages, Version history' }
};
const FEATURE_ORDER = ['outreach', 'crm', 'tasks', 'docs'];
const FEATURE_ROLES = ['member', 'viewer'];

function featureSettingsIsAdmin() {
  return state.me && state.me.role === 'admin';
}

// ── Loader ───────────────────────────────────────────────────
async function loadFeatureSettings() {
  const r = await api('GET', '/api/app-settings/feature-visibility');
  // Backend returns the raw matrix object directly.
  if (r && typeof r === 'object' && !r.error) {
    state.featureSettings = r;
  } else {
    state.featureSettings = defaultFeatureMatrix();
  }
  return state.featureSettings;
}
window.loadFeatureSettings = loadFeatureSettings;

function defaultFeatureMatrix() {
  const m = {};
  for (const f of FEATURE_ORDER) {
    m[f] = { member: true, viewer: true };
  }
  return m;
}

function getFlag(feature, role) {
  const m = state.featureSettings || {};
  const row = m[feature] || {};
  return row[role] !== false;
}

// ── Section entry point ──────────────────────────────────────
async function renderFeatureSettingsSection() {
  const c = document.getElementById('content');
  if (!c) return;
  if (!featureSettingsIsAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Feature visibility is restricted to admins.</p></div></div>';
    return;
  }
  c.innerHTML = '<div class="page-section"><p class="text-muted">Loading feature settings\u2026</p></div>';
  try {
    await loadFeatureSettings();
  } catch (e) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Failed to load feature settings.</p></div></div>';
    return;
  }
  renderFeatureSettings();
}
window.renderFeatureSettingsSection = renderFeatureSettingsSection;

function renderFeatureSettings() {
  const c = document.getElementById('content');
  if (!c) return;
  if (!featureSettingsIsAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>Feature visibility is restricted to admins.</p></div></div>';
    return;
  }

  const rows = FEATURE_ORDER.map(feature => {
    const label = FEATURE_LABELS[feature] || { name: feature, desc: '' };
    const cells = FEATURE_ROLES.map(role => {
      const checked = getFlag(feature, role) ? 'checked' : '';
      return `
        <td>
          <label class="feature-settings-checkbox">
            <input type="checkbox" ${checked}
              data-feature="${esc(feature)}"
              data-role="${esc(role)}">
          </label>
        </td>
      `;
    }).join('');
    return `
      <tr>
        <td>
          <div class="feature-settings-feature-name">${esc(label.name)}</div>
          <div class="feature-settings-feature-desc text-muted text-sm">${esc(label.desc)}</div>
        </td>
        ${cells}
      </tr>
    `;
  }).join('');

  c.innerHTML = `
    <div class="page-section page-section-wide">
      <div class="page-actions">
        <div class="page-actions-left"><h2 class="page-section-title">Feature visibility</h2></div>
      </div>
      <div class="feature-settings-note text-muted text-sm" style="margin-top:8px">
        Admins always see everything. Changes apply on the next page load for affected users.
      </div>
      <div class="feature-settings-table-wrap" style="margin-top:14px">
        <table class="feature-settings-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Member</th>
              <th>Viewer</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <div class="form-msg" id="feature-settings-msg" style="margin-top:10px"></div>
    </div>
  `;

  // Wire toggles.
  const inputs = c.querySelectorAll('.feature-settings-table input[type="checkbox"]');
  inputs.forEach(inp => {
    inp.addEventListener('change', () => {
      const feature = inp.getAttribute('data-feature');
      const role = inp.getAttribute('data-role');
      const value = !!inp.checked;
      toggleFeatureFlag(feature, role, value, inp);
    });
  });
}
window.renderFeatureSettings = renderFeatureSettings;

// ── Toggle ───────────────────────────────────────────────────
async function toggleFeatureFlag(feature, role, value, inputEl) {
  if (!featureSettingsIsAdmin()) return;
  const msg = document.getElementById('feature-settings-msg');
  if (msg) { msg.className = 'form-msg'; msg.textContent = ''; }

  // Optimistic local update.
  if (!state.featureSettings) state.featureSettings = defaultFeatureMatrix();
  if (!state.featureSettings[feature]) state.featureSettings[feature] = { member: true, viewer: true };
  const prev = state.featureSettings[feature][role];
  state.featureSettings[feature][role] = value;

  const patch = {};
  patch[feature] = {};
  patch[feature][role] = value;

  const r = await api('PATCH', '/api/app-settings/feature-visibility', patch);
  if (r && typeof r === 'object' && !r.error) {
    // Backend returns merged matrix.
    state.featureSettings = r;
    if (msg) {
      msg.textContent = 'Saved.';
      msg.classList.add('form-msg-ok');
      setTimeout(() => { if (msg) { msg.textContent = ''; msg.className = 'form-msg'; } }, 1500);
    }
    // Refresh local featureFlags cache used by applyFeatureVisibility.
    state.featureFlags = r;
  } else {
    // Revert on error.
    state.featureSettings[feature][role] = prev;
    if (inputEl) inputEl.checked = prev !== false;
    toastError((r && r.error) || 'Failed to update feature visibility');
  }
}
window.toggleFeatureFlag = toggleFeatureFlag;
