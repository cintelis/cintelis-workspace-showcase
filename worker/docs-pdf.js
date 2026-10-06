import { PUBLIC_HOST } from './config.js';
// Server-side PDF rendering for doc pages, via Cloudflare Browser Rendering.
// Loads the page from D1, renders the markdown to a clean print-styled HTML,
// then captures a real Chromium PDF for vector text and faithful layout.
import puppeteer from '@cloudflare/puppeteer';
import { marked } from 'marked';
import { scopedFirst } from './scope.js';

function jres(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function generatePagePdf(env, ctx, pgId) {
  const row = await scopedFirst(env, ctx, {
    sql: `SELECT p.id, p.title, p.content_md, p.updated_at, p.space_id,
            s.key AS space_key, s.name AS space_name,
            uu.display_name AS updated_by_name
     FROM doc_pages p JOIN doc_spaces s ON s.id = p.space_id LEFT JOIN users uu ON uu.id = p.updated_by WHERE p.id = ? AND p.active = 1 AND /*SCOPE*/`,
    binds: [pgId], alias: 's',
  });
  if (!row) return jres({ error: 'Page not found' }, 404);

  if (!env.BROWSER) {
    return jres({ error: 'Browser Rendering binding is not configured' }, 500);
  }

  const html = buildPrintHtml(row);

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Drive mermaid + font rendering in-page before capture.
    await page.evaluate(async () => {
      try {
        if (window.mermaid && typeof window.mermaid.run === 'function') {
          await window.mermaid.run({ querySelector: '.mermaid', suppressErrors: true });
        }
      } catch { /* leave any failed blocks as plain text */ }
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:8pt;color:#8A8A8A;width:100%;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0 16mm;letter-spacing:.2px;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + safeFilename(row.title) + '.pdf"',
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return jres({ error: 'PDF generation failed: ' + (err?.message || String(err)) }, 500);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

function safeFilename(title) {
  return String(title || 'page')
    .replace(/[^a-zA-Z0-9._\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'page';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Mirror the client-side post-processors so the PDF matches what users see
// in the app: mermaid code-fences become rendered diagrams, and [[wiki-links]]
// become styled iris references.
function postProcessRenderedHtml(html) {
  // ```mermaid``` → <div class="mermaid"> (mermaid.run() picks it up in puppeteer)
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi,
    function (_m, content) {
      const decoded = content
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      return '<div class="mermaid">' + decoded + '</div>';
    }
  );
  // [[Page Title]] or [[SPACE/Page Title]] → styled wiki-link span
  html = html.replace(
    /\[\[([^\]]{1,120})\]\]/g,
    function (_m, raw) {
      const t = raw
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const display = t.includes('/') ? t.split('/').slice(1).join('/') : t;
      const space = t.includes('/') ? t.split('/')[0] : '';
      const spaceHint = space
        ? '<span class="wiki-link-space">' + escapeHtml(space) + '</span>'
        : '';
      return '<span class="wiki-link">' + spaceHint + escapeHtml(display) + '</span>';
    }
  );
  return html;
}

function buildPrintHtml(row) {
  const rawHtml = marked.parse(String(row.content_md || ''), { breaks: true, gfm: true });
  const bodyHtml = postProcessRenderedHtml(rawHtml);
  const title = escapeHtml(row.title || 'Untitled');
  const spaceLine = [row.space_name, row.space_key].filter(Boolean).map(escapeHtml).join(' · ');
  const updated = row.updated_at
    ? new Date(row.updated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const meta = [
    updated ? `Last updated ${escapeHtml(updated)}` : '',
    row.updated_by_name ? `by ${escapeHtml(row.updated_by_name)}` : '',
  ].filter(Boolean).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  // Initialise mermaid but defer rendering — the PDF worker calls mermaid.run()
  // after setContent so we can await diagram completion before capture.
  if (window.mermaid) {
    try { window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' }); } catch (e) {}
  }
</script>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#0F0F0F}
  body{font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11pt;line-height:1.6;letter-spacing:-0.1px;-webkit-font-smoothing:antialiased}
  .doc-header{border-bottom:1px solid #C4C4C4;padding-bottom:14px;margin-bottom:22px}
  .doc-space{font-size:9pt;color:#6E5CCC;letter-spacing:1px;text-transform:uppercase;font-weight:600;margin-bottom:6px}
  .doc-title{font-size:26pt;font-weight:700;color:#0F0F0F;margin:0 0 8px;line-height:1.15;letter-spacing:-0.8px}
  .doc-meta{font-size:9.5pt;color:#8A8A8A}
  h1,h2,h3,h4,h5,h6{font-weight:700;color:#0F0F0F;line-height:1.25;margin-top:1.4em;margin-bottom:0.5em;page-break-after:avoid;break-after:avoid;letter-spacing:-0.3px}
  h1{font-size:20pt}
  h2{font-size:16pt;border-bottom:0.5pt solid #E2E2E2;padding-bottom:4px}
  h3{font-size:13pt}
  h4{font-size:11pt}
  h5,h6{font-size:10.5pt;color:#444}
  p{margin:0 0 0.9em;orphans:3;widows:3}
  a{color:#6E5CCC;text-decoration:underline;word-break:break-word}
  img{max-width:100%;height:auto;page-break-inside:avoid;break-inside:avoid;border-radius:4px}
  code{font-family:'Geist Mono','SF Mono','Fira Code',monospace;background:#F3F1FC;color:#3a2c8c;padding:1px 6px;border-radius:3px;font-size:0.88em}
  pre{background:#F7F7F7;border:0.5pt solid #E2E2E2;border-radius:6px;padding:12px 14px;overflow:hidden;white-space:pre-wrap;word-break:break-word;font-size:9.5pt;line-height:1.55;page-break-inside:avoid;break-inside:avoid;font-family:'Geist Mono','SF Mono','Fira Code',monospace}
  pre code{background:transparent;color:#0F0F0F;padding:0}
  blockquote{border-left:3px solid #6E5CCC;background:#F8F7FE;padding:10px 14px;color:#333;margin:1em 0;page-break-inside:avoid;break-inside:avoid;border-radius:0 4px 4px 0}
  blockquote p:last-child{margin-bottom:0}
  ul,ol{padding-left:1.6em;margin:0 0 0.9em}
  li{margin-bottom:0.3em}
  hr{border:none;border-top:1px solid #E2E2E2;margin:1.6em 0}
  table{border-collapse:collapse;margin:0.8em 0;width:100%;font-size:9.5pt;page-break-inside:auto}
  table th,table td{border:0.5pt solid #C4C4C4;padding:7px 11px;text-align:left;vertical-align:top}
  table thead{display:table-header-group}
  table thead th{background:#F3F1FC;color:#0F0F0F;font-weight:600}
  tr{page-break-inside:avoid;break-inside:avoid}
  .wiki-link{color:#6E5CCC;font-weight:500;border-bottom:0.5pt dashed #6E5CCC;padding:0 1px}
  .wiki-link-space{font-size:0.78em;color:#9B8EE8;background:#F3F1FC;padding:1px 5px;border-radius:3px;margin-right:5px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;border:0.25pt solid #DDD8F7;vertical-align:1px}
  .mermaid{margin:1em 0;text-align:center;page-break-inside:avoid;break-inside:avoid;background:#FFFFFF;border:0.5pt solid #E2E2E2;border-radius:6px;padding:14px}
  .mermaid svg{max-width:100%;height:auto}
  .doc-footer{margin-top:36px;padding-top:14px;border-top:0.5pt solid #C4C4C4;color:#8A8A8A;font-size:8.5pt;display:flex;justify-content:space-between;align-items:center}
  .doc-footer-mark{display:flex;align-items:center;gap:8px}
  .doc-footer-mark svg{display:block}
</style>
</head>
<body>
<div class="doc-header">
  ${spaceLine ? `<div class="doc-space">${spaceLine}</div>` : ''}
  <h1 class="doc-title">${title}</h1>
  ${meta ? `<div class="doc-meta">${meta}</div>` : ''}
</div>
<div class="doc-body">${bodyHtml}</div>
<div class="doc-footer">
  <div class="doc-footer-mark">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" width="14" height="14"><circle cx="20" cy="20" r="15" stroke="#C4C4C4" stroke-width="1.5" fill="none"/><circle cx="20" cy="20" r="5" fill="#6E5CCC"/></svg>
    <span>Cintelis Workspace · </span>
  </div>
  <div>${escapeHtml(updated || '')}</div>
</div>
</body>
</html>`;
}
