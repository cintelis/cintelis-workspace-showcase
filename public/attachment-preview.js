// In-app modal preview for attachments. Intercepts clicks on
// /api/attachments/.../{download,preview} links and dispatches the right
// viewer based on MIME type. Heavy libraries (mammoth, SheetJS) are
// lazy-loaded only when the user opens that file type for the first time.
(function () {
  const MAMMOTH_CDN = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
  const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

  let modalEl = null;
  const loadedScripts = new Set();

  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { loadedScripts.add(src); resolve(); };
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function detectKind(mime, filename) {
    const m = (mime || '').toLowerCase();
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (ext === 'csv' || m === 'text/csv') return 'csv';
    if (m.startsWith('text/') || m === 'application/json' || ext === 'md' || ext === 'json') return 'text';
    if (ext === 'docx' || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (ext === 'xlsx' || ext === 'xls' || m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || m === 'application/vnd.ms-excel') return 'xlsx';
    return 'other';
  }

  function downloadUrlFor(url) {
    return url.replace('/preview', '/download').replace('/preview?', '/download?');
  }
  function previewUrlFor(url) {
    return url.replace('/download', '/preview').replace('/download?', '/preview?');
  }

  function open(url, filename) {
    close();
    const previewUrl = previewUrlFor(url);
    const dlUrl = downloadUrlFor(url);
    modalEl = document.createElement('div');
    modalEl.className = 'attp-overlay';
    modalEl.innerHTML = `
      <div class="attp-modal" role="dialog" aria-label="Preview ${escapeHtml(filename)}">
        <div class="attp-header">
          <div class="attp-title" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
          <div class="attp-actions">
            <a class="btn btn-ghost btn-sm" href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener">Open in new tab</a>
            <a class="btn btn-ghost btn-sm" href="${escapeHtml(dlUrl)}" download="${escapeHtml(filename)}">Download</a>
            <button class="btn btn-ghost btn-sm attp-close" type="button" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="attp-body" id="attp-body">
          <div class="attp-loading">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
    modalEl.querySelector('.attp-close').addEventListener('click', close);
    document.addEventListener('keydown', escHandler);
    render(document.getElementById('attp-body'), previewUrl, dlUrl, filename).catch(err => {
      const body = document.getElementById('attp-body');
      if (body) body.innerHTML = `<div class="attp-empty"><p>Preview failed: ${escapeHtml(err.message || String(err))}</p><a class="btn btn-primary btn-sm" href="${escapeHtml(dlUrl)}" download="${escapeHtml(filename)}">Download instead</a></div>`;
    });
  }

  function close() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
    document.removeEventListener('keydown', escHandler);
  }

  function escHandler(e) { if (e.key === 'Escape') close(); }

  // `body` is passed in rather than looked up, so the same renderer serves the
  // modal and any inline pane (the billing page previews contracts in place).
  async function render(body, previewUrl, dlUrl, filename) {
    if (!body) return;

    let mime = '';
    try {
      const head = await fetch(previewUrl, { method: 'HEAD' });
      if (head.ok) mime = head.headers.get('Content-Type') || '';
    } catch { /* fall back to extension detection */ }

    const kind = detectKind(mime, filename);

    switch (kind) {
      case 'image':
        body.innerHTML = `<img class="attp-img" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(filename)}"/>`;
        break;
      case 'pdf':
        body.innerHTML = `<iframe class="attp-iframe" src="${escapeHtml(previewUrl)}" title="${escapeHtml(filename)}"></iframe>`;
        break;
      case 'video':
        body.innerHTML = `<video class="attp-media" controls src="${escapeHtml(previewUrl)}"></video>`;
        break;
      case 'audio':
        body.innerHTML = `<audio class="attp-media" controls src="${escapeHtml(previewUrl)}"></audio>`;
        break;
      case 'text': {
        const r = await fetch(previewUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text();
        body.innerHTML = `<pre class="attp-text">${escapeHtml(t)}</pre>`;
        break;
      }
      case 'csv': {
        const r = await fetch(previewUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text();
        body.innerHTML = renderCsv(t);
        break;
      }
      case 'docx': {
        await loadScript(MAMMOTH_CDN);
        const r = await fetch(previewUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = await r.arrayBuffer();
        const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
        body.innerHTML = `<div class="attp-docx">${result.value || '<p class="text-muted">(empty document)</p>'}</div>`;
        break;
      }
      case 'xlsx': {
        await loadScript(XLSX_CDN);
        const r = await fetch(previewUrl);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = await r.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: 'array' });
        if (!wb.SheetNames.length) throw new Error('No sheets in workbook');
        const tabs = wb.SheetNames.map((n, i) =>
          `<button class="attp-tab${i === 0 ? ' active' : ''}" type="button" data-sheet-idx="${i}">${escapeHtml(n)}</button>`
        ).join('');
        const sheets = wb.SheetNames.map((n, i) => {
          const html = window.XLSX.utils.sheet_to_html(wb.Sheets[n], { editable: false });
          return `<div class="attp-sheet${i === 0 ? ' active' : ''}" data-sheet-idx="${i}">${html}</div>`;
        }).join('');
        body.innerHTML = `<div class="attp-tabs">${tabs}</div><div class="attp-sheets-wrap">${sheets}</div>`;
        body.querySelectorAll('.attp-tab').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = btn.dataset.sheetIdx;
            body.querySelectorAll('.attp-tab').forEach(x => x.classList.remove('active'));
            body.querySelectorAll('.attp-sheet').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            const target = body.querySelector('.attp-sheet[data-sheet-idx="' + idx + '"]');
            if (target) target.classList.add('active');
          });
        });
        break;
      }
      default:
        body.innerHTML = `<div class="attp-empty"><p>Preview not available for this file type.</p><a class="btn btn-primary btn-sm" href="${escapeHtml(dlUrl)}" download="${escapeHtml(filename)}">Download</a></div>`;
    }
  }

  function renderCsv(text) {
    // Simple CSV parser: handles quoted fields with embedded commas/quotes.
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return '<p class="text-muted">(empty)</p>';
    const head = rows.shift();
    const headHtml = head.map(c => `<th>${escapeHtml(c)}</th>`).join('');
    const bodyHtml = rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
    return `<div class="attp-csv-wrap"><table class="attp-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  }

  // Global click interceptor for attachment links.
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href*="/api/attachments/"]');
    if (!a) return;
    if (e.target.closest('.attp-modal')) return; // don't intercept inside our own modal
    const href = a.getAttribute('href') || '';
    if (!/\/(?:download|preview)(?:\?|$)/.test(href)) return;
    const filename = (a.getAttribute('download') || a.textContent || '').trim() || 'attachment';
    e.preventDefault();
    open(a.href, filename);
  });

  window.openAttachmentPreview = open;
  window.closeAttachmentPreview = close;

  // Render a preview into an element the caller owns, using the same viewers
  // as the modal. Used by the billing page, and by anything that wants a
  // document beside its list rather than on top of it.
  window.renderAttachmentPreviewInto = function (el, url, filename) {
    if (!el) return Promise.resolve();
    const previewUrl = previewUrlFor(url);
    const dlUrl = downloadUrlFor(url);
    el.innerHTML = '<div class="attp-loading">Loading…</div>';
    return render(el, previewUrl, dlUrl, filename).catch(err => {
      el.innerHTML = `<div class="attp-empty"><p>Preview failed: ${escapeHtml(err.message || String(err))}</p>` +
        `<a class="btn btn-primary btn-sm" href="${escapeHtml(dlUrl)}" download="${escapeHtml(filename)}">Download instead</a></div>`;
    });
  };
})();
