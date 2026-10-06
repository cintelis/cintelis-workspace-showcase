// ============================================================
// Cintelis Workspace — Attachments UI (Sprint 6)
// Drag-drop file upload, listing, delete, inline image preview
// on any entity (issue / doc_page / contact). Loaded as a regular
// <script> tag after app.js; uses state, api(), esc(), relTime()
// from app.js / tasks-ui.js. Exposes globals on window.
// ============================================================

(function () {
  state.attachments = state.attachments || {};
})();

// ── Helpers ──────────────────────────────────────────────────
function formatBytes(n) {
  n = Number(n || 0);
  if (n < 1024) return n + 'B';
  if (n < 1048576) return (n / 1024).toFixed(1) + 'KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB';
  return (n / 1073741824).toFixed(1) + 'GB';
}
window.formatBytes = formatBytes;

function mimeIcon(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/svg+xml') return '<span style="font-size:11px;font-weight:800;font-family:monospace;background:var(--surface2);color:var(--cyan);padding:2px 4px;border-radius:3px;border:1px solid var(--border)">SVG</span>';
  if (m.startsWith('image/')) return '\u{1F5BC}';   // picture
  if (m === 'application/pdf') return '\u{1F4C4}';  // page
  if (m.startsWith('text/')) return '\u{1F4DD}';    // memo
  if (m.startsWith('audio/')) return '\u{1F3B5}';   // note
  if (m.startsWith('video/')) return '\u{1F3AC}';   // clapper
  if (m.includes('zip') || m.includes('compressed')) return '\u{1F5C3}';
  return '\u{1F4CE}'; // paperclip default
}
window.mimeIcon = mimeIcon;

function canDeleteAttachment(att) {
  if (!att) return false;
  // Show delete for any member+ (admin or member). The backend enforces
  // the actual permission (uploader or admin only) on the DELETE request.
  // Viewers can't write so tasksCanWrite/docsCanWrite already hides the
  // entire upload zone. Showing delete to members avoids field-name
  // mismatches between att.uploaded_by and state.me.id.
  return state.me && state.me.role !== 'viewer';
}
window.canDeleteAttachment = canDeleteAttachment;

function attachmentsCacheKey(entityType, entityId) {
  return String(entityType) + ':' + String(entityId);
}

// ── Loaders ──────────────────────────────────────────────────
async function loadAttachments(entityType, entityId) {
  const key = attachmentsCacheKey(entityType, entityId);
  const r = await api('GET', '/api/attachments?entity_type=' + encodeURIComponent(entityType) + '&entity_id=' + encodeURIComponent(entityId));
  const list = (r && Array.isArray(r.attachments)) ? r.attachments
    : (r && Array.isArray(r.items)) ? r.items
    : (Array.isArray(r) ? r : []);
  state.attachments[key] = list;
  return list;
}
window.loadAttachments = loadAttachments;

// ── Upload ───────────────────────────────────────────────────
async function uploadOneFile(file, entityType, entityId) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  // Use fetch directly since api() sends JSON bodies. Must add Bearer token manually.
  const headers = {};
  const t = localStorage.getItem('token');
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch('/api/attachments', {
    method: 'POST',
    headers: headers,
    body: fd
  });
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok) {
    const err = (json && (json.error || json.message))
      || (res.status === 413 ? 'File is larger than 25 MB' : ('Upload failed (' + res.status + ')'));
    throw new Error(err);
  }
  return json;
}
window.uploadOneFile = uploadOneFile;

