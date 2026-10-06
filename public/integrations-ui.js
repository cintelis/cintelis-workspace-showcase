// ============================================================
// Cintelis Workspace — Integrations
// Discord webhooks were removed on 2026-09-16. Xero is the one
// integration: internal admins connect Cintelis's organisation here
// (card rendered by xero-ui.js). Customer admins see where their
// invoices appear instead. Uses esc() from app.js.
// ============================================================

async function renderIntegrationsSection() {
  const c = document.getElementById('content');
  if (!c) return;
  if (typeof isInternalAdmin === 'function' && isInternalAdmin()) {
    c.innerHTML = `
      <div class="page-section">
        <div class="card">
          <div class="card-head"><div class="card-title">Integrations</div></div>
          <div class="card-body"><div id="xero-integration"></div></div>
        </div>
      </div>
    `;
    if (typeof renderXeroIntegrationCard === 'function') renderXeroIntegrationCard(document.getElementById('xero-integration'));
    return;
  }
  c.innerHTML = `
    <div class="page-section">
      <div class="card">
        <div class="card-head"><div class="card-title">Integrations</div></div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <div style="font-size:22px;line-height:1">🧾</div>
            <div style="min-width:0">
              <div style="font-weight:600">Xero</div>
              <div class="text-muted text-sm">Invoices from Cintelis come from Xero and appear under Contract &amp; Billing, where you can open each PDF and pay online.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
window.renderIntegrationsSection = renderIntegrationsSection;
