// ============================================================
// Cintelis Workspace — Hash-based router for shareable URLs
// Loaded after app.js. Writes #/path on every navigation,
// parses on load + hashchange to restore the view.
// ============================================================

(function () {
  let routerActive = false;
  let suppressNextHashChange = false;

  // ── URL scheme ────────────────────────────────────────────
  // #/overview, #/projects, #/project/:id, #/issue/:issueKey,
  // #/docs, #/space/:id, #/page/:id, #/account, #/users,
  // #/integrations, #/feature-settings, #/linkedin, #/board/:projectId,
  // #/backlog/:projectId, #/sprints/:projectId,
  // #/roadmap, #/billing (customer users), #/customers, #/customer/:id (internal admins)

  function setHash(hash) {
    suppressNextHashChange = true;
    window.location.hash = hash;
    setTimeout(() => { suppressNextHashChange = false; }, 50);
  }

  // ── Write hash on navigation ──────────────────────────────
  // Patch the global nav() to also update the URL hash.
  // Helpers to resolve keys from state for cleaner URLs
  function getProjectKey() {
    if (state.tasks && state.tasks.project && state.tasks.project.key) return state.tasks.project.key;
    // Fallback: check the projects list
    if (state.tasks && state.tasks.projects && state.ui.tasksProjectId) {
      const p = state.tasks.projects.find(x => x.id === state.ui.tasksProjectId);
      if (p && p.key) return p.key;
    }
    return state.ui.tasksProjectId || '';
  }
  function getSpaceKey() {
    if (state.docs && state.docs.space && state.docs.space.key) return state.docs.space.key;
    return state.ui.docsSpaceId || '';
  }

  // Build project hash with tab: #/project/ENG, #/project/ENG/board, etc.
  function projectHash() {
    const key = getProjectKey();
    const tab = state.ui.tasksTab || 'issues';
    if (tab === 'issues' || !tab) return '#/project/' + key;
    return '#/project/' + key + '/' + tab;
  }

  const originalNav = window.nav;
  window.nav = async function routedNav(section) {
    // Write hash based on the section + current state — use keys not IDs
    if (section === 'projects') {
      if (state.ui.tasksProjectId) {
        setHash(projectHash());
        // Rewrite hash after project loads (key might not be available yet)
        setTimeout(() => { if (state.ui.tasksProjectId) setHash(projectHash()); }, 500);
      } else {
        setHash('#/projects');
      }
    } else if (section === 'docs') {
      if (state.ui.docsPageId) {
        const _pg = state.docs && state.docs.page;
        const _sk = getSpaceKey();
        if (_pg && _pg.slug && _sk) {
          setHash('#/page/' + _sk + '/' + encodeURIComponent(_pg.slug));
        } else {
          setHash('#/page/' + state.ui.docsPageId);
        }
      } else if (state.ui.docsSpaceId) {
        setHash('#/space/' + getSpaceKey());
      } else {
        setHash('#/docs');
      }
    } else if (section === 'overview') {
      setHash('#/overview');
    } else if (section === 'customers') {
      // Internal-admin Customers page: #/customers (list) or #/customer/:id (detail)
      if (state.ui.customerId) setHash('#/customer/' + encodeURIComponent(state.ui.customerId));
      else setHash('#/customers');
    } else if (section === 'contact') {
      // CRM contact record page (sprint 11)
      if (state.ui.crmContactId) setHash('#/contact/' + encodeURIComponent(state.ui.crmContactId));
      else setHash('#/contacts');
    } else if (section === 'company') {
      if (state.ui.crmCompanyId) setHash('#/company/' + encodeURIComponent(state.ui.crmCompanyId));
      else setHash('#/companies');
    } else if (section === 'deal') {
      if (state.ui.crmDealId) setHash('#/deal/' + encodeURIComponent(state.ui.crmDealId));
      else setHash('#/pipeline');
    } else {
      setHash('#/' + section);
    }
    return originalNav(section);
  };

  // Patch openIssueDetail to write the issue key into the hash
  const originalOpenIssue = window.openIssueDetail;
  if (originalOpenIssue) {
    window.openIssueDetail = async function (id) {
      await originalOpenIssue(id);
      // After the issue loads, currentIssue has the issue_key
      if (typeof currentIssue !== 'undefined' && currentIssue && currentIssue.issue_key) {
        setHash('#/issue/' + currentIssue.issue_key);
      } else {
        setHash('#/issue/' + id);
      }
    };
  }

  // Patch closeIssueDetail to restore the project hash
  const originalCloseIssue = window.closeIssueDetail;
  if (originalCloseIssue) {
    window.closeIssueDetail = function () {
      originalCloseIssue();
      if (state.ui.tasksProjectId) {
        setTimeout(() => setHash(projectHash()), 100);
      } else {
        setHash('#/projects');
      }
    };
  }

  // Patch openDocsPage to write slug-based page hash
  const originalOpenPage = window.openDocsPage;
  if (originalOpenPage) {
    window.openDocsPage = function (pageId) {
      originalOpenPage(pageId);
      // After nav completes, write a friendly slug URL
      setTimeout(() => {
        const page = state.docs && state.docs.page;
        const spaceKey = getSpaceKey();
        if (page && page.slug && spaceKey) {
          setHash('#/page/' + spaceKey + '/' + encodeURIComponent(page.slug));
        } else {
          setHash('#/page/' + pageId);
        }
      }, 200);
    };
  }

  // Patch openProject (tasks-ui.js) to write the project hash
  const originalOpenProject = window.openProject;
  if (originalOpenProject) {
    window.openProject = function (id) {
      originalOpenProject(id);
      setTimeout(() => setHash(projectHash()), 200);
    };
  }

  // Patch setTasksTab to update the hash when switching tabs
  const originalSetTasksTab = window.setTasksTab;
  if (originalSetTasksTab) {
    window.setTasksTab = function (tab) {
      originalSetTasksTab(tab);
      setTimeout(() => setHash(projectHash()), 100);
    };
  }

  // Patch backToProjects to clear the project hash
  const originalBackToProjects = window.backToProjects;
  if (originalBackToProjects) {
    window.backToProjects = function () {
      originalBackToProjects();
      setHash('#/projects');
    };
  }

  // Patch openSpace (docs) to write the space hash using the key
  const originalOpenSpace = window.openSpace;
  if (originalOpenSpace) {
    window.openSpace = function (id) {
      originalOpenSpace(id);
      setTimeout(() => setHash('#/space/' + getSpaceKey()), 50);
    };
  }

  // Patch backToSpaces to clear the space hash
  const originalBackToSpaces = window.backToSpaces;
  if (originalBackToSpaces) {
    window.backToSpaces = function () {
      originalBackToSpaces();
      setHash('#/docs');
    };
  }

  // ── Parse hash on load ────────────────────────────────────
  // Routes a tenant (customer) user may not open — bounce to their landing
  // page. app.js's customerMayOpen() decides per feature (CRM, Outreach), so
  // the two lists cannot drift; 'customer' is the internal-admin detail route.
  function isTenantUser() { return typeof isCustomerUser === 'function' && isCustomerUser(); }
  function tenantBlocked(route) {
    if (!isTenantUser()) return false;
    if (route === 'customer') return true;
    return typeof customerMayOpen === 'function' ? !customerMayOpen(route) : true;
  }
  function landing() { return typeof defaultSection === 'function' ? defaultSection() : 'overview'; }

  async function restoreFromHash() {
    const hash = (window.location.hash || '').replace(/^#\/?/, '');
    if (!hash) { nav(landing()); return true; }

    const parts = hash.split('/');
    const route = parts[0];
    const param = parts[1] || '';

    if (tenantBlocked(route)) {
      nav(landing());
      return true;
    }
    if (route === 'overview') {
      nav(landing());
      return true;
    }
    if (route === 'customers') {
      state.ui.customerId = '';
      nav('customers');
      return true;
    }
    if (route === 'customer' && param) {
      state.ui.customerId = decodeURIComponent(param);
      nav('customers');
      return true;
    }
    if (route === 'contact' && param) {
      state.ui.crmContactId = decodeURIComponent(param);
      nav('contact');
      return true;
    }
    if (route === 'company' && param) {
      state.ui.crmCompanyId = decodeURIComponent(param);
      nav('company');
      return true;
    }
    if (route === 'deal' && param) {
      state.ui.crmDealId = decodeURIComponent(param);
      nav('deal');
      return true;
    }
    if (route === 'projects' && !param) {
      state.ui.tasksProjectId = '';
      nav('projects');
      return true;
    }
    if (route === 'project' && param) {
      // URL: #/project/ENG or #/project/ENG/board or #/project/ENG/backlog or #/project/ENG/sprints
      const tab = parts[2] || 'issues';
      let projectId = param;
      if (!param.startsWith('prj_')) {
        try {
          const pr = await api('GET', '/api/projects');
          const projects = (pr && Array.isArray(pr.projects)) ? pr.projects : [];
          const match = projects.find(p => p.key === param.toUpperCase());
          if (match) projectId = match.id;
        } catch {}
      }
      state.ui.tasksProjectId = projectId;
      state.ui.tasksTab = ['board', 'backlog', 'sprints', 'roadmap'].includes(tab) ? tab : 'issues';
      nav('projects');
      return true;
    }
    // Legacy routes: #/board/ENG, #/backlog/ENG, #/sprints/ENG → redirect to new format
    if ((route === 'board' || route === 'backlog' || route === 'sprints') && param) {
      let projectId = param;
      if (!param.startsWith('prj_')) {
        try {
          const pr = await api('GET', '/api/projects');
          const projects = (pr && Array.isArray(pr.projects)) ? pr.projects : [];
          const match = projects.find(p => p.key === param.toUpperCase());
          if (match) projectId = match.id;
        } catch {}
      }
      state.ui.tasksProjectId = projectId;
      state.ui.tasksTab = route;
      nav('projects');
      return true;
    }
    if (route === 'issue' && param) {
      // param is the issue_key (e.g. ENG-12) or issue ID
      // First navigate to projects, then open the issue
      nav('projects');
      // Look up by issue_key or ID
      setTimeout(async () => {
        try {
          // Try as issue_key first (search), then as direct ID
          const searchR = await api('GET', '/api/search?q=' + encodeURIComponent(param));
          let issueId = null;
          if (searchR && searchR.results && searchR.results.issues) {
            const match = searchR.results.issues.find(i => i.issue_key === param);
            if (match) issueId = match.id;
          }
          if (!issueId) {
            // Try as a direct ID
            issueId = param;
          }
          if (issueId && typeof openIssueDetail === 'function') {
            await openIssueDetail(issueId);
          }
        } catch {}
      }, 300);
      return true;
    }
    if (route === 'docs' && !param) {
      state.ui.docsSpaceId = '';
      state.ui.docsPageId = '';
      nav('docs');
      return true;
    }
    if (route === 'space' && param) {
      // Resolve param: could be a key (TW) or an ID (dsp_xxx)
      let spaceId = param;
      if (!param.startsWith('dsp_')) {
        try {
          const sr = await api('GET', '/api/doc-spaces');
          const spaces = (sr && Array.isArray(sr.spaces)) ? sr.spaces : [];
          const match = spaces.find(s => s.key === param.toUpperCase());
          if (match) spaceId = match.id;
        } catch {}
      }
      state.ui.docsSpaceId = spaceId;
      state.ui.docsPageId = '';
      nav('docs');
      return true;
    }
    if (route === 'page' && param) {
      // Two URL formats:
      // #/page/SPACE_KEY/slug  (new, friendly)
      // #/page/dpg_xxx         (legacy, ID-based)
      const slug = parts[2] || '';
      let pageR = null;
      try {
        if (slug) {
          // New format: space key + slug
          pageR = await api('GET', '/api/doc-pages/by-slug/' + encodeURIComponent(param) + '/' + encodeURIComponent(slug));
        } else if (param.startsWith('dpg_')) {
          // Legacy: direct page ID
          pageR = await api('GET', '/api/doc-pages/' + encodeURIComponent(param));
        } else {
          // Could be a slug without space key — try as ID fallback
          pageR = await api('GET', '/api/doc-pages/' + encodeURIComponent(param));
        }
        if (pageR && !pageR.error && pageR.page) {
          const spaceId = (pageR.space && pageR.space.id) || (pageR.page && pageR.page.space_id) || '';
          state.ui.docsSpaceId = spaceId;
          state.ui.docsPageId = pageR.page.id;
          state.docs = state.docs || {};
          state.docs.page = pageR.page;
          if (pageR.page._children === undefined) {
            state.docs.page._children = pageR.children || [];
            state.docs.page._parent = pageR.parent || null;
            state.docs.page._versionCount = pageR.version_count || 0;
          }
          nav('docs');
          return true;
        }
      } catch {}
    }
    // Generic section routes
    if (['account', 'users', 'integrations', 'feature_settings', 'api_tokens',
         'pipeline', 'followups', 'workspace', 'crm_tasks', 'companies', 'templates', 'contacts', 'lists', 'campaigns',
         'logs', 'unsubs', 'tools_build_margin', 'tools_quoting', 'linkedin', 'linkedin_posts',
         'roadmap', 'billing'].includes(route)) {
      nav(route);
      return true;
    }
    return false;
  }

  // ── Copy URL helpers ──────────────────────────────────────
  function copyCurrentUrl() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Link copied to clipboard');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo('URL: ' + url);
    });
  }
  window.copyCurrentUrl = copyCurrentUrl;

  function getIssueUrl(issueKey) {
    return window.location.origin + window.location.pathname + '#/issue/' + issueKey;
  }
  window.getIssueUrl = getIssueUrl;

  function getPageUrl(pageId) {
    // Try to build a slug-based URL from current state
    const page = state.docs && state.docs.page;
    const spaceKey = (state.docs && state.docs.space && state.docs.space.key) || '';
    if (page && page.id === pageId && page.slug && spaceKey) {
      return window.location.origin + window.location.pathname + '#/page/' + spaceKey + '/' + encodeURIComponent(page.slug);
    }
    // Check pages list for slug
    if (spaceKey && state.docs && state.docs.pages) {
      const found = state.docs.pages.find(p => p.id === pageId);
      if (found && found.slug) {
        return window.location.origin + window.location.pathname + '#/page/' + spaceKey + '/' + encodeURIComponent(found.slug);
      }
    }
    // Fallback to ID
    return window.location.origin + window.location.pathname + '#/page/' + pageId;
  }
  window.getPageUrl = getPageUrl;

  function copyIssueUrl(issueKey) {
    const url = getIssueUrl(issueKey);
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Issue link copied');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo(url);
    });
  }
  window.copyIssueUrl = copyIssueUrl;

  function copyPageUrl(pageId) {
    const url = getPageUrl(pageId);
    navigator.clipboard.writeText(url).then(() => {
      if (typeof toastSuccess === 'function') toastSuccess('Page link copied');
    }).catch(() => {
      if (typeof toastInfo === 'function') toastInfo(url);
    });
  }
  window.copyPageUrl = copyPageUrl;

  // ── hashchange listener (browser back/forward) ────────────
  window.addEventListener('hashchange', () => {
    if (suppressNextHashChange) return;
    restoreFromHash();
  });

  // ── Initial route on page load ────────────────────────────
  // Capture the initial hash NOW, before the app's first nav() overwrites it.
  // app.js calls __restoreInitialRoute() once it has finished booting (or
  // logging in) instead of landing on its default section. It used to be the
  // other way round: this file polled until #app was visible and restored the
  // hash, but app.js shows #app before it finishes loading the user, so the
  // restore ran first and the boot's own nav(defaultSection()) then landed on
  // top of it, sending a #/logs link to Workspace.
  let initialHash = (window.location.hash || '').replace(/^#\/?/, '');

  window.__restoreInitialRoute = async function restoreInitialRoute() {
    const hash = initialHash;
    initialHash = '';
    routerActive = true;
    if (!hash || hash === 'overview') return false;
    suppressNextHashChange = true;
    window.location.hash = '#/' + hash;
    try { return await restoreFromHash(); }
    finally { setTimeout(() => { suppressNextHashChange = false; }, 50); }
  };
  // router.js is the last deferred script: everything the boot navigation in
  // app.js may need (workspace, deals, record pages) is defined by now.
  window.__uiScriptsReady = true;
})();
