// ============================================================
// Cintelis Workspace — API Tokens settings UI (admin-only).
// Lists Personal Access Tokens (pat_…), allows minting and revoking.
// Plaintext is shown once at creation, then never again.
// ============================================================

(function () {
  state.apiTokens = state.apiTokens || { items: [], loading: false };
})();

function apiTokensIsAdmin() {
  return state.me && state.me.role === 'admin';
}

async function loadApiTokens() {
  state.apiTokens.loading = true;
  try {
    const r = await api('GET', '/api/admin/api-tokens');
    state.apiTokens.items = (r && Array.isArray(r.tokens)) ? r.tokens : [];
  } catch (e) {
    state.apiTokens.items = [];
  } finally {
    state.apiTokens.loading = false;
  }
}
window.loadApiTokens = loadApiTokens;

async function renderApiTokensSection() {
  const c = document.getElementById('content');
  if (!c) return;
  if (!apiTokensIsAdmin()) {
    c.innerHTML = '<div class="page-section"><div class="empty"><p>API tokens are restricted to admins.</p></div></div>';
    return;
  }
  c.innerHTML = '<div class="page-section"><div class="empty"><p>Loading tokens…</p></div></div>';
  await loadApiTokens();
  renderApiTokensList();
}
window.renderApiTokensSection = renderApiTokensSection;

function renderApiTokensList() {
  const c = document.getElementById('content');
  if (!c) return;
  const items = state.apiTokens.items || [];
  const rows = items.map(t => {
    const isRevoked = !!t.revoked_at;
    const stateBadge = isRevoked
      ? '<span class="lozenge lozenge-status-backlog">Revoked</span>'
      : '<span class="lozenge lozenge-status-done">Active</span>';
    const lastUsed = t.last_used_at ? esc(relTime(t.last_used_at)) : '<span class="text-muted">never</span>';
    const owner = t.owner_name || t.owner_email || '<span class="text-muted">—</span>';
    const revokeBtn = isRevoked
      ? ''
      : `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="confirmRevokeApiToken('${esc(t.id)}','${esc(t.name)}')">Revoke</button>`;
    return `
      <tr>
        <td>
          <div style="font-weight:600">${esc(t.name)}</div>
          <div class="text-muted text-sm mono">${esc(t.id)}</div>
        </td>
        <td><span class="mono text-sm">${esc(t.scope || 'docs:write')}</span></td>
        <td>${esc(owner)}</td>
        <td>${esc(relTime(t.created_at))}</td>
        <td>${lastUsed}</td>
        <td>${stateBadge}</td>
        <td style="text-align:right">${revokeBtn}</td>
      </tr>
    `;
  }).join('');

  const empty = items.length ? '' : `
    <tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted)">
      No API tokens yet. Create one to call the API from your own tools.
    </td></tr>
  `;

  c.innerHTML = `
    <div class="page-section">
      <div class="page-section-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin:0">API Tokens</h2>
          <div class="text-muted text-sm" style="margin-top:4px">
            Personal Access Tokens for <code class="mono">/api/v1/*</code> programmatic access. Treat like passwords.
          </div>
        </div>
        <button class="btn btn-primary" type="button" onclick="openMintApiTokenModal()">+ New token</button>
      </div>

      <div class="card" style="margin-top:18px;padding:0;overflow:hidden">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead style="background:var(--surface2)">
            <tr>
              <th style="text-align:left;padding:10px 14px">Name</th>
              <th style="text-align:left;padding:10px 14px">Scope</th>
              <th style="text-align:left;padding:10px 14px">Owner</th>
              <th style="text-align:left;padding:10px 14px">Created</th>
              <th style="text-align:left;padding:10px 14px">Last used</th>
              <th style="text-align:left;padding:10px 14px">Status</th>
              <th style="padding:10px 14px"></th>
            </tr>
          </thead>
          <tbody>
            ${rows}${empty}
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-body">
          <h3 style="margin:0 0 8px;font-size:14px">Using a token</h3>
          <p class="text-muted text-sm" style="margin:0 0 10px">Send as a Bearer header:</p>
          <pre class="mono" style="background:var(--surface2);padding:10px 12px;border-radius:6px;font-size:12px;margin:0 0 10px">Authorization: Bearer pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</pre>
          <p class="text-muted text-sm" style="margin:0">
            Tokens cannot be rotated in place: create a new one, deploy it, then revoke the old.
          </p>
        </div>
      </div>
    </div>
  `;
}

