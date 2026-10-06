// ============================================================
// Cintelis Workspace — Outreach & CRM Worker
// Cloudflare Worker: API backend + serves dashboard
// Bindings required: DB (D1), KV (KV Namespace), UNSUBSCRIBES (KV — shared with email worker),
//                   ADMIN_USER, ADMIN_PASS (secrets — break-glass after Sprint 1 bootstrap)
//
// Unsubscribe handling is fully delegated to the 365soft-email-worker.
// Set MAIL_UNSUBSCRIBE_BASE_URL on that worker to enable signed token links.
// Set MAIL_UNSUBSCRIBE_NOTIFY_EMAIL on that worker for admin notifications.
//
// Sprint 1 (auth foundation): multi-user auth lives in worker/auth.js +
// worker/sessions.js. ADMIN_USER/ADMIN_PASS are bootstrapped into the users
// table on first login and remain valid as a parallel break-glass credential
// regardless of the DB password. Bearer tokens are now D1-backed session ids;
// the legacy KV `sess:*` keys are no longer read or written.
// ============================================================

import {
  hashPassword, verifyPassword,
  generateTotpSecret, verifyTotp,
  generateBackupCodes, findMatchingBackupCode,
  generateUserId,
} from './worker/auth.js';
import {
  createSession, getActiveSession, revokeSession,
  promotePendingTwoFactor, touchSession,
} from './worker/sessions.js';
import { emit } from './worker/events.js';
import { PUBLIC_BASE_URL, PUBLIC_HOST, API_HOST, LEGACY_HOSTS } from './worker/config.js';
import {
  enforceCustomerScope, isCustomerUser, customerIdForCreate, createCustomerUser, canAccessEntity,
  getCustomer, listCustomers, createCustomer, getCustomerDetail, patchCustomer,
  createContract, patchContract, deleteContract, getMyCustomer, onContractDocumentUploaded,
} from './worker/customers.js';
import {
  listProjects as tasksListProjects, createProject as tasksCreateProject,
  getProject as tasksGetProject, patchProject as tasksPatchProject, deleteProject as tasksDeleteProject,
  listIssues as tasksListIssues, createIssue as tasksCreateIssue,
  getIssue as tasksGetIssue, patchIssue as tasksPatchIssue, deleteIssue as tasksDeleteIssue,
  addIssueComment as tasksAddIssueComment, deleteActivity as tasksDeleteActivity, patchActivity as tasksPatchActivity,
  cloneIssue, listRoadmapIssues,
} from './worker/tasks.js';
import {
  listProjectSprints, createSprint,
  getSprint, patchSprint, deleteSprint,
  startSprint, completeSprint,
  addIssuesToSprint, removeIssueFromSprint,
  getBurndown,
} from './worker/sprints.js';
import {
  listSpaces, createSpace, getSpace, patchSpace, deleteSpace,
  listSpacePages, createPage, getPage, getPageBySlug, patchPage, deletePage,
  listPageVersions, getPageVersion, restorePageVersion,
} from './worker/docs.js';
import { generatePagePdf } from './worker/docs-pdf.js';
import { requireApiToken, adminMintApiToken, adminListApiTokens, adminRevokeApiToken } from './worker/api-tokens.js';
import { apiV1UpsertPage, apiV1GetPage, apiV1DeletePage } from './worker/api-v1-docs.js';
import { apiV1UpsertContact } from './worker/api-v1-crm.js';
import { sendEmail, getSenderIdentity, putSenderIdentity, deleteSenderIdentity } from './worker/email.js';
import * as crm from './worker/crm.js';
import * as crmTasks from './worker/crm-tasks.js';
import * as crmCompanies from './worker/crm-companies.js';
import * as crmDeals from './worker/crm-deals.js';
import { scopedAll, scopedFirst } from './worker/scope.js';
import {
  listNotifications, getUnreadCount, markRead, markAllRead, mentionSearch,
} from './worker/notifications.js';
import {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment,
  deleteAttachmentsForEntity,
} from './worker/attachments.js';
import {
  listLinks, createLink, deleteLink, deleteLinksForEntity, entitySearch,
} from './worker/entity-links.js';
import {
  getFeatureVisibility, patchFeatureVisibility, isFeatureAllowed,
} from './worker/app-settings.js';
import {
  listFieldDefs, createFieldDef, patchFieldDef, deleteFieldDef,
  getCustomValues, setCustomValues,
} from './worker/custom-fields.js';
import {
  listDependencies, addDependency, removeDependency, deleteDepsForIssue,
} from './worker/dependencies.js';
import {
  startConnect as linkedinStartConnect, handleOAuthCallback as linkedinCallback,
  getStatus as linkedinStatus, disconnect as linkedinDisconnect,
  searchAds as linkedinSearchAds, searchBrandPartnerships as linkedinSearchBrandPartnerships,
  uploadMedia as linkedinUploadMedia,
  createPost as linkedinCreatePost, listPosts as linkedinListPosts,
  publishPostNow as linkedinPublishPost, deletePost as linkedinDeletePost,
  apiGetAnalytics as linkedinGetAnalytics, apiRefreshAnalytics as linkedinRefreshAnalytics,
  listComments as linkedinListComments, refreshComments as linkedinRefreshComments,
  replyToComment as linkedinReplyComment, runLinkedInScheduler,
} from './worker/linkedin.js';
import {
  startConnect as xeroStartConnect, handleCallback as xeroCallback,
  getStatus as xeroStatus, setTenant as xeroSetTenant, disconnect as xeroDisconnect,
  searchContacts as xeroSearchContacts, linkCustomerContact as xeroLinkContact,
  unlinkCustomerContact as xeroUnlinkContact, syncNow as xeroSyncNow,
  listCustomerInvoices as xeroCustomerInvoices, listMyInvoices as xeroMyInvoices,
  serveInvoicePdf as xeroInvoicePdf, runXeroScheduler,
} from './worker/xero.js';
import { handleInternalPage, issueTicket as internalPageTicket } from './worker/internal-pages.js';

const CRM_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
const SYSTEM_EMAIL_FROM = 'noreply@cintelis.ai';
const SYSTEM_EMAIL_NAME = 'Cintelis Workspace';

// ── Transactional email templates (user account notifications) ──
function systemEmailWrapper(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;border:1px solid #dfe1e6;overflow:hidden">
      <div style="background:#0C66E4;padding:20px 28px">
        <div style="color:#ffffff;font-size:18px;font-weight:700">Cintelis Workspace</div>
      </div>
      <div style="padding:28px">
        <h2 style="margin:0 0 16px;font-size:20px;color:#172B4D">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #dfe1e6;background:#f4f5f7;font-size:12px;color:#6B778C">
        This is an automated message from <a href="${CRM_PUBLIC_BASE_URL}" style="color:#0C66E4;text-decoration:none">Cintelis Workspace</a>. Do not reply to this email.
      </div>
    </div>
  </body></html>`;
}

async function sendSystemEmail(env, to, subject, title, bodyHtml) {
  if (!to) return;
  try {
    await sendEmail(env, {
      to,
      subject: `[Cintelis Workspace] ${subject}`,
      html_body: systemEmailWrapper(title, bodyHtml),
      from_email: SYSTEM_EMAIL_FROM,
      from_name: SYSTEM_EMAIL_NAME,
    });
  } catch (e) {
    console.error('System email failed:', e?.message || e);
  }
}

async function notifyAccountCreated(env, email, displayName, role, tempPassword) {
  await sendSystemEmail(env, email,
    'Your account has been created',
    'Welcome to Cintelis Workspace',
    `<p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${displayName || 'there'},</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">An account has been created for you on <strong>Cintelis Workspace</strong>.</p>
     <table style="margin:0 0 18px;border-collapse:collapse;font-size:14px;color:#172B4D">
       <tr><td style="padding:6px 14px 6px 0;color:#6B778C;font-weight:600">Email</td><td style="padding:6px 0">${email}</td></tr>
       <tr><td style="padding:6px 14px 6px 0;color:#6B778C;font-weight:600">Role</td><td style="padding:6px 0">${role}</td></tr>
       <tr><td style="padding:6px 14px 6px 0;color:#6B778C;font-weight:600">Temporary password</td><td style="padding:6px 0;font-family:monospace;background:#f4f5f7;padding:6px 10px;border-radius:4px">${tempPassword}</td></tr>
     </table>
     <p style="margin:0 0 18px;color:#172B4D;font-size:15px;line-height:1.6">Please sign in and change your password immediately.</p>
     <a href="${CRM_PUBLIC_BASE_URL}" style="display:inline-block;padding:12px 24px;background:#0C66E4;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Sign in to Cintelis Workspace</a>`
  );
}

// Customer onboarding welcome (Cintelis-branded). Sent when a customer user is
// created by onboarding (POST /api/customers) or POST /api/users with customer_id.
async function notifyCustomerWelcome(env, { to, name, customerName, password }) {
  if (!to) return;
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#172B4D">
      <div style="font-size:20px;font-weight:700;margin-bottom:16px">Welcome to Cintelis Workspace</div>
      <p>Hi ${h(name || 'there')},</p>
      <p>Cintelis has set up a workspace for <strong>${h(customerName)}</strong>. Use the details below to sign in:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px 6px 0;color:#6B778C">Sign-in URL</td><td style="padding:6px 0"><a href="${CRM_PUBLIC_BASE_URL}" style="color:#0C66E4">${CRM_PUBLIC_BASE_URL}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6B778C">Email</td><td style="padding:6px 0">${h(to)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6B778C">Temporary password</td><td style="padding:6px 0"><code style="font-size:14px">${h(password)}</code></td></tr>
      </table>
      <p>Please change your password after your first sign-in (My Account → Password). Your workspace includes Projects, Spaces (docs), Roadmap and Contract &amp; Billing.</p>
      <a href="${CRM_PUBLIC_BASE_URL}" style="display:inline-block;padding:12px 24px;background:#0F1114;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Sign in to Cintelis Workspace</a>
      <p style="margin-top:24px;font-size:12px;color:#6B778C">This is an automated message from Cintelis (nick@cintelis.ai). Reply to this email if you need help.</p>
    </div>`;
  try {
    await sendEmail(env, {
      to,
      subject: 'Your Cintelis Workspace is ready',
      html_body: html,
      from_email: SYSTEM_EMAIL_FROM,
      from_name: 'Cintelis',
    });
  } catch (e) {
    console.error('Customer welcome email failed:', e?.message || e);
    throw e;
  }
}

// Email to a Cintelis admin when a customer uploads a contract document.
async function notifyContractDocumentEmail(env, { to, customerName, customerId, contractTitle, filename, uploader }) {
  if (!to) return;
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = `${CRM_PUBLIC_BASE_URL}/#/customer/${encodeURIComponent(customerId)}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#172B4D">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">${h(customerName)} uploaded a contract document</div>
      <p><strong>${h(uploader)}</strong> uploaded <strong>${h(filename)}</strong> to the contract <em>${h(contractTitle)}</em>.</p>
      <a href="${link}" style="display:inline-block;padding:10px 20px;background:#0F1114;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Open customer</a>
      <p style="margin-top:20px;font-size:12px;color:#6B778C">Automated message from Cintelis Workspace.</p>
    </div>`;
  await sendEmail(env, {
    to,
    subject: `${customerName}: contract document uploaded`,
    html_body: html,
    from_email: SYSTEM_EMAIL_FROM,
    from_name: 'Cintelis',
  });
}

async function notifyPasswordChanged(env, email, displayName, changedBy) {
  await sendSystemEmail(env, email,
    'Your password has been changed',
    'Password Changed',
    `<p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${displayName || 'there'},</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Your password on Cintelis Workspace was ${changedBy === 'self' ? 'changed by you' : 'reset by an administrator'}.</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">If you did not make this change, please contact your administrator immediately.</p>`
  );
}