function attachUploadHandler(dropZoneEl, fileInputEl, entityType, entityId, onUploaded) {
  if (!dropZoneEl || dropZoneEl.dataset.attachWired === '1') return;
  dropZoneEl.dataset.attachWired = '1';

  const onDragOver = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dropZoneEl.classList.add('dragging');
  };
  const onDragLeave = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dropZoneEl.classList.remove('dragging');
  };
  const onDrop = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dropZoneEl.classList.remove('dragging');
    const files = (ev.dataTransfer && ev.dataTransfer.files) ? Array.from(ev.dataTransfer.files) : [];
    if (!files.length) return;
    await processFiles(files);
  };
  const onChange = async (ev) => {
    const files = (ev.target && ev.target.files) ? Array.from(ev.target.files) : [];
    if (!files.length) return;
    await processFiles(files);
    try { ev.target.value = ''; } catch (e) { /* ignore */ }
  };

  async function processFiles(files) {
    const progressSlot = dropZoneEl.querySelector('.attachments-progress');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (progressSlot) {
        progressSlot.textContent = 'Uploading ' + (i + 1) + '/' + files.length + ': ' + f.name + '\u2026';
      }
      try {
        await uploadOneFile(f, entityType, entityId);
      } catch (e) {
        if (progressSlot) progressSlot.textContent = '';
        toastError('Upload failed for ' + f.name + ': ' + (e && e.message ? e.message : String(e)));
      }
    }
    if (progressSlot) progressSlot.textContent = '';
    if (typeof onUploaded === 'function') onUploaded();
  }

  dropZoneEl.addEventListener('dragover', onDragOver);
  dropZoneEl.addEventListener('dragenter', onDragOver);
  dropZoneEl.addEventListener('dragleave', onDragLeave);
  dropZoneEl.addEventListener('drop', onDrop);
  if (fileInputEl) fileInputEl.addEventListener('change', onChange);
}
window.attachUploadHandler = attachUploadHandler;

// ── Delete ───────────────────────────────────────────────────
async function confirmDeleteAttachment(attachmentId, entityType, entityId, onDeleted) {
  if (!(await appConfirm('Delete this attachment? This cannot be undone.'))) return;
  const r = await api('DELETE', '/api/attachments/' + encodeURIComponent(attachmentId));
  if (r && (r.ok || r.deleted)) {
    toastSuccess('Attachment deleted');
    if (typeof onDeleted === 'function') onDeleted();
  } else {
    toastError((r && r.error) || 'Failed to delete attachment');
  }
}
window.confirmDeleteAttachment = confirmDeleteAttachment;

function deleteAttachmentAndRefresh(attId, entityType, entityId) {
  confirmDeleteAttachment(attId, entityType, entityId, function () {
    // Find the panel container and re-render
    var el = document.getElementById('issue-attachments-panel')
          || document.getElementById('page-attachments-panel');
    if (el) {
      // Clear cache so it re-fetches
      if (state.attachments) delete state.attachments[entityType + ':' + entityId];
      renderAttachmentsPanel(el, entityType, entityId);
    }
  });
}
window.deleteAttachmentAndRefresh = deleteAttachmentAndRefresh;

// ── Render ───────────────────────────────────────────────────
async function renderAttachmentsPanel(containerEl, entityType, entityId) {
  if (!containerEl) return;
  const key = attachmentsCacheKey(entityType, entityId);
  if (!state.attachments[key]) {
    containerEl.innerHTML = '<div class="attachments-panel"><div class="attachments-head"><div class="attachments-title">Attachments</div></div><div class="text-muted text-sm">Loading\u2026</div></div>';
    try {
      await loadAttachments(entityType, entityId);
    } catch (e) {
      containerEl.innerHTML = '<div class="attachments-panel"><div class="text-muted text-sm">Failed to load attachments.</div></div>';
      return;
    }
  }
  const list = state.attachments[key] || [];
  const reRender = () => renderAttachmentsPanel(containerEl, entityType, entityId);
  const onChanged = async () => {
    await loadAttachments(entityType, entityId);
    reRender();
  };

  const rowsHTML = list.length
    ? list.map(att => renderAttachmentRow(att, entityType, entityId)).join('')
    : '<div class="attachments-empty">No attachments yet \u2014 drag a file here to upload.</div>';

  containerEl.innerHTML = `
    <div class="attachments-panel">
      <div class="attachments-head">
        <div class="attachments-title">Attachments <span class="text-muted text-sm">(${list.length})</span></div>
      </div>
      <div class="attachments-drop-zone" id="att-dz-${esc(entityType)}-${esc(entityId)}">
        <input type="file" multiple id="att-input-${esc(entityType)}-${esc(entityId)}" style="display:none">
        <div class="attachments-drop-hint">
          Drag files here or
          <a href="javascript:void(0)" onclick="document.getElementById('att-input-${esc(entityType)}-${esc(entityId)}').click()">browse</a>
          <span class="text-muted text-sm"> (max 25 MB each)</span>
        </div>
        <div class="attachments-progress text-muted text-sm"></div>
      </div>
      <div class="attachments-list">
        ${rowsHTML}
      </div>
    </div>
  `;

  const dz = document.getElementById('att-dz-' + entityType + '-' + entityId);
  const fi = document.getElementById('att-input-' + entityType + '-' + entityId);
  attachUploadHandler(dz, fi, entityType, entityId, onChanged);

  // Wire delete buttons.
  const delBtns = containerEl.querySelectorAll('[data-att-del]');
  delBtns.forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.getAttribute('data-att-del');
      confirmDeleteAttachment(id, entityType, entityId, onChanged);
    });
  });
}
window.renderAttachmentsPanel = renderAttachmentsPanel;