// ── Mint modal ────────────────────────────────────────────────
function openMintApiTokenModal() {
  if (!apiTokensIsAdmin()) return;
  setModal(`
    <div class="modal-head"><h3>Create API token</h3><button class="modal-close" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Name</label>
        <input id="mint-token-name" type="text" placeholder="e.g. github-actions, weekly-report-cron" maxlength="80">
        <div class="text-muted text-sm" style="margin-top:4px">A short label so you can find this token later. Not shown to API clients.</div>
      </div>
      <div class="form-group">
        <label>Scope</label>
        <select id="mint-token-scope">
          <option value="docs:write" selected>docs:write — create, update, delete pages</option>
          <option value="docs:read">docs:read — fetch pages only</option>
          <option value="crm:write">crm:write — create/update contacts (lead intake)</option>
        </select>
      </div>
      <div class="form-msg" id="mint-token-msg"></div>
      <div class="flex gap" style="justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" type="button" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" type="button" onclick="submitMintApiToken()">Create token</button>
      </div>
    </div>
  `);
  setTimeout(() => { const i = document.getElementById('mint-token-name'); if (i) i.focus(); }, 50);
}
window.openMintApiTokenModal = openMintApiTokenModal;

async function submitMintApiToken() {
  const nameEl = document.getElementById('mint-token-name');
  const scopeEl = document.getElementById('mint-token-scope');
  const msg = document.getElementById('mint-token-msg');
  const name = nameEl ? nameEl.value.trim() : '';
  const scope = scopeEl ? scopeEl.value : 'docs:write';
  if (!name) {
    if (msg) { msg.textContent = 'Name is required.'; msg.style.color = 'var(--red)'; }
    return;
  }
  if (msg) { msg.textContent = 'Creating…'; msg.style.color = 'var(--muted)'; }
  const r = await api('POST', '/api/admin/api-tokens', { name, scope });
  if (!r || r.error || !r.token) {
    if (msg) { msg.textContent = (r && r.error) || 'Failed to create token.'; msg.style.color = 'var(--red)'; }
    return;
  }
  closeModal();
  await loadApiTokens();
  renderApiTokensList();
  showTokenPlaintextModal(r.token, r.name);
}
window.submitMintApiToken = submitMintApiToken;

function showTokenPlaintextModal(plaintext, name) {
  setModal(`
    <div class="modal-head"><h3>Token created</h3><button class="modal-close" onclick="closeModal()">x</button></div>
    <div class="modal-body">
      <p style="margin:0 0 12px"><strong>${esc(name)}</strong> — copy this token now. It will not be shown again.</p>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input id="new-token-plaintext" class="mono" value="${esc(plaintext)}" readonly style="flex:1;font-size:13px;font-family:var(--font-mono)">
        <button class="btn btn-primary" type="button" onclick="copyTokenPlaintextToClipboard()">Copy</button>
      </div>
      <div class="text-muted text-sm" style="margin-top:12px">
        Store this somewhere safe (1Password, GitHub Actions secrets, Worker secrets, etc.).
        If you lose it, mint a new token and revoke this one.
      </div>
      <div class="flex gap" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary" type="button" onclick="closeModal()">Done</button>
      </div>
    </div>
  `);
  setTimeout(() => {
    const inp = document.getElementById('new-token-plaintext');
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

function copyTokenPlaintextToClipboard() {
  const inp = document.getElementById('new-token-plaintext');
  if (!inp) return;
  inp.select();
  const txt = inp.value;
  navigator.clipboard.writeText(txt).then(() => {
    if (typeof toastSuccess === 'function') toastSuccess('Token copied to clipboard');
  }).catch(() => {
    document.execCommand && document.execCommand('copy');
    if (typeof toastSuccess === 'function') toastSuccess('Token copied');
  });
}
window.copyTokenPlaintextToClipboard = copyTokenPlaintextToClipboard;

// ── Revoke ────────────────────────────────────────────────────
async function confirmRevokeApiToken(tokenId, name) {
  if (!(await appConfirm('Revoke API token "' + name + '"? Any integration using it will stop working immediately. This cannot be undone.'))) return;
  const r = await api('DELETE', '/api/admin/api-tokens/' + encodeURIComponent(tokenId));
  if (!r || r.error) {
    if (typeof toastError === 'function') toastError((r && r.error) || 'Failed to revoke token');
    return;
  }
  if (typeof toastSuccess === 'function') toastSuccess('Token revoked');
  await loadApiTokens();
  renderApiTokensList();
}
window.confirmRevokeApiToken = confirmRevokeApiToken;