async function notifyRoleChanged(env, email, displayName, oldRole, newRole) {
  await sendSystemEmail(env, email,
    'Your role has been updated',
    'Role Updated',
    `<p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${displayName || 'there'},</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Your role on Cintelis Workspace has been changed from <strong>${oldRole}</strong> to <strong>${newRole}</strong>.</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">This change takes effect on your next page load.</p>`
  );
}

async function notifyAccountDeactivated(env, email, displayName) {
  await sendSystemEmail(env, email,
    'Your account has been deactivated',
    'Account Deactivated',
    `<p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${displayName || 'there'},</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Your account on Cintelis Workspace has been deactivated by an administrator. You will no longer be able to sign in.</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">If you believe this is a mistake, please contact your team administrator.</p>`
  );
}

async function notifyMfaReset(env, email, displayName) {
  await sendSystemEmail(env, email,
    'Your MFA has been reset',
    'Multi-Factor Authentication Reset',
    `<p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Hi ${displayName || 'there'},</p>
     <p style="margin:0 0 14px;color:#172B4D;font-size:15px;line-height:1.6">Your multi-factor authentication (MFA) has been reset by an administrator. You will need to set up MFA again on your next sign-in via <strong>My Account → Enable MFA</strong>.</p>`
  );
}
function getAdsOptimiserRealEstateTemplates() {
  return [
    {
      id: 'seed_ao_re_snapshot_v2',
      name: 'Ads Optimiser - Snapshot Style',
      subject: 'Turn listing photos into video walkthroughs buyers will watch',
      html_body: renderSnapshotStyleTemplate()
    },
    {
      id: 'seed_ao_re_prestige_magazine_v2',
      name: 'Ads Optimiser - Prestige Magazine Style',
      subject: 'A premium video walkthrough from the same listing photo set',
      html_body: renderPrestigeMagazineTemplate()
    },
    {
      id: 'seed_ao_re_market_insight_v2',
      name: 'Ads Optimiser - Market Insight Style',
      subject: 'In a million-dollar market, listings need more than static images',
      html_body: renderMarketInsightTemplate()
    },
    {
      id: 'seed_ao_re_agent_update_v2',
      name: 'Ads Optimiser - Agent Update Style',
      subject: 'A simple way to turn still listing images into walkthrough video',
      html_body: renderAgentUpdateTemplate()
    },
    {
      id: 'seed_ao_re_luxury_homes_editorial_v3',
      name: 'Ads Optimiser - Luxury Homes Magazine Style',
      subject: 'Luxury listings deserve more than a static image gallery',
      html_body: renderLuxuryHomesEditorialTemplate(CRM_PUBLIC_BASE_URL)
    }
  ];
}

function renderBrandLockup(subtitle, dark = true) {
  return `<table role="presentation" cellspacing="0" cellpadding="0">
    <tr>
      <td style="width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);text-align:center;font-size:22px;font-weight:800;color:#ffffff;">AO</td>
      <td style="padding-left:12px;">
        <div style="font-size:18px;line-height:1.2;font-weight:700;color:${dark ? '#ffffff' : '#111827'};">Ads Optimiser</div>
        <div style="margin-top:4px;font-size:12px;line-height:1.4;color:${dark ? '#cbd5e1' : '#64748b'};">${subtitle}</div>
      </td>
    </tr>
  </table>`;
}

function renderVideoLinksPanel(title, note) {
  return `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${title}</div>
  <p style="margin:10px 0 18px;font-size:15px;line-height:1.6;color:#4b5563;">${note}</p>
  <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
    <tr>
      <td style="padding:0 12px 12px 0;">
        <a href="https://www.youtube.com/watch?v=replace-me" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#fe2c55;color:#ffffff;text-decoration:none;font-weight:700;">Watch sample on YouTube</a>
      </td>
      <td style="padding:0 0 12px 0;">
        <a href="https://app.adsoptimiser.com.au/media/videos/replace-me.mp4" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#eff6ff;color:#1d4ed8;text-decoration:none;font-weight:700;border:1px solid #bfdbfe;">Open hosted video</a>
      </td>
    </tr>
  </table>`;
}

function renderFooter(note) {
  return `<tr>
    <td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa;">
      <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#6b7280;">${note}</p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">Before sending, replace the sample video URLs with your YouTube link or your Ads Optimiser hosted video URL.</p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">If this is not relevant for you, you can <a href="{{unsubscribe_url}}" style="color:#2563eb;text-decoration:none;">unsubscribe here</a>.</p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">{{physical_address}}</p>
    </td>
  </tr>`;
}

function renderLuxuryHomesFooter(origin = CRM_PUBLIC_BASE_URL) {
  const iconWrapStyle = 'display:inline-block;width:34px;height:34px;border-radius:999px;background:#eff6ff;text-decoration:none;text-align:center;vertical-align:middle;';
  const iconStyle = 'display:block;width:18px;height:18px;margin:8px auto;border:0;outline:none;text-decoration:none;';
  const instagramIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/instagram.png?v=3')}" width="18" height="18" alt="Instagram" style="${iconStyle}">`;
  const youtubeIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/youtube.png?v=3')}" width="18" height="18" alt="YouTube" style="${iconStyle}">`;
  const tiktokIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/tiktok.png?v=3')}" width="18" height="18" alt="TikTok" style="${iconStyle}">`;
  const facebookIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/facebook.png?v=3')}" width="18" height="18" alt="Facebook" style="${iconStyle}">`;
  const linkedinIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/linkedin.png?v=3')}" width="18" height="18" alt="LinkedIn" style="${iconStyle}">`;
  return `<tr>
    <td style="padding:24px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa;">
      <p style="margin:0 0 14px;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">Ads Optimiser helps luxury real estate agencies turn premium listing photography into polished video walkthrough campaigns.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
        <tr>
          <td align="center" style="padding:0 0 12px;">
            <a href="https://adsoptimiser.com.au/#signup" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Sign Up</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/terms.html" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Terms of use</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/privacy.html" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Privacy Policy</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/#contact" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Contact us</a>
          </td>
        </tr>
        <tr>
          <td align="center">
            <table role="presentation" cellspacing="0" cellpadding="0">
              <tr>
                <td style="padding:0 5px;">
                  <a href="https://www.instagram.com/adsoptimiserapp" title="Instagram" style="${iconWrapStyle}">
                    ${instagramIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.youtube.com/@adsoptimiserapp" title="YouTube" style="${iconWrapStyle}">
                    ${youtubeIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.tiktok.com/@plainenglishcyber" title="TikTok" style="${iconWrapStyle}">
                    ${tiktokIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.facebook.com/profile.php?id=61587247657068" title="Facebook" style="${iconWrapStyle}">
                    ${facebookIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.linkedin.com/company/ads-optimiser-app" title="LinkedIn" style="${iconWrapStyle}">
                    ${linkedinIcon}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;">You're receiving this because we think you'd be a great fit for what we do.</p>
      <p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;">&copy; Ads Optimiser is a registered business name of Cintelis Pty Limited ABN 51 638 482 970. All rights reserved.</p>
      <p style="margin:0;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;"><a href="{{unsubscribe_url}}" style="color:#2563eb;text-decoration:none;">Unsubscribe</a><span style="padding:0 10px;color:#cbd5e1;">|</span>Ads Optimiser, Sunshine Coast, QLD.</p>
    </td>
  </tr>`;
}

function renderTemplateShell(inner, footerNote, outerBackground = '#f3f4f6', customFooter = '') {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:${outerBackground};font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <!-- Replace the sample video links below before sending:
         1. https://www.youtube.com/watch?v=replace-me
         2. https://app.adsoptimiser.com.au/media/videos/replace-me.mp4
    -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${outerBackground};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;">
            ${inner}
            ${customFooter || renderFooter(footerNote)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function absoluteAssetUrl(origin, path) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const cleanOrigin = String(origin || '').replace(/\/+$/, '');
  return cleanOrigin ? `${cleanOrigin}/${cleanPath}` : `/${cleanPath}`;
}

function renderSnapshotStyleTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px 28px 18px;background:#111827;">
        ${renderBrandLockup('Snapshot-style outreach for listing video', true)}
      </td>
    </tr>
    <tr>
      <td style="padding:30px 28px 14px;background:#eaf2ff;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Real estate marketing</div>
        <h1 style="margin:10px 0 12px;font-size:31px;line-height:1.12;color:#111827;">Turn static property photos into a standout walkthrough.</h1>
        <p style="margin:0;font-size:16px;line-height:1.7;color:#334155;">Hi {{name}}, if your team already has the listing image set, Ads Optimiser can turn it into a short branded video that feels stronger than a static gallery and lighter than a filmed on-site shoot.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 8px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:50%;padding:0 8px 12px 0;vertical-align:top;">
              <div style="padding:16px;border:1px solid #dbeafe;border-radius:14px;background:#f8fbff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Reuse what you have</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Exterior, living, kitchen, bedroom, amenity and floorplan images become one polished motion asset.</div>
              </div>
            </td>
            <td style="width:50%;padding:0 0 12px 8px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #fee2e2;border-radius:14px;background:#fff7f8;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fe2c55;">Use it everywhere</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Perfect for social reels, listing launches, appraisal decks, vendor updates and buyer nurture email.</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 22px;">
        <div style="padding:18px 20px;border-radius:16px;background:#0f172a;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc;">How agencies use it</div>
          <ol style="margin:12px 0 0 18px;padding:0;font-size:15px;line-height:1.85;color:#e2e8f0;">
            <li>Start with the still image set already prepared for the listing.</li>
            <li>Generate a short branded walkthrough with agent CTA and property highlights.</li>
            <li>Share a single motion asset anywhere the listing needs more attention.</li>
          </ol>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Sample walkthrough links', 'Use either a YouTube link or a direct Ads Optimiser hosted video link. Replace the sample URLs in this template before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:18px 20px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Easy next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.7;color:#374151;">Reply with one current listing and we can mock up the style of walkthrough your agency could use from the existing photo pack.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps agencies convert existing listing photography into ready-to-share video creative.'
  );
}

function renderPrestigeMagazineTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px;background:linear-gradient(135deg,#0f172a 0%,#111827 55%,#1d4ed8 100%);">
        ${renderBrandLockup('Prestige magazine-inspired presentation', true)}
        <div style="margin-top:26px;padding:26px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(255,255,255,.05);">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd;">Premium listing presentation</div>
          <h1 style="margin:12px 0 14px;font-size:34px;line-height:1.08;color:#ffffff;">Make prestige listings feel cinematic before the first inspection.</h1>
          <p style="margin:0;font-size:16px;line-height:1.7;color:#dbeafe;">Hi {{name}}, luxury property marketing often needs more presence than static images can deliver. Ads Optimiser turns the polished stills your agency already owns into a refined video walkthrough fit for premium campaigns and vendor-facing presentations.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:26px 28px 10px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding:0 10px 14px 0;vertical-align:top;">
              <div style="padding:18px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">Use case</div>
                <div style="margin-top:10px;font-size:15px;line-height:1.65;color:#111827;">Prestige listing launches, premium suburb campaigns, agent profile marketing, and private buyer outreach.</div>
              </div>
            </td>
            <td style="padding:0 0 14px 10px;vertical-align:top;">
              <div style="padding:18px;background:#fff7f8;border-radius:16px;border:1px solid #ffe4ea;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fe2c55;">Output</div>
                <div style="margin-top:10px;font-size:15px;line-height:1.65;color:#111827;">Elegant pacing, branded end frames, polished text overlays and a stronger luxury feel from the same source photography.</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:22px;border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Why agencies like it</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#1f2937;">It gives premium listings a stronger visual story without waiting on a separate video crew, and it lets your team move fast when a vendor wants standout presentation material now.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Featured walkthrough examples', 'Drop in a prestige sample from YouTube or link directly to an Ads Optimiser-hosted video before sending this message.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border-radius:18px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">Next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#e5eefb;">If you have a prestige property coming to market, reply with the still image set and we can show you how that listing could look as a polished walkthrough.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps prestige agencies present premium listings with more motion, polish and speed.'
  );
}

function renderMarketInsightTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px 28px 18px;background:#ffffff;">
        ${renderBrandLockup('Market-insight newsletter style', false)}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 22px;">
        <div style="padding:22px 24px;border-radius:18px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#dbeafe;">Market insight</div>
          <h1 style="margin:10px 0 12px;font-size:32px;line-height:1.1;color:#ffffff;">In a million-dollar market, static image galleries are not enough.</h1>
          <p style="margin:0;font-size:16px;line-height:1.7;color:#eff6ff;">Hi {{name}}, when buyers scroll faster and vendors expect more polish, a short walkthrough video can help a listing feel more substantial than a set of stills alone. Ads Optimiser lets agencies build that motion layer from the images they already have.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:33.33%;padding:0 10px 12px 0;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Source</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Existing listing photos and floorplans</div>
              </div>
            </td>
            <td style="width:33.33%;padding:0 10px 12px 10px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Output</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Short branded walkthrough video</div>
              </div>
            </td>
            <td style="width:33.33%;padding:0 0 12px 10px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Channels</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Social, email, appraisal and vendor updates</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:18px 20px;border-left:4px solid #fe2c55;background:#fff7f8;border-radius:0 14px 14px 0;">
          <p style="margin:0;font-size:16px;line-height:1.75;color:#374151;">Instead of asking your team to source a separate video shoot for every listing, you can start with what is already in the campaign pack and turn it into a stronger piece of motion creative.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Example market-facing video links', 'Replace these sample URLs with one YouTube example or one hosted Ads Optimiser video before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Quick idea</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#374151;">Send through one active listing and we can map how your image set could become a walkthrough asset for buyers, vendors and social promotion.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser gives agencies a faster way to add motion creative to listing campaigns without starting from scratch.'
  );
}

function renderAgentUpdateTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:26px 28px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
        ${renderBrandLockup('Clean agent-update style outreach', false)}
      </td>
    </tr>
    <tr>
      <td style="padding:28px 28px 12px;">
        <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#374151;">Hi {{name}},</p>
        <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;color:#111827;">A simple way to turn listing stills into walkthrough video.</h1>
        <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#374151;">If your agency already has polished photography for a property, Ads Optimiser can turn those still images into a short branded walkthrough your team can use across campaign touchpoints.</p>
        <p style="margin:0;font-size:16px;line-height:1.7;color:#374151;">It is a practical way to make listings feel more dynamic without adding the time and coordination of a separate video production job for every property.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 28px;">
        <div style="padding:18px 20px;border-radius:16px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">What the agency gets</div>
          <ul style="margin:12px 0 0 18px;padding:0;font-size:15px;line-height:1.8;color:#e5eefb;">
            <li>A short branded property walkthrough built from your listing images</li>
            <li>Creative you can reuse across social, email and vendor comms</li>
            <li>A stronger presentation layer for listings that need more attention</li>
          </ul>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 12px;">
          <tr>
            <td style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:14px;background:#ffffff;">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Good fit for</div>
              <div style="margin-top:8px;font-size:15px;line-height:1.65;color:#111827;">New listings, social launch assets, vendor updates, buyer nurture sequences and agent prospecting material.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Sample video links', 'Replace these example links with a YouTube walkthrough or a hosted Ads Optimiser video before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#1f2937;">If you want, reply with one live listing and we can show you the type of walkthrough video your agency could generate from the current image set.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps agencies create more movement and attention around listings using assets they already own.'
  );
}

function renderLuxuryHomesEditorialTemplate(origin = '') {
  const heroImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/hero-image.webp');
  const frame01ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-01.webp');
  const frame02ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-02.webp');
  const frame03ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-03.webp');
  const frame04ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-04.webp');
  const signatureLogoUrl = absoluteAssetUrl(origin, '/email-assets/social/ao-signature.png?v=4');
  const signatureMailIconUrl = absoluteAssetUrl(origin, '/email-assets/social/mail.png?v=4');
  const signatureWebIconUrl = absoluteAssetUrl(origin, '/email-assets/social/web.png?v=4');
  const heroVideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7lqd15_65664d7224303b4f68cd726721cf60b3.mp4';
  const frame01VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kmj0v_7731260bdfda87a874ecde241502f860.mp4';
  const frame02VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7lhh07_aedff491cab6e9f26f4eb67a54285e92.mp4';
  const frame03VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kollr_5f4a7d29f0198333200b81234c225d3c.mp4';
  const frame04VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kpljx_c467daf3a0d990cd08aa76558c206bcb.mp4';
  return renderTemplateShell(`
    <tr>
      <td align="center" style="padding:34px 36px 18px;background:#ffffff;">
        <a href="https://adsoptimiser.com.au/" style="display:inline-block;text-decoration:none;">
          <table role="presentation" cellspacing="0" cellpadding="0">
            <tr>
              <td style="width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);text-align:center;font-size:28px;font-weight:800;color:#ffffff;">AO</td>
              <td style="padding-left:14px;">
                <div style="font-size:22px;line-height:1.1;font-weight:700;color:#0f172a;">Ads Optimiser</div>
                <div style="margin-top:6px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;">Luxury homes magazine style</div>
              </td>
            </tr>
          </table>
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0 36px 18px;background:#ffffff;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#2563eb;">Luxury listing presentation</div>
        <h1 style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.08;font-weight:400;color:#1f2937;">Static luxury imagery can become a standing video walkthrough.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 28px;background:#ffffff;">
        <a href="${heroVideoUrl}" style="display:block;text-decoration:none;">
          <img src="${heroImageUrl}" alt="Luxury home hero frame" style="width:100%;border:0;display:block;border-radius:18px;max-width:592px;" width="592" />
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0 36px 26px;background:#ffffff;">
        <a href="https://adsoptimiser.com.au/" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Visit Ads Optimiser</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 42px 12px;background:#ffffff;">
        <p style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.32;font-weight:400;color:#595959;">Luxury homes need more than a static gallery when buyers are screening properties online.</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b5563;">Hi {{first_name}}, when {{company}} is marketing a prestige property, the photography is usually already excellent. Ads Optimiser turns that same image set into a polished walkthrough video so the listing feels more cinematic, more premium, and more memorable before the first inspection.</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b5563;">Instead of organising a separate video production for every campaign, your agency can reuse the approved stills, layer in motion, sequencing, and branded framing, and send buyers or vendors a stronger presentation asset within the normal campaign cycle.</p>
        <p style="margin:0;font-size:16px;line-height:1.85;color:#4b5563;">That means one elegant creative can support launch emails, agent prospecting, social promotion, premium suburb campaigns, and vendor reporting while keeping the visual standard expected of high-value homes. You can also see more at <a href="https://adsoptimiser.com.au/" style="color:#2563eb;text-decoration:none;font-weight:700;">adsoptimiser.com.au</a>.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 24px 10px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding:0 10px 18px 0;width:50%;vertical-align:top;">
              <a href="${frame01VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame01ImageUrl}" alt="Video frame 1" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Front elevation reveal</div>
            </td>
            <td style="padding:0 0 18px 10px;width:50%;vertical-align:top;">
              <a href="${frame02VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame02ImageUrl}" alt="Video frame 2" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Kitchen and living sweep</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 10px 0 0;width:50%;vertical-align:top;">
              <a href="${frame03VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame03ImageUrl}" alt="Video frame 3" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Primary suite sequence</div>
            </td>
            <td style="padding:0 0 0 10px;width:50%;vertical-align:top;">
              <a href="${frame04VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame04ImageUrl}" alt="Video frame 4" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Outdoor entertaining close</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 42px 0;background:#ffffff;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.85;color:#4b5563;">If you would like, reply with one current prestige listing and we can show you how that property could be presented as a polished walkthrough using the image set your team already has.</p>
        <p style="margin:0;font-size:16px;line-height:1.85;color:#4b5563;">Best regards,</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 30px 0;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb;">
          <tr>
            <td style="padding:24px 0 0;width:88px;vertical-align:top;">
              <img src="${signatureLogoUrl}" width="64" height="64" alt="Ads Optimiser" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none;">
            </td>
            <td style="padding:24px 0 0;vertical-align:top;">
              <p style="margin:0 0 4px;font-size:18px;line-height:1.4;font-weight:700;color:#111827;">Ads Optimiser Team</p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4b5563;">AI-Powered Ad Creatives Platform</p>
              <p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#4b5563;">
                <span style="display:inline-block;vertical-align:middle;margin-right:10px;">
                  <img src="${signatureMailIconUrl}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;">
                </span>
                <a href="mailto:admin@adsoptimiser.com.au" style="color:#2563eb;text-decoration:none;vertical-align:middle;">admin@adsoptimiser.com.au</a>
              </p>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#4b5563;">
                <span style="display:inline-block;vertical-align:middle;margin-right:10px;">
                  <img src="${signatureWebIconUrl}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;">
                </span>
                <a href="https://adsoptimiser.com.au/" style="color:#2563eb;text-decoration:none;vertical-align:middle;font-weight:700;">adsoptimiser.com.au</a>
              </p>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#111827;">Polished walkthrough campaigns from premium property photography.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`, 'Ads Optimiser helps luxury real estate agencies turn premium listing photography into polished video walkthrough campaigns.'
    , '#f3f4f6', renderLuxuryHomesFooter()
  );
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    let path = url.pathname;
    const m = req.method;

    // Legacy hostnames -> canonical host (301, path + query preserved)
    if (LEGACY_HOSTS.includes(url.hostname)) {
      url.protocol = 'https:'; url.hostname = PUBLIC_HOST; url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    // Staff-only business pages (worker/internal-pages.js): /internal/:name
    // and the old public /<name>.html paths. Never reaches env.ASSETS.
    if (m === 'GET' && !path.startsWith('/api/')) {
      const page = await handleInternalPage(env, url);
      if (page) return page;
    }
    if (m === 'OPTIONS') return addCors(new Response(null, { status: 204 }));

    // api.cintelis.ai: the token-authenticated API only. /v1/* maps onto the
    // /api/v1/* handlers below; nothing else exists on this host.
    if (url.hostname === API_HOST) {
      if (path === '/' || path === '/v1' || path === '/v1/') {
        return addCors(jres({ name: 'Cintelis API', version: 'v1', auth: 'Authorization: Bearer pat_…', endpoints: ['POST /v1/contacts', 'GET|POST|DELETE /v1/docs/pages'] }));
      }
      if (!path.startsWith('/v1/')) return addCors(jres({ error: 'Not found' }, 404));
      path = '/api' + path;
    }

    // Public (no session) auth endpoints
    if (path === '/api/auth/login' && m === 'POST') return addCors(await apiLogin(req, env));
    if (path === '/api/auth/totp/login' && m === 'POST') return addCors(await apiTotpLogin(req, env, false));
    if (path === '/api/auth/totp/login-backup' && m === 'POST') return addCors(await apiTotpLogin(req, env, true));
    if (path === '/api/auth/check' && m === 'GET') return addCors(await apiCheck(req, env));
    if (path === '/api/auth/logout' && m === 'POST') return addCors(await apiLogout(req, env));

    // User avatars — served without auth (internal team, not secret). Uses R2.
    {
      const avm = path.match(/^\/api\/users\/([^/]+)\/avatar$/);
      if (avm && m === 'GET') return addCors(await serveAvatar(env, avm[1]));
    }

    // LinkedIn OAuth callback — hit by LinkedIn's browser redirect (no Bearer).
    // CSRF is validated via the `state` param stored in KV by startConnect.
    if (path === '/api/linkedin/callback' && m === 'GET') {
      return addCors(await linkedinCallback(req, env, url));
    }

    // Attachment download/preview: accepts Bearer header OR ?token= query param
    // because <a href> and <img src> in new tabs can't send Authorization headers.
    {
      const am = path.match(/^\/api\/attachments\/([^/]+)\/(download|preview)$/);
      if (am && m === 'GET') {
        const headerToken = getToken(req);
        const queryToken = url.searchParams.get('token');
        const t = headerToken || queryToken;
        if (!t) return addCors(jres({ error: 'Unauthorized' }, 401));
        const sess = await getActiveSession(env, t);
        if (!sess || sess.session.is_2fa_pending) return addCors(jres({ error: 'Unauthorized' }, 401));
        if (sess.user.customer_id && !(await canAccessEntity(env, sess, 'attachment', am[1]))) {
          return addCors(jres({ error: 'Forbidden: outside your organisation' }, 403));
        }
        return addCors(await downloadAttachment(env, am[1], am[2] === 'preview'));
      }
    }

    // Xero OAuth callback — Xero's browser redirect (no Bearer); CSRF via KV state.
    if (path === '/api/xero/callback' && m === 'GET') {
      return addCors(await xeroCallback(req, env, url));
    }

    // Xero invoice PDF: Bearer or ?token=, like attachments, so the billing
    // preview <iframe> and "Open in new tab" links can load it. HEAD is the
    // preview pane's type probe.
    {
      const xm = path.match(/^\/api\/xero\/invoices\/([^/]+)\/(download|preview)$/);
      if (xm && (m === 'GET' || m === 'HEAD')) {
        const t = getToken(req) || url.searchParams.get('token');
        if (!t) return addCors(jres({ error: 'Unauthorized' }, 401));
        const sess = await getActiveSession(env, t);
        if (!sess || sess.session.is_2fa_pending) return addCors(jres({ error: 'Unauthorized' }, 401));
        return addCors(await xeroInvoicePdf(env, sess, xm[1], xm[2] === 'preview', m === 'HEAD'));
      }
    }

    // API v1 — token-authenticated programmatic surface (no session cookies).
    // Reached as https://api.cintelis.ai/v1/* or, for older integrations,
    // https://projects.cintelis.ai/api/v1/*.
    if (path.startsWith('/api/v1/')) {
      const apiCtx = await requireApiToken(req, env);
      if (apiCtx instanceof Response) return addCors(apiCtx);
      // CRM intake (scope crm:write; the token's tenant decides where the contact lands).
      if (path === '/api/v1/contacts') {
        if (m === 'POST') return addCors(await apiV1UpsertContact(req, env, apiCtx));
        return addCors(jres({ error: 'Method not allowed' }, 405));
      }
      if (apiCtx.user && apiCtx.user.customer_id) {
        // Tenant isolation for programmatic access: the target space must belong to the token's customer.
        const spaceKey = m === 'POST'
          ? String((await req.clone().json().catch(() => ({}))).space_key || '')
          : String(url.searchParams.get('space') || '');
        if (!spaceKey || !(await canAccessEntity(env, apiCtx, 'doc_space', spaceKey))) {
          return addCors(jres({ error: 'Forbidden: outside your organisation' }, 403));
        }
      }
      if (path === '/api/v1/docs/pages') {
        if (m === 'POST')   return addCors(await apiV1UpsertPage(req, env, apiCtx));
        if (m === 'GET')    return addCors(await apiV1GetPage(env, apiCtx, url));
        if (m === 'DELETE') return addCors(await apiV1DeletePage(env, apiCtx, url));
        return addCors(jres({ error: 'Method not allowed' }, 405));
      }
      return addCors(jres({ error: 'Not found' }, 404));
    }

    if (path.startsWith('/api/')) {
      const authCtx = await requireAuth(req, env);
      if (authCtx instanceof Response) return addCors(authCtx);
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(touchSession(env, authCtx.session.id));
      }
      return addCors(await route(req, env, url, path, authCtx));
    }
    // Static SPA assets. run_worker_first is on (wrangler.toml) so the legacy-host
    // redirect above applies to every path, not just /api/*.
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_, env) {
    await crm.runScheduler(env);
    // LinkedIn page automation: due posts, daily analytics, comment ingest.
    // Self-throttled and a quiet no-op when LinkedIn isn't connected.
    try { await runLinkedInScheduler(env); } catch (e) { console.error('runLinkedInScheduler', e?.message || e); }
    // Xero invoice sync, every XERO_SYNC_MINUTES; a no-op when Xero isn't connected.
    try { await runXeroScheduler(env); } catch (e) { console.error('runXeroScheduler', e?.message || e); }
  }
};

