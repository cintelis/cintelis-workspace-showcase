// ============================================================
// Cintelis — Event bus
// emit() is the single hook for "something happened" fan-out. It is
// currently a no-op: the Discord dispatcher was removed on 2026-09-16.
// In-app notifications and activity rows are written directly by handlers;
// keep calling emit() from mutations so a future integration (e.g. Xero)
// can subscribe in one place.
//
// Usage from a route handler:
//   await emit(env, EVENT_TYPES.ISSUE_ASSIGNED, { issue, assignee }, ctx);
// ============================================================


// Known event types — keep this list as the canonical reference.
export const EVENT_TYPES = Object.freeze({
  // Sprint 2-3: Tasks
  ISSUE_CREATED:        'issue.created',
  ISSUE_UPDATED:        'issue.updated',
  ISSUE_ASSIGNED:       'issue.assigned',
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_COMMENTED:      'issue.commented',
  SPRINT_STARTED:       'sprint.started',
  SPRINT_COMPLETED:     'sprint.completed',

  // Sprint 4: Docs
  DOC_PAGE_CREATED:     'doc.page_created',
  DOC_PAGE_UPDATED:     'doc.page_updated',
  DOC_PAGE_COMMENTED:   'doc.page_commented',
  DOC_PAGE_DELETED:     'doc.page_deleted',

  // CRM (existing surfaces will adopt these gradually)
  CONTACT_STAGE_CHANGED: 'contact.stage_changed',
  CONTACT_FOLLOWUP_DUE:  'contact.followup_due',

  // LinkedIn (Community Management API)
  LINKEDIN_COMMENT_RECEIVED: 'linkedin.comment_received',

  // Customers
  CUSTOMER_CONTRACT_UPLOADED: 'customer.contract_uploaded',
});

/**
 * Emit an event. Currently a no-op hook (Discord dispatch was removed). Mention parsing is invoked DIRECTLY from handlers via
 * parseMentionsAndNotify() because not every event has a markdown body
 * — emit() doesn't handle that.
 *
 * @param {object} env       Cloudflare worker env bindings
 * @param {string} eventType One of EVENT_TYPES values
 * @param {object} payload   Arbitrary structured data describing what happened
 * @param {object} [ctx]     Worker execution context (for waitUntil); optional
 */
export async function emit(env, eventType, payload, ctx) {
  if (!eventType) return;
  // External fan-out (Discord) was removed on 2026-09-16. emit() stays as the
  // single hook point so a future integration (e.g. Xero) can subscribe here
  // without touching every handler again.
  void payload; void ctx;
}