function renderAttachmentRow(att, entityType, entityId) {
  const mime = att.mime_type || '';
  const isImage = String(mime).toLowerCase().startsWith('image/');
  const filename = att.filename || '(unnamed)';
  const size = formatBytes(att.size_bytes);
  const uploader = (att.uploader_name || att.uploaded_by_name || att.uploader_email || att.uploaded_by) || '';
  const when = att.created_at ? relTime(att.created_at) : '';
  const tk = localStorage.getItem('token') || '';
  const downloadUrl = '/api/attachments/' + encodeURIComponent(att.id) + '/download?token=' + encodeURIComponent(tk);
  const previewUrl = '/api/attachments/' + encodeURIComponent(att.id) + '/preview?token=' + encodeURIComponent(tk);
  const canDel = canDeleteAttachment(att);
  const thumb = isImage
    ? `<a class="attachment-thumb-wrap" href="${esc(previewUrl)}" target="_blank" rel="noopener"><img class="attachment-thumb" src="${esc(previewUrl)}" alt="${esc(filename)}"></a>`
    : `<div class="attachment-row-icon">${mimeIcon(mime)}</div>`;
  return `
    <div class="attachment-row">
      ${thumb}
      <div class="attachment-row-meta">
        <div class="attachment-row-title">
          <a href="${esc(downloadUrl)}" target="_blank" rel="noopener">${esc(filename)}</a>
        </div>
        <div class="attachment-row-sub text-muted text-sm">
          <span>${esc(size)}</span>
          ${uploader ? `<span> \u00b7 ${esc(uploader)}</span>` : ''}
          ${when ? `<span> \u00b7 ${esc(when)}</span>` : ''}
        </div>
      </div>
      <div class="attachment-row-actions">
        <a class="btn btn-ghost btn-sm" href="${esc(downloadUrl)}" target="_blank" rel="noopener">Download</a>
        ${canDel ? `<button class="btn btn-ghost btn-sm" type="button" style="color:var(--red)" onclick="deleteAttachmentAndRefresh('${esc(att.id)}','${esc(entityType)}','${esc(entityId)}')">Delete</button>` : ''}
      </div>
    </div>
  `;
}

// ============================================================
// My open issues widget (Overview page)
// ============================================================
async function renderMyIssuesWidget() {
  const container = document.getElementById('my-issues-widget');
  if (!container) return;
  container.innerHTML = '<div class="text-muted text-sm">Loading\u2026</div>';
  try {
    const r = await api('GET', '/api/me/my-issues');
    const issues = (r && Array.isArray(r.issues)) ? r.issues
      : (Array.isArray(r) ? r : []);
    if (!issues.length) {
      container.innerHTML = `
        <div class="card">
          <div class="card-head"><div class="card-title">My open issues</div></div>
          <div class="card-body"><p class="text-muted">You have no open issues. \u2728</p></div>
        </div>
      `;
      return;
    }
    const rows = issues.map(i => {
      const priority = `<span class="lozenge lozenge-priority-${esc(i.priority)}">${esc(i.priority)}</span>`;
      const status = `<span class="lozenge lozenge-status-${esc(i.status)}">${esc(i.status)}</span>`;
      const due = i.due_at ? `<span class="text-muted text-sm">due ${esc(relTime(i.due_at))}</span>` : '';
      const openExpr = (typeof openIssueDetail === 'function')
        ? `openIssueDetail('${esc(i.id)}')`
        : `nav('projects')`;
      return `
        <div class="my-issue-row" onclick="${openExpr}">
          <span class="mono">${esc(i.issue_key || '')}</span>
          <span class="my-issue-title">${esc(i.title || '')}</span>
          ${status}
          ${priority}
          ${due}
        </div>
      `;
    }).join('');
    container.innerHTML = `
      <div class="card">
        <div class="card-head"><div class="card-title">My open issues</div></div>
        <div class="card-body" style="padding:0">
          <div class="my-issues-list">${rows}</div>
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="text-muted text-sm">Failed to load: ${esc(String((e && e.message) || e))}</div>`;
  }
}
window.renderMyIssuesWidget = renderMyIssuesWidget;