// ── Auth ─────────────────────────────────────────────────────
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getToken(req) {
  const h = req.headers.get('Authorization') || '';
  return h.replace('Bearer ', '').trim() || null;
}

// Returns { session, user } on success, or a 401 Response on failure.
async function requireAuth(req, env) {
  const token = getToken(req);
  if (!token) return jres({ error: 'Unauthorized' }, 401);
  const ctx = await getActiveSession(env, token);
  if (!ctx) return jres({ error: 'Unauthorized' }, 401);
  if (ctx.session.is_2fa_pending) return jres({ error: '2FA required' }, 401);
  return ctx;
}

// Idempotently create the bootstrap admin from ADMIN_USER/ADMIN_PASS env secrets.
// Runs on every login attempt — safe because of UNIQUE(email) and INSERT OR IGNORE.
async function bootstrapAdminIfNeeded(env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return;
  const adminEmail = String(env.ADMIN_USER).trim().toLowerCase();
  if (!adminEmail) return;
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(adminEmail).first();
  if (existing) return;
  const userId = generateUserId();
  const ts = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, role, active, preferences, created_at)
     VALUES (?, ?, ?, 'admin', 1, '{}', ?)`
  ).bind(userId, adminEmail, 'Admin (bootstrap)', ts).run();
  // Re-read in case of insert race; whichever id won, attach the credential.
  const row = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(adminEmail).first();
  if (!row) return;
  const { hash, salt, iterations, algorithm } = await hashPassword(env.ADMIN_PASS);
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       salt = excluded.salt,
       algorithm = excluded.algorithm,
       iterations = excluded.iterations,
       updated_at = excluded.updated_at`
  ).bind(row.id, hash, salt, algorithm, iterations, ts, ts).run();
}

// Returns true if email+password matches the env-secret break-glass credential.
function isBreakGlass(env, email, password) {
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return false;
  return String(email).trim().toLowerCase() === String(env.ADMIN_USER).trim().toLowerCase()
      && String(password) === String(env.ADMIN_PASS);
}

async function apiLogin(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return jres({ error: 'email and password required' }, 400);

  // Bootstrap the env-secret admin into the users table on first login.
  await bootstrapAdminIfNeeded(env);

  const breakGlass = isBreakGlass(env, email, password);
  const user = await env.DB.prepare(
    'SELECT id, email, role, active FROM users WHERE email=? AND active=1'
  ).bind(email).first();
  if (!user) return jres({ error: 'Invalid credentials' }, 401);

  let valid = breakGlass;
  if (!valid) {
    const cred = await env.DB.prepare(
      'SELECT password_hash, salt, iterations FROM user_credentials WHERE user_id=?'
    ).bind(user.id).first();
    if (cred) {
      valid = await verifyPassword(password, cred.password_hash, cred.salt, cred.iterations);
    }
  }
  if (!valid) return jres({ error: 'Invalid credentials' }, 401);

  // Break-glass intentionally bypasses MFA — that's the whole point of break-glass.
  // Mitigation: rotate ADMIN_PASS to a long random string post-bootstrap.
  const totpRow = !breakGlass
    ? await env.DB.prepare('SELECT enabled FROM user_totp WHERE user_id=?').bind(user.id).first()
    : null;
  const mfaEnabled = totpRow && Number(totpRow.enabled) === 1;

  if (mfaEnabled) {
    const session = await createSession(env, user.id, { is2faPending: true });
    return jres({ requires_totp: true, session_id: session.id });
  }
  const session = await createSession(env, user.id, {});
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), user.id).run();
  return jres({ token: session.id });
}

// Handles both /api/auth/totp/login (TOTP code) and /api/auth/totp/login-backup (backup code).
async function apiTotpLogin(req, env, useBackupCode) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.session_id || '').trim();
  const code = String(body.code || '').trim();
  if (!sessionId || !code) return jres({ error: 'session_id and code required' }, 400);

  const ctx = await getActiveSession(env, sessionId);
  if (!ctx || !ctx.session.is_2fa_pending) return jres({ error: 'Invalid or expired session' }, 401);

  let valid = false;
  if (useBackupCode) {
    const matchedId = await findMatchingBackupCode(env, ctx.user.id, code);
    if (matchedId) {
      await env.DB.prepare('UPDATE user_backup_codes SET used_at=? WHERE id=?').bind(now(), matchedId).run();
      valid = true;
    }
  } else {
    const totp = await env.DB.prepare(
      'SELECT secret FROM user_totp WHERE user_id=? AND enabled=1'
    ).bind(ctx.user.id).first();
    if (totp) valid = await verifyTotp(totp.secret, code);
  }
  if (!valid) return jres({ error: 'Invalid code' }, 401);

  const promoted = await promotePendingTwoFactor(env, sessionId);
  if (!promoted) return jres({ error: 'Session promotion failed' }, 500);
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), ctx.user.id).run();
  return jres({ token: sessionId });
}

async function apiLogout(req, env) {
  const t = getToken(req);
  if (t) await revokeSession(env, t);
  return jres({ ok: true });
}

// Public — no 401 on missing session, just returns {ok:false}.
async function apiCheck(req, env) {
  const t = getToken(req);
  if (!t) return jres({ ok: false });
  const ctx = await getActiveSession(env, t);
  if (!ctx || ctx.session.is_2fa_pending) return jres({ ok: false });
  return jres({ ok: true, user: publicUser(ctx.user) });
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name || '',
    role: u.role || 'member',
    preferences: u.preferences || {},
    avatar_url: u.avatar_url ? `/api/users/${u.id}/avatar` : null,
    customer_id: u.customer_id || null,
    is_internal: !u.customer_id,
  };
}

// ── Sprint 6: /api/me helpers (saved filters + my open issues) ──
async function getMySavedFilters(env, authCtx) {
  const prefs = authCtx.user.preferences || {};
  const saved = prefs.saved_filters || {};
  return jres({ saved_filters: saved });
}

async function setMySavedFilters(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  // Body shape: {section: 'tasks'|'docs', filters: [...]} OR {saved_filters: {...}}
  const next = { ...(authCtx.user.preferences || {}) };
  next.saved_filters = next.saved_filters || {};
  if (body && body.section && Array.isArray(body.filters)) {
    next.saved_filters[body.section] = body.filters;
  } else if (body && typeof body.saved_filters === 'object') {
    next.saved_filters = body.saved_filters;
  } else {
    return jres({ error: 'Provide either {section, filters} or {saved_filters: {...}}' }, 400);
  }
  await env.DB.prepare('UPDATE users SET preferences=? WHERE id=?')
    .bind(JSON.stringify(next), authCtx.user.id).run();
  return jres({ ok: true, saved_filters: next.saved_filters });
}

async function getMyIssues(env, authCtx) {
  // Return up to 10 of the current user's open issues across all projects.
  // Order: priority desc (highest first), due_at asc (soonest first), updated_at desc.
  const PRIORITY_RANK = `CASE i.priority
    WHEN 'highest' THEN 5
    WHEN 'high'    THEN 4
    WHEN 'medium'  THEN 3
    WHEN 'low'     THEN 2
    WHEN 'lowest'  THEN 1
    ELSE 0 END`;
  const results = await scopedAll(env, authCtx, {
    sql: `SELECT i.id, i.issue_key, i.title, i.status, i.priority, i.type, i.due_at, i.updated_at, i.project_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.active = 1 AND /*SCOPE*/
       AND i.assignee_id = ?
       AND i.status NOT IN ('done')
     ORDER BY ${PRIORITY_RANK} DESC,
              CASE WHEN i.due_at IS NULL THEN 1 ELSE 0 END,
              i.due_at ASC,
              i.updated_at DESC
     LIMIT 10`,
    binds: [authCtx.user.id], alias: 'p',
  });
  return jres({ issues: results || [] });
}

// ── Sprint 7+: Overview dashboard widget endpoints ────────────
async function getActiveSprints(env, ctx, url) {
  const results = await scopedAll(env, ctx, {
    sql: `SELECT s.id, s.name, s.state, s.start_at, s.planned_end_at,
            p.id AS project_id, p.key AS project_key, p.name AS project_name,
            (SELECT COUNT(*) FROM issues WHERE sprint_id=s.id AND active=1) AS issue_count,
            (SELECT COUNT(*) FROM issues WHERE sprint_id=s.id AND active=1 AND status='done') AS done_count
     FROM sprints s JOIN projects p ON p.id = s.project_id AND p.active = 1 WHERE s.state = 'active' AND /*SCOPE*/
     ORDER BY s.start_at ASC`,
    alias: 'p', url,
  });
  const sprints = (results || []).map(s => {
    let days_remaining = null;
    if (s.planned_end_at) {
      const diff = (new Date(s.planned_end_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      days_remaining = Math.max(0, Math.ceil(diff));
    }
    return { ...s, days_remaining };
  });
  return jres({ sprints });
}

async function getDueSoon(env, ctx, url) {
  const results = await scopedAll(env, ctx, {
    sql: `SELECT i.id, i.issue_key, i.title, i.status, i.priority, i.due_at, i.assignee_id,
            u.display_name AS assignee_name, p.key AS project_key
     FROM issues i
     LEFT JOIN users u ON u.id = i.assignee_id
     JOIN projects p ON p.id = i.project_id AND p.active = 1 WHERE i.active = 1 AND /*SCOPE*/ AND i.status <> 'done' AND i.due_at IS NOT NULL
       AND date(i.due_at) <= date('now', '+7 days')
     ORDER BY i.due_at ASC
     LIMIT 15`,
    alias: 'p', url,
  });
  return jres({ issues: results || [] });
}

async function getRecentProjectActivity(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.entity_type, a.entity_id, a.kind, a.body_md, a.created_at,
            u.display_name AS user_name, u.email AS user_email
     FROM activity a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT 12`
  ).all();
  return jres({ activity: results || [] });
}

async function getTeamWorkload(env) {
  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.email,
            COUNT(i.id) AS open_count
     FROM users u
     LEFT JOIN issues i ON i.assignee_id = u.id AND i.active = 1 AND i.status <> 'done'
     WHERE u.active = 1
     GROUP BY u.id
     ORDER BY open_count DESC`
  ).all();
  const unassigned = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM issues WHERE active=1 AND status<>'done' AND assignee_id IS NULL`
  ).first();
  return jres({ users: users || [], unassigned: Number(unassigned?.n || 0) });
}

// ── Global search ────────────────────────────────────────────
async function globalSearch(req, env, ctx) {
  const url = new URL(req.url);
  const q = String(url.searchParams.get('q') || '').trim();
  if (q.length < 2) return jres({ results: [] });
  const like = `%${q}%`;
  // Tenant scoping via worker/scope.js: a customer user searches only their own
  // projects, pages and (since 019) contacts; staff search everything.
  const [issues, pages, contacts, projects, companies, deals] = await Promise.all([
    scopedAll(env, ctx, { sql: `SELECT i.id, i.issue_key, i.title, i.status, i.priority, p.key AS project_key FROM issues i JOIN projects p ON p.id = i.project_id AND p.active = 1 WHERE i.active = 1 AND /*SCOPE*/ AND (i.title LIKE ? OR i.issue_key LIKE ? OR i.description_md LIKE ?) ORDER BY i.updated_at DESC LIMIT 8`, binds: [like, like, like], alias: 'p' }),
    scopedAll(env, ctx, { sql: `SELECT dp.id, dp.title, dp.slug, ds.key AS space_key, ds.name AS space_name FROM doc_pages dp JOIN doc_spaces ds ON ds.id = dp.space_id AND ds.active = 1 WHERE dp.active = 1 AND /*SCOPE*/ AND (dp.title LIKE ? OR dp.content_md LIKE ?) ORDER BY dp.updated_at DESC LIMIT 8`, binds: [like, like], alias: 'ds' }),
    scopedAll(env, ctx, { sql: `SELECT c.id, c.name, c.email, c.company, c.stage FROM contacts c WHERE c.unsubscribed = 0 AND /*SCOPE*/ AND (c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ?) ORDER BY c.created_at DESC LIMIT 8`, binds: [like, like, like], alias: 'c' }),
    scopedAll(env, ctx, { sql: `SELECT p.id, p.key, p.name FROM projects p WHERE p.active = 1 AND /*SCOPE*/ AND (p.name LIKE ? OR p.key LIKE ?) ORDER BY p.name ASC LIMIT 5`, binds: [like, like], alias: 'p' }),
    scopedAll(env, ctx, { sql: `SELECT x.id, x.name, x.domain, x.industry FROM companies x WHERE /*SCOPE*/ AND (x.name LIKE ? OR x.domain LIKE ?) ORDER BY x.name ASC LIMIT 6`, binds: [like, like], alias: 'x' }),
    scopedAll(env, ctx, { sql: `SELECT d.id, d.name, d.stage, d.amount, c.name AS contact_name, x.name AS company_name FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id LEFT JOIN companies x ON x.id = d.company_id WHERE /*SCOPE*/ AND (d.name LIKE ? OR c.name LIKE ? OR x.name LIKE ?) ORDER BY d.updated_at DESC LIMIT 6`, binds: [like, like, like], alias: 'd' }),
  ]);
  return jres({
    results: {
      issues: issues.map(r => ({ ...r, type: 'issue' })),
      pages: pages.map(r => ({ ...r, type: 'doc_page' })),
      contacts: contacts.map(r => ({ ...r, type: 'contact' })),
      projects: projects.map(r => ({ ...r, type: 'project' })),
      companies: companies.map(r => ({ ...r, type: 'company' })),
      deals: deals.map(r => ({ ...r, type: 'deal' })),
    }
  });
}

// ── User avatars ─────────────────────────────────────────────
async function serveAvatar(env, userId) {
  const user = await env.DB.prepare('SELECT avatar_url FROM users WHERE id=?').bind(userId).first();
  if (!user || !user.avatar_url) {
    return new Response(null, { status: 404 });
  }
  // If avatar_url is an R2 key (starts with avatar/), serve from R2
  if (user.avatar_url.startsWith('avatar/')) {
    const obj = await env.ATTACHMENTS.get(user.avatar_url);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  // Otherwise it's an external URL — redirect
  return Response.redirect(user.avatar_url, 302);
}

async function uploadAvatar(req, env, authCtx) {
  let form;
  try { form = await req.formData(); } catch { return jres({ error: 'multipart form required' }, 400); }
  const file = form.get('file');
  if (!file || !file.size) return jres({ error: 'file required' }, 400);
  if (file.size > 5 * 1024 * 1024) return jres({ error: 'Avatar must be under 5 MB' }, 413);
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) return jres({ error: 'Only image files are allowed' }, 400);
  const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'jpg';
  const r2Key = `avatar/${authCtx.user.id}.${ext}`;
  await env.ATTACHMENTS.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });
  await env.DB.prepare('UPDATE users SET avatar_url=? WHERE id=?').bind(r2Key, authCtx.user.id).run();
  const avatarUrl = `/api/users/${authCtx.user.id}/avatar`;
  return jres({ ok: true, avatar_url: avatarUrl });
}

// ── Authenticated me/users/MFA endpoints ─────────────────────
async function apiGetMe(env, authCtx) {
  const totp = await env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  const backupRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM user_backup_codes WHERE user_id=? AND used_at IS NULL'
  ).bind(authCtx.user.id).first();
  const customer = authCtx.user.customer_id ? await getCustomer(env, authCtx.user.customer_id) : null;
  return jres({
    user: {
      ...publicUser(authCtx.user),
      customer: customer ? { id: customer.id, name: customer.name, slug: customer.slug, status: customer.status, features: customer.features } : null,
    },
    mfa_enabled: !!(totp && Number(totp.enabled) === 1),
    backup_codes_remaining: Number(backupRow?.n ?? 0),
  });
}

async function apiPatchMyPreferences(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const next = { ...(authCtx.user.preferences || {}) };
  if ('theme' in body) {
    const theme = String(body.theme || '').toLowerCase();
    if (theme !== 'light' && theme !== 'dark') return jres({ error: 'theme must be light or dark' }, 400);
    next.theme = theme;
  }
  // Saved CRM views (sprint 12): [{ id, name, filters, sort }], per user.
  if ('crm_views' in body) {
    if (!Array.isArray(body.crm_views)) return jres({ error: 'crm_views must be an array' }, 400);
    if (body.crm_views.length > 30) return jres({ error: 'at most 30 saved views' }, 400);
    next.crm_views = body.crm_views.map(v => ({
      id: String(v.id || '').slice(0, 40),
      name: String(v.name || '').trim().slice(0, 60),
      filters: (v.filters && typeof v.filters === 'object') ? v.filters : {},
      sort: (v.sort && typeof v.sort === 'object') ? { key: String(v.sort.key || '').slice(0, 40), dir: v.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
    })).filter(v => v.id && v.name);
  }
  await env.DB.prepare('UPDATE users SET preferences=? WHERE id=?')
    .bind(JSON.stringify(next), authCtx.user.id).run();
  return jres({ ok: true, preferences: next });
}

async function apiChangePassword(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (!next || next.length < 8) return jres({ error: 'New password must be at least 8 characters' }, 400);
  const cred = await env.DB.prepare(
    'SELECT password_hash, salt, iterations FROM user_credentials WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!cred) return jres({ error: 'No credential on file' }, 400);
  const ok = await verifyPassword(current, cred.password_hash, cred.salt, cred.iterations);
  if (!ok) return jres({ error: 'Current password is incorrect' }, 401);
  const hashed = await hashPassword(next);
  const ts = now();
  await env.DB.prepare(
    `UPDATE user_credentials SET password_hash=?, salt=?, algorithm=?, iterations=?, updated_at=? WHERE user_id=?`
  ).bind(hashed.hash, hashed.salt, hashed.algorithm, hashed.iterations, ts, authCtx.user.id).run();
  notifyPasswordChanged(env, authCtx.user.email, authCtx.user.display_name, 'self').catch(() => {});
  return jres({ ok: true });
}

async function apiTotpSetup(req, env, authCtx) {
  const { secret, otpauthUri } = generateTotpSecret(authCtx.user.email);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO user_totp (user_id, secret, enabled, verified_at, created_at)
     VALUES (?, ?, 0, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret, enabled=0, verified_at=NULL`
  ).bind(authCtx.user.id, secret, ts).run();
  return jres({ secret, otpauth_uri: otpauthUri });
}

async function apiTotpVerify(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  const row = await env.DB.prepare(
    'SELECT secret FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!row) return jres({ error: 'TOTP not initialised — call /setup first' }, 400);
  const ok = await verifyTotp(row.secret, code);
  if (!ok) return jres({ error: 'Invalid code' }, 401);
  await env.DB.prepare(
    'UPDATE user_totp SET enabled=1, verified_at=? WHERE user_id=?'
  ).bind(now(), authCtx.user.id).run();
  // Issue initial backup codes on first MFA enable.
  const codes = await issueBackupCodes(env, authCtx.user.id);
  return jres({ ok: true, backup_codes: codes });
}

async function apiTotpDisable(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  const row = await env.DB.prepare(
    'SELECT secret, enabled FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!row || Number(row.enabled) !== 1) return jres({ error: 'MFA not enabled' }, 400);
  const ok = await verifyTotp(row.secret, code);
  if (!ok) return jres({ error: 'Invalid code' }, 401);
  await env.DB.prepare('DELETE FROM user_totp WHERE user_id=?').bind(authCtx.user.id).run();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(authCtx.user.id).run();
  return jres({ ok: true });
}

async function apiRegenerateBackupCodes(env, authCtx) {
  const codes = await issueBackupCodes(env, authCtx.user.id);
  return jres({ ok: true, backup_codes: codes });
}

// Generates fresh backup codes, deletes any prior set, returns plain values.
async function issueBackupCodes(env, userId) {
  const generated = await generateBackupCodes();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(userId).run();
  const ts = now();
  for (const c of generated) {
    await env.DB.prepare(
      `INSERT INTO user_backup_codes (id, user_id, code_hash, salt, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(uid(), userId, c.hash, c.salt, ts).run();
  }
  return generated.map(c => c.plain);
}

// ── User administration (admin role only) ───────────────────
async function apiListUsers(env, ctx, url) {
  // Tenant scoping: customer users only see their own organisation's users;
  // internal users see everyone (optionally ?customer_id= to filter).
  const scope = ctx && ctx.user && ctx.user.customer_id
    ? ctx.user.customer_id
    : (url && url.searchParams.get('customer_id')) || null;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.active, u.created_at, u.last_login_at,
            u.customer_id, c.name AS customer_name,
            CASE WHEN t.enabled=1 THEN 1 ELSE 0 END AS mfa_enabled
     FROM users u
     LEFT JOIN user_totp t ON t.user_id = u.id
     LEFT JOIN customers c ON c.id = u.customer_id
     ${scope ? 'WHERE u.customer_id = ?' : ''}
     ORDER BY u.created_at ASC`
  ).bind(...(scope ? [scope] : [])).all();
  return jres({ users: results || [] });
}

async function apiCreateUser(req, env, ctx) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const display_name = String(body.display_name || '').trim();
  const role = ['admin', 'member', 'viewer'].includes(body.role) ? body.role : 'member';
  const password = String(body.password || '');
  // Customer-scoped users: customer admins create within their own organisation;
  // internal admins may pass customer_id. Password is optional (auto-generated) and
  // a Cintelis-branded welcome email carries the temporary password.
  const scoped = await customerIdForCreate(env, ctx, body.customer_id);
  if (scoped.error) return scoped.error;
  if (scoped.customer_id) {
    const made = await createCustomerUser(env, { email, display_name, role, password: password || undefined, customer_id: scoped.customer_id });
    if (made.error) return made.error;
    const cust = await getCustomer(env, scoped.customer_id);
    notifyCustomerWelcome(env, { to: made.user.email, name: made.user.display_name, customerName: cust ? cust.name : 'Cintelis', password: made.password }).catch(() => {});
    return jres({ ...made.user, welcome_email_sent: true });
  }
  if (!email) return jres({ error: 'email required' }, 400);
  if (!password || password.length < 8) return jres({ error: 'password must be at least 8 characters' }, 400);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (exists) return jres({ error: 'A user with that email already exists' }, 409);
  const id = generateUserId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, role, active, preferences, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', ?)`
  ).bind(id, email, display_name, role, ts).run();
  const { hash, salt, iterations, algorithm } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, hash, salt, algorithm, iterations, ts, ts).run();
  // Send welcome email with temporary password (fire-and-forget).
  notifyAccountCreated(env, email, display_name, role, password).catch(() => {});
  return jres({ id, email, display_name, role });
}

async function apiUpdateUser(req, env, id) {
  const body = await req.json().catch(() => ({}));
  // Load current user state for change detection
  const current = await env.DB.prepare('SELECT email, display_name, role, active FROM users WHERE id=?').bind(id).first();
  const fields = [];
  const vals = [];
  if ('display_name' in body) { fields.push('display_name=?'); vals.push(String(body.display_name || '')); }
  if ('role' in body && ['admin', 'member', 'viewer'].includes(body.role)) {
    fields.push('role=?'); vals.push(body.role);
  }
  if ('active' in body) { fields.push('active=?'); vals.push(body.active ? 1 : 0); }
  if (!fields.length) return jres({ error: 'No fields to update' }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).bind(...vals).run();
  // Notify user of changes (fire-and-forget).
  if (current) {
    const email = current.email;
    const name = body.display_name || current.display_name || '';
    if ('role' in body && body.role !== current.role) {
      notifyRoleChanged(env, email, name, current.role, body.role).catch(() => {});
    }
    if ('active' in body && !body.active && Number(current.active) === 1) {
      notifyAccountDeactivated(env, email, name).catch(() => {});
    }
  }
  return jres({ ok: true });
}

async function apiAdminResetPassword(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password || password.length < 8) return jres({ error: 'password must be at least 8 characters' }, 400);
  const user = await env.DB.prepare('SELECT id, email, display_name FROM users WHERE id=?').bind(id).first();
  if (!user) return jres({ error: 'User not found' }, 404);
  const { hash, salt, iterations, algorithm } = await hashPassword(password);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash=excluded.password_hash, salt=excluded.salt,
       algorithm=excluded.algorithm, iterations=excluded.iterations, updated_at=excluded.updated_at`
  ).bind(id, hash, salt, algorithm, iterations, ts, ts).run();
  notifyPasswordChanged(env, user.email, user.display_name, 'admin').catch(() => {});
  return jres({ ok: true });
}

async function apiAdminResetMfa(env, id) {
  const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id=?').bind(id).first();
  await env.DB.prepare('DELETE FROM user_totp WHERE user_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(id).run();
  if (user) notifyMfaReset(env, user.email, user.display_name).catch(() => {});
  return jres({ ok: true });
}

async function apiDeleteUser(env, id) {
  const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id=?').bind(id).first();
  // Soft delete — preserve audit trail.
  await env.DB.prepare('UPDATE users SET active=0 WHERE id=?').bind(id).run();
  // Revoke all live sessions for the deactivated user.
  await env.DB.prepare(
    'UPDATE app_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL'
  ).bind(now(), id).run();
  if (user) notifyAccountDeactivated(env, user.email, user.display_name).catch(() => {});
  return jres({ ok: true });
}

// Sprint 6: feature-visibility URL prefix → feature key map.
// Admins always see everything; non-admins are blocked at the router on
// any path matching a disabled feature. Order matters slightly: longest
// prefix wins if there's overlap (none today, but be defensive).
const FEATURE_GATES = [
  { prefix: '/api/templates',    feature: 'outreach' },
  { prefix: '/api/contacts',     feature: 'outreach' },
  { prefix: '/api/lists',        feature: 'outreach' },
  { prefix: '/api/campaigns',    feature: 'outreach' },
  { prefix: '/api/logs',         feature: 'outreach' },
  { prefix: '/api/unsubscribes', feature: 'outreach' },
  { prefix: '/api/crm',          feature: 'crm' },
  { prefix: '/api/projects',     feature: 'tasks' },
  { prefix: '/api/issues',       feature: 'tasks' },
  { prefix: '/api/sprints',      feature: 'tasks' },
  { prefix: '/api/doc-spaces',   feature: 'docs' },
  { prefix: '/api/doc-pages',    feature: 'docs' },
];

// ── Router ───────────────────────────────────────────────────
async function route(req, env, url, path, authCtx) {
  const m = req.method;

  // Role gating: viewers are read-only across the entire API surface.
  // Admin/member roles fall through to the per-endpoint logic below.
  if (WRITE_METHODS.has(m) && authCtx.user.role === 'viewer') {
    return jres({ error: 'Forbidden: read-only role' }, 403);
  }

  // Tenant guard: customer users are confined to their organisation's data
  // (deny-by-default allowlist + per-entity ownership; worker/customers.js).
  const scopeDenied = await enforceCustomerScope(env, authCtx, path, m, url, req);
  if (scopeDenied) return scopeDenied;

  // Sprint 6: feature visibility gate. Admin bypasses; others get 403 on
  // any URL matching a feature their role can't see.
  if (authCtx.user.role !== 'admin' && !isCustomerUser(authCtx)) {
    for (const gate of FEATURE_GATES) {
      if (path.startsWith(gate.prefix)) {
        const allowed = await isFeatureAllowed(env, gate.feature, authCtx.user.role);
        if (!allowed) return jres({ error: `The ${gate.feature} feature is disabled for your role` }, 403);
        break;
      }
    }
  }

  // ── Customers (tenants) — Cintelis internal admins only ───────
  if (path === '/api/customers' && m === 'GET')  return listCustomers(env, authCtx);
  if (path === '/api/customers' && m === 'POST') return createCustomer(req, env, authCtx, notifyCustomerWelcome);
  {
    // Xero: link a customer to a Xero contact, and that customer's invoices.
    const xm = path.match(/^\/api\/customers\/([^/]+)\/(xero-contact|invoices)$/);
    if (xm) {
      if (xm[2] === 'invoices' && m === 'GET') return xeroCustomerInvoices(env, authCtx, xm[1]);
      if (xm[2] === 'xero-contact' && m === 'PUT')    return xeroLinkContact(req, env, authCtx, xm[1]);
      if (xm[2] === 'xero-contact' && m === 'DELETE') return xeroUnlinkContact(env, authCtx, xm[1]);
    }
  }
  {
    const sm = path.match(/^\/api\/customers\/([^/]+)\/sender$/);
    if (sm) {
      if (m === 'GET')    return getSenderIdentity(env, authCtx, sm[1]);
      if (m === 'PUT')    return putSenderIdentity(req, env, authCtx, sm[1]);
      if (m === 'DELETE') return deleteSenderIdentity(env, authCtx, sm[1]);
    }
    const cm = path.match(/^\/api\/customers\/([^/]+)(?:\/contracts(?:\/([^/]+))?)?$/);
    if (cm) {
      const custId = cm[1], ctrId = cm[2];
      if (!path.includes('/contracts')) {
        if (m === 'GET')   return getCustomerDetail(env, authCtx, custId);
        if (m === 'PATCH') return patchCustomer(req, env, authCtx, custId);
      } else if (!ctrId) {
        if (m === 'POST') return createContract(req, env, authCtx, custId);
      } else {
        if (m === 'PATCH')  return patchContract(req, env, authCtx, custId, ctrId);
        if (m === 'DELETE') return deleteContract(env, authCtx, custId, ctrId, deleteAttachmentsForEntity);
      }
    }
  }
  // Customer self-service: own organisation + contracts (Contract & Billing page)
  if (path === '/api/customer' && m === 'GET') return getMyCustomer(env, authCtx);
  if (path === '/api/customer/invoices' && m === 'GET') return xeroMyInvoices(env, authCtx);

  // Staff-only business pages: a single-use ticket to open /internal/:name.
  {
    const ip = path.match(/^\/api\/internal-pages\/([a-z-]+)\/ticket$/);
    if (ip && m === 'GET') return internalPageTicket(env, authCtx, ip[1]);
  }

  // ── Xero (Cintelis's organisation; internal admins, checked in worker/xero.js) ──
  if (path === '/api/xero/status' && m === 'GET') return xeroStatus(env, authCtx);
  if (path === '/api/xero/connect' && m === 'GET') return xeroStartConnect(env, authCtx);
  if (path === '/api/xero/disconnect' && m === 'POST') return xeroDisconnect(env, authCtx);
  if (path === '/api/xero/tenant' && m === 'PUT') return xeroSetTenant(req, env, authCtx);
  if (path === '/api/xero/contacts' && m === 'GET') return xeroSearchContacts(env, authCtx, url);
  if (path === '/api/xero/sync' && m === 'POST') return xeroSyncNow(env, authCtx);

  // ── Admin: API tokens (programmatic-access PATs) ─────────────
  if (path === '/api/admin/api-tokens') {
    if (m === 'POST') return adminMintApiToken(req, env, authCtx);
    if (m === 'GET')  return adminListApiTokens(env, authCtx);
  }
  {
    const tkM = path.match(/^\/api\/admin\/api-tokens\/([^/]+)$/);
    if (tkM && m === 'DELETE') return adminRevokeApiToken(env, authCtx, tkM[1]);
  }

  // ── LinkedIn Ad Library ──────────────────────────────────────
  // Connect/disconnect are admin-only (one shared connection for the team);
  // status + searches are available to any authenticated user.
  if (path === '/api/linkedin/status' && m === 'GET') return linkedinStatus(env);
  if (path === '/api/linkedin/connect' && m === 'GET') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return linkedinStartConnect(env, authCtx, url.searchParams.get('purpose') || 'adlib');
  }
  if (path === '/api/linkedin/disconnect' && m === 'POST') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return linkedinDisconnect(env, url.searchParams.get('purpose') || 'adlib');
  }
  if (path === '/api/linkedin/ads' && m === 'GET') return linkedinSearchAds(env, url);
  if (path === '/api/linkedin/brand-partnerships' && m === 'GET') return linkedinSearchBrandPartnerships(env, url);

  // ── LinkedIn Community Management (publish / analytics / comments) ──
  // Writes (publish, delete, reply) and on-demand refreshes are admin-only;
  // reads are available to any authenticated user.
  // LinkedIn Posts (CMAPI) management — available to any authenticated user
  // (requireAuth already ran before route()). Connect/disconnect above stay
  // admin-only since they manage the shared OAuth token for the whole team.
  if (path === '/api/linkedin/media' && m === 'POST') return linkedinUploadMedia(req, env, url);
  if (path === '/api/linkedin/posts' && m === 'GET') return linkedinListPosts(env);
  if (path === '/api/linkedin/posts' && m === 'POST') return linkedinCreatePost(req, env, authCtx);
  {
    const pubM = path.match(/^\/api\/linkedin\/posts\/([^/]+)\/publish$/);
    if (pubM && m === 'POST') return linkedinPublishPost(env, pubM[1]);
    const delM = path.match(/^\/api\/linkedin\/posts\/([^/]+)$/);
    if (delM && m === 'DELETE') return linkedinDeletePost(env, delM[1]);
  }
  if (path === '/api/linkedin/analytics' && m === 'GET') return linkedinGetAnalytics(env);
  if (path === '/api/linkedin/analytics/refresh' && m === 'POST') return linkedinRefreshAnalytics(env);
  if (path === '/api/linkedin/comments' && m === 'GET') return linkedinListComments(env);
  if (path === '/api/linkedin/comments/refresh' && m === 'POST') return linkedinRefreshComments(env);
  if (path === '/api/linkedin/comments/reply' && m === 'POST') return linkedinReplyComment(req, env);

  // ── Account / self-service auth endpoints ─────────────────
  if (path === '/api/me' && m === 'GET') return apiGetMe(env, authCtx);
  if (path === '/api/me/preferences' && m === 'PATCH') return apiPatchMyPreferences(req, env, authCtx);
  if (path === '/api/me/avatar' && m === 'POST') return uploadAvatar(req, env, authCtx);
  if (path === '/api/auth/password/change' && m === 'POST') return apiChangePassword(req, env, authCtx);
  if (path === '/api/auth/totp/setup' && m === 'POST') return apiTotpSetup(req, env, authCtx);
  if (path === '/api/auth/totp/verify' && m === 'POST') return apiTotpVerify(req, env, authCtx);
  if (path === '/api/auth/totp/disable' && m === 'POST') return apiTotpDisable(req, env, authCtx);
  if (path === '/api/auth/backup-codes/regenerate' && m === 'POST') return apiRegenerateBackupCodes(env, authCtx);

  // ── User administration ──────────────────────────────────
  // GET /api/users is available to all authenticated users (needed for assignee
  // dropdowns, @mention autocomplete, etc.). Write operations stay admin-only.
  if (path === '/api/users' && m === 'GET') {
    return apiListUsers(env, authCtx, url);
  }
  if (path === '/api/users' && m === 'POST') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return apiCreateUser(req, env, authCtx);
  }
  // Mention search — available to all authenticated users. Must come BEFORE
  // the /api/users/:id regex which would match "mention-search" as a userId.
  if (path === '/api/users/mention-search' && m === 'GET') return mentionSearch(req, env, authCtx);
  {
    const userMatch = path.match(/^\/api\/users\/([^/]+)(?:\/(reset-password|reset-mfa))?$/);
    if (userMatch) {
      if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
      const userId = userMatch[1];
      const action = userMatch[2];
      if (!action && m === 'PATCH') return apiUpdateUser(req, env, userId);
      if (!action && m === 'DELETE') return apiDeleteUser(env, userId);
      if (action === 'reset-password' && m === 'POST') return apiAdminResetPassword(req, env, userId);
      if (action === 'reset-mfa' && m === 'POST') return apiAdminResetMfa(env, userId);
    }
  }

  // ── Sprint 6: attachments + entity links + saved filters + app settings ──
  if (path === '/api/attachments' && m === 'GET')  return listAttachments(req, env);
  if (path === '/api/attachments' && m === 'POST') {
    const upRes = await uploadAttachment(req, env, authCtx);
    // Customer uploaded a (signed) contract document → tell Cintelis admins.
    if (upRes.status < 300 && isCustomerUser(authCtx)) {
      const att = await upRes.clone().json().catch(() => null);
      if (att && (att.entity_type === 'customer_contract' || att.entity_type === 'customer')) {
        await onContractDocumentUploaded(env, authCtx, att.entity_type, att.entity_id, att, notifyContractDocumentEmail);
      }
    }
    return upRes;
  }
  {
    const am = path.match(/^\/api\/attachments\/([^/]+)\/(download|preview)$/);
    if (am && m === 'GET') return downloadAttachment(env, am[1], am[2] === 'preview');
  }
  {
    const am = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (am && m === 'DELETE') return deleteAttachment(env, authCtx, am[1]);
  }

  if (path === '/api/entity-links' && m === 'GET')  return listLinks(req, env, authCtx);
  if (path === '/api/entity-links' && m === 'POST') return createLink(req, env, authCtx);
  {
    const lm = path.match(/^\/api\/entity-links\/([^/]+)$/);
    if (lm && m === 'DELETE') return deleteLink(env, authCtx, lm[1]);
  }
  if (path === '/api/entity-search' && m === 'GET') return entitySearch(req, env, authCtx);

  if (path === '/api/me/saved-filters' && m === 'GET') return getMySavedFilters(env, authCtx);
  if (path === '/api/me/saved-filters' && m === 'PUT') return setMySavedFilters(req, env, authCtx);
  if (path === '/api/me/my-issues' && m === 'GET') return getMyIssues(env, authCtx);

  // Global search
  if (path === '/api/search' && m === 'GET') return globalSearch(req, env, authCtx);

  // Overview dashboard widgets
  if (path === '/api/overview/active-sprints' && m === 'GET') return getActiveSprints(env, authCtx, url);
  if (path === '/api/overview/due-soon' && m === 'GET') return getDueSoon(env, authCtx, url);
  if (path === '/api/overview/recent-activity' && m === 'GET') return getRecentProjectActivity(env);
  if (path === '/api/overview/team-workload' && m === 'GET') return getTeamWorkload(env);

  if (path === '/api/app-settings/feature-visibility' && m === 'GET') {
    return getFeatureVisibility(env).then(v => jres(v));
  }
  if (path === '/api/app-settings/feature-visibility' && m === 'PATCH') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return patchFeatureVisibility(req, env, authCtx);
  }

  // ── Notifications (Sprint 5) ─────────────────────────────
  if (path === '/api/me/notifications' && m === 'GET') return listNotifications(req, env, authCtx);
  if (path === '/api/me/notifications/unread-count' && m === 'GET') return getUnreadCount(env, authCtx);
  if (path === '/api/me/notifications/read-all' && m === 'POST') return markAllRead(env, authCtx);
  {
    const nm = path.match(/^\/api\/me\/notifications\/([^/]+)\/read$/);
    if (nm && m === 'POST') return markRead(env, authCtx, nm[1]);
  }
  // Integrations: Discord webhooks were removed on 2026-09-16. Xero's routes are
  // under /api/xero (above); the Integrations page renders its card.

  // ── Docs (Sprint 4) ──────────────────────────────────────
  if (path === '/api/doc-spaces' && m === 'GET')  return listSpaces(env, authCtx, url);
  if (path === '/api/doc-spaces' && m === 'POST') return createSpace(req, env, authCtx);
  {
    const spm = path.match(/^\/api\/doc-spaces\/([^/]+)(?:\/(pages))?$/);
    if (spm) {
      const spId = spm[1];
      const sub = spm[2];
      if (!sub) {
        if (m === 'GET')    return getSpace(env, authCtx, spId);
        if (m === 'PATCH')  return patchSpace(req, env, authCtx, spId);
        if (m === 'DELETE') {
          if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
          return deleteSpace(env, authCtx, spId);
        }
      }
      if (sub === 'pages') {
        if (m === 'GET')  return listSpacePages(env, authCtx, spId);
        if (m === 'POST') return createPage(req, env, authCtx, spId);
      }
    }
  }
  // Slug-based page lookup: /api/doc-pages/by-slug/:spaceKey/:slug
  {
    const slugMatch = path.match(/^\/api\/doc-pages\/by-slug\/([^/]+)\/(.+)$/);
    if (slugMatch && m === 'GET') return getPageBySlug(env, authCtx, slugMatch[1], decodeURIComponent(slugMatch[2]));
  }
  // /api/doc-pages/:id/pdf — server-side PDF render via Browser Rendering
  {
    const pdfMatch = path.match(/^\/api\/doc-pages\/([^/]+)\/pdf$/);
    if (pdfMatch && m === 'POST') return generatePagePdf(env, authCtx, pdfMatch[1]);
  }
  {
    const dpm = path.match(/^\/api\/doc-pages\/([^/]+)(?:\/versions(?:\/([^/]+)(?:\/(restore))?)?)?$/);
    if (dpm) {
      const pgId = dpm[1];
      const verId = dpm[2];
      const restore = dpm[3];
      // /api/doc-pages/:id  (no /versions sub)
      if (!verId && !path.includes('/versions')) {
        if (m === 'GET')    return getPage(env, authCtx, pgId);
        if (m === 'PATCH')  return patchPage(req, env, authCtx, pgId);
        if (m === 'DELETE') return deletePage(env, pgId);
      }
      // /api/doc-pages/:id/versions
      if (path.endsWith('/versions') && m === 'GET') return listPageVersions(env, pgId);
      // /api/doc-pages/:id/versions/:versionId
      if (verId && !restore && m === 'GET') return getPageVersion(env, pgId, verId);
      // /api/doc-pages/:id/versions/:versionId/restore
      if (verId && restore === 'restore' && m === 'POST') return restorePageVersion(req, env, authCtx, pgId, verId);
    }
  }

  // ── Tasks (Sprint 2 + Sprint 3 sprints sub) ──────────────
  if (path === '/api/projects' && m === 'GET')  return tasksListProjects(env, authCtx, url);
  if (path === '/api/projects' && m === 'POST') return tasksCreateProject(req, env, authCtx);
  {
    const pm = path.match(/^\/api\/projects\/([^/]+)(?:\/(issues|sprints|custom-fields|roadmap))?$/);
    if (pm) {
      const projId = pm[1];
      const sub = pm[2];
      if (!sub) {
        if (m === 'GET')    return tasksGetProject(env, authCtx, projId);
        if (m === 'PATCH')  return tasksPatchProject(req, env, authCtx, projId);
        if (m === 'DELETE') {
          if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
          return tasksDeleteProject(env, authCtx, projId);
        }
      }
      if (sub === 'issues') {
        if (m === 'GET')  return tasksListIssues(req, env, projId);
        if (m === 'POST') return tasksCreateIssue(req, env, authCtx, projId);
      }
      if (sub === 'sprints') {
        if (m === 'GET')  return listProjectSprints(env, projId);
        if (m === 'POST') return createSprint(req, env, authCtx, projId);
      }
      if (sub === 'custom-fields') {
        if (m === 'GET')  return listFieldDefs(env, projId);
        if (m === 'POST') return createFieldDef(req, env, projId);
      }
      if (sub === 'roadmap' && m === 'GET') return listRoadmapIssues(req, env, projId);
    }
    // Custom field def PATCH/DELETE by field id
    const cfm = path.match(/^\/api\/custom-fields\/([^/]+)$/);
    if (cfm) {
      if (m === 'PATCH')  return patchFieldDef(req, env, cfm[1]);
      if (m === 'DELETE') return deleteFieldDef(env, cfm[1]);
    }
  }
  // ── Sprints (Sprint 3) ───────────────────────────────────
  {
    const sm = path.match(/^\/api\/sprints\/([^/]+)(?:\/(start|complete|burndown|issues(?:\/([^/]+))?))?$/);
    if (sm) {
      const sprId = sm[1];
      const action = sm[2];
      const issueIdInPath = sm[3];
      if (!action) {
        if (m === 'GET')    return getSprint(env, sprId);
        if (m === 'PATCH')  return patchSprint(req, env, sprId);
        if (m === 'DELETE') return deleteSprint(env, sprId);
      }
      if (action === 'start' && m === 'POST')    return startSprint(env, authCtx, sprId);
      if (action === 'complete' && m === 'POST') return completeSprint(req, env, authCtx, sprId);
      if (action === 'burndown' && m === 'GET')  return getBurndown(env, sprId);
      if (sm[2] && sm[2].startsWith('issues') && !issueIdInPath && m === 'POST') {
        return addIssuesToSprint(req, env, authCtx, sprId);
      }
      if (sm[2] && sm[2].startsWith('issues') && issueIdInPath && m === 'DELETE') {
        return removeIssueFromSprint(env, authCtx, sprId, issueIdInPath);
      }
    }
  }
  // Issue clone, dependencies, custom values — must match BEFORE the generic /api/issues/:id route
  {
    const cloneMatch = path.match(/^\/api\/issues\/([^/]+)\/clone$/);
    if (cloneMatch && m === 'POST') return cloneIssue(req, env, authCtx, cloneMatch[1]);
  }
  {
    const depMatch = path.match(/^\/api\/issues\/([^/]+)\/dependencies$/);
    if (depMatch && m === 'GET') return listDependencies(env, depMatch[1]);
    if (depMatch && m === 'POST') return addDependency(req, env, authCtx);
  }
  {
    const depDel = path.match(/^\/api\/dependencies\/([^/]+)$/);
    if (depDel && m === 'DELETE') return removeDependency(env, depDel[1]);
  }
  {
    const cvMatch = path.match(/^\/api\/issues\/([^/]+)\/custom-values$/);
    if (cvMatch && m === 'GET') return getCustomValues(env, cvMatch[1]);
    if (cvMatch && m === 'PUT') return setCustomValues(req, env, cvMatch[1]);
  }
  {
    const im = path.match(/^\/api\/issues\/([^/]+)(?:\/(comments))?$/);
    if (im) {
      const isId = im[1];
      const sub = im[2];
      if (!sub) {
        if (m === 'GET')    return tasksGetIssue(env, isId);
        if (m === 'PATCH')  return tasksPatchIssue(req, env, authCtx, isId);
        if (m === 'DELETE') return tasksDeleteIssue(env, isId);
      }
      if (sub === 'comments' && m === 'POST') return tasksAddIssueComment(req, env, authCtx, isId);
    }
  }
  {
    const am = path.match(/^\/api\/activity\/([^/]+)$/);
    if (am && m === 'DELETE') return tasksDeleteActivity(env, authCtx, am[1]);
    if (am && m === 'PATCH') return tasksPatchActivity(req, env, authCtx, am[1]);
  }

  // ── CRM / outreach (worker/crm.js) — every handler is scoped by authCtx ──
  const parts = path.replace('/api/', '').split('/');
  const [res, id, sub, sub2] = parts;
  if ((res === 'stats' || res === 'overview') && m === 'GET') return crm.getOverview(env, authCtx, url);
  if (res === 'templates') {
    if (m === 'POST' && id === 'seed' && sub === 'real-estate') return crm.seedTemplates(env, authCtx, getAdsOptimiserRealEstateTemplates());
    if (m === 'GET' && !id) return crm.listTemplates(env, authCtx, url);
    if (m === 'GET' && id) return crm.getTemplate(env, authCtx, url, id);
    if (m === 'POST' && !id) return crm.createTemplate(req, env, authCtx);
    if (m === 'PUT' && id) return crm.updateTemplate(req, env, authCtx, url, id);
    if (m === 'DELETE' && id) return crm.deleteTemplate(env, authCtx, url, id);
  }
  if (res === 'contacts') {
    if (m === 'GET' && !id) return crm.listContacts(env, authCtx, url);
    if (m === 'POST' && id === 'import') return crm.importContacts(req, env, authCtx);
    if (m === 'POST' && !id) return crm.createContact(req, env, authCtx);
    if (m === 'PUT' && id) return crm.updateContact(req, env, authCtx, url, id);
    if (m === 'DELETE' && id) return crm.deleteContact(env, authCtx, url, id);
  }
  if (res === 'lists') {
    if (m === 'GET' && !id) return crm.listLists(env, authCtx, url);
    if (m === 'POST' && !id) return crm.createList(req, env, authCtx);
    if (m === 'PUT' && id && !sub) return crm.updateList(req, env, authCtx, url, id);
    if (m === 'DELETE' && id && !sub) return crm.deleteList(env, authCtx, url, id);
    if (m === 'GET' && id && sub === 'contacts') return crm.getListContacts(env, authCtx, url, id);
    if (m === 'POST' && id && sub === 'contacts') return crm.addToList(req, env, authCtx, url, id);
    if (m === 'DELETE' && id && sub === 'contacts' && sub2) return crm.removeFromList(env, authCtx, url, id, sub2);
  }
  if (res === 'campaigns') {
    if (m === 'GET' && !id) return crm.listCampaigns(env, authCtx, url);
    if (m === 'POST' && !id) return crm.createCampaign(req, env, authCtx);
    if (m === 'PUT' && id && !sub) return crm.updateCampaign(req, env, authCtx, url, id);
    if (m === 'DELETE' && id && !sub) return crm.deleteCampaign(env, authCtx, url, id);
    if (m === 'POST' && id && sub === 'send') return crm.sendNow(env, authCtx, url, id);
    if (m === 'POST' && id && sub === 'activate') return crm.setCampaignStatus(env, authCtx, url, id, 'active');
    if (m === 'POST' && id && sub === 'pause') return crm.setCampaignStatus(env, authCtx, url, id, 'paused');
  }
  if (res === 'logs' && m === 'GET') return crm.getLogs(env, authCtx, url);
  if (res === 'unsubscribes' && m === 'GET') return crm.getUnsubscribes(env, authCtx, url);
  if (res === 'crm') {
    if (id === 'pipeline' && m === 'GET') return crm.getCrmPipeline(env, authCtx, url);
    if (id === 'stats' && m === 'GET') return crm.getCrmStats(env, authCtx, url);
    if (id === 'followups' && m === 'GET') return crm.getFollowUps(env, authCtx, url);
    if (id === 'workspace' && m === 'GET') return crmTasks.getWorkspace(env, authCtx, url);
    if (id === 'tasks' && !sub) {
      if (m === 'GET') return crmTasks.listTasks(env, authCtx, url);
      if (m === 'POST') return crmTasks.createTask(req, env, authCtx, url);
    }
    if (id === 'tasks' && sub && !sub2) {
      if (m === 'PATCH') return crmTasks.patchTask(req, env, authCtx, url, sub);
      if (m === 'DELETE') return crmTasks.deleteTask(env, authCtx, url, sub);
    }
    if (id === 'contact' && sub && !sub2) {
      if (m === 'GET') return crm.getContactDetail(env, authCtx, url, sub);
      if (m === 'PATCH') return crm.patchContact(req, env, authCtx, url, sub);
    }
    if (id === 'contact' && sub && sub2 === 'record' && m === 'GET') return crm.getContactRecord(env, authCtx, url, sub);
    if (id === 'contact' && sub && sub2 === 'email' && m === 'POST') return crm.sendContactEmail(req, env, authCtx, url, sub);
    if (id === 'deals' && !sub) {
      if (m === 'GET') return crmDeals.listDeals(env, authCtx, url);
      if (m === 'POST') return crmDeals.createDeal(req, env, authCtx, url);
    }
    if (id === 'deals' && sub === 'stats' && m === 'GET') return crmDeals.dealStats(env, authCtx, url);
    if (id === 'deals' && sub && !sub2) {
      if (m === 'GET') return crmDeals.getDeal(env, authCtx, url, sub);
      if (m === 'PATCH') return crmDeals.patchDeal(req, env, authCtx, url, sub);
      if (m === 'DELETE') return crmDeals.deleteDeal(env, authCtx, url, sub);
    }
    if (id === 'deals' && sub && sub2 === 'notes') {
      if (m === 'POST') return crmDeals.addDealNote(req, env, authCtx, url, sub);
      if (m === 'DELETE' && parts[4]) return crmDeals.deleteDealNote(env, authCtx, url, sub, parts[4]);
    }
    if (id === 'companies' && !sub) {
      if (m === 'GET') return crmCompanies.listCompanies(env, authCtx, url);
      if (m === 'POST') return crmCompanies.createCompany(req, env, authCtx, url);
    }
    if (id === 'companies' && sub && !sub2) {
      if (m === 'GET') return crmCompanies.getCompany(env, authCtx, url, sub);
      if (m === 'PATCH') return crmCompanies.patchCompany(req, env, authCtx, url, sub);
      if (m === 'DELETE') return crmCompanies.deleteCompany(env, authCtx, url, sub);
    }
    if (id === 'contact' && sub && sub2 === 'notes') {
      if (m === 'GET') return crm.getNotes(env, authCtx, url, sub);
      if (m === 'POST') return crm.addNote(req, env, authCtx, url, sub);
    }
    if (id === 'contact' && sub && sub2 && parts[4] === undefined && m === 'DELETE') {
      return crm.deleteNote(env, authCtx, url, sub, sub2);
    }
  }
  return jres({ error: 'Not found' }, 404);
}

// ── CRM / outreach: moved to worker/crm.js (sprint 9) ─────────

function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function jres(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function addCors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(res.body, { status: res.status, headers: h });
}

// ── Dashboard HTML (inline) ───────────────────────────────────
// Dashboard frontend moved to public/index.html, public/dashboard.css, and public/app.js.
