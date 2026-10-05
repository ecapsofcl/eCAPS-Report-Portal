/* Report Portal - core: session, API, router, app shell, shared UI */
window.RP = (function () {
  'use strict';

  const TOKEN_KEY = 'rp_token';
  const USER_KEY = 'rp_user';
  const ROLE_LABEL = { superadmin: 'Super admin', admin: 'Admin', user: 'User' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const state = { token: '', user: null };
  try {
    state.token = sessionStorage.getItem(TOKEN_KEY) || '';
    state.user = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
  } catch (e) { /* storage unavailable */ }
  if (!state.user) state.token = '';

  function saveSession(token, user) {
    state.token = token;
    state.user = user;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    state.token = '';
    state.user = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- API ---------------- */

  function apiConfigured() {
    return CONFIG.API_URL && /^https:\/\/script\.google\.com\//.test(CONFIG.API_URL);
  }

  // Requests that only read data are safe to repeat automatically.
  const READ_ACTIONS = /^(app\.boot|auth\.login|auth\.me|users\.list|lists\.all|reports\.(list|get)|access\.all|records\.get|locks\.list|status\.get|audit\.list)$/;

  // Google sometimes leaves its reply hanging even after the script has finished.
  // Each attempt is cut off after a time limit; reads are retried, so a stuck
  // reply costs seconds instead of leaving the page on "Loading…".
  async function fetchOnce(action, payload, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: state.token, payload: payload || {} }),
        signal: ctrl ? ctrl.signal : undefined,
        cache: 'no-store',
      });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!data || typeof data !== 'object') {
        // Google sometimes answers its second hop with a 404 or an HTML page even
        // though the script ran. For reads this is worth another attempt.
        const err = new Error('The server sent an unexpected response (' + res.status + ').');
        err.badResponse = true;
        err.retryable = true;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.badResponse) throw e;
      const err = new Error(e && e.name === 'AbortError'
        ? 'The server took too long to reply.'
        : 'Could not reach the server. Check your internet connection and try again.');
      err.retryable = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function api(action, payload) {
    if (!apiConfigured()) throw new Error('The portal is not connected yet. Set API_URL in assets/js/config.js.');
    const isRead = READ_ACTIONS.test(action);
    const limits = isRead ? [12000, 20000, 40000] : [90000];
    let body, lastErr;
    for (let i = 0; i < limits.length; i++) {
      try {
        body = await fetchOnce(action, payload, limits[i]);
        break;
      } catch (e) {
        lastErr = e;
        if (!e.retryable) throw e;
      }
    }
    if (!body) {
      if (!isRead) lastErr.message += ' Your change may still have been saved: reload the page to check before trying again.';
      else lastErr.message += ' Please try again.';
      throw lastErr;
    }
    if (!body.ok) {
      if (body.code === 'AUTH' && action !== 'auth.login') {
        clearSession();
        setTimeout(function () { location.hash = '#/login'; navigate(); }, 0);
      }
      const err = new Error(body.error || 'Something went wrong.');
      err.code = body.code;
      throw err;
    }
    return body.data;
  }

  /* ---------------- helpers ---------------- */

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const locale = CONFIG.LOCALE || 'en-IN';
  const numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const curFmt = new Intl.NumberFormat(locale, { style: 'currency', currency: CONFIG.CURRENCY || 'INR', maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });

  function isBlank(v) { return v === '' || v === null || v === undefined; }
  function fmtNumber(n) { return isBlank(n) || isNaN(Number(n)) ? (isBlank(n) ? '' : String(n)) : numFmt.format(Number(n)); }
  function fmtCurrency(n) { return isBlank(n) || isNaN(Number(n)) ? (isBlank(n) ? '' : String(n)) : curFmt.format(Number(n)); }
  function fmtCompact(n, money) { return (money ? (CONFIG.CURRENCY_SYMBOL || '') : '') + compactFmt.format(n); }

  function fmtDate(s) {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return String(s);
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  function fmtDateTime(s) {
    if (!s) return '';
    const str = String(s);
    if (/(Z|[+-]\d\d:\d\d)$/.test(str)) {
      const d = new Date(str);
      if (!isNaN(d)) {
        return d.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
    }
    const time = str.slice(11, 16);
    return fmtDate(str) + (time ? ', ' + time : '');
  }

  function monthLabel(key) {
    const m = /^(\d{4})-(\d{2})/.exec(key || '');
    return m ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : key;
  }

  function fmtValue(field, v) {
    if (isBlank(v)) return '';
    switch (field.type) {
      case 'currency': return fmtCurrency(v);
      case 'number': return fmtNumber(v);
      case 'date': return fmtDate(v);
      default: return String(v);
    }
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join('').toUpperCase();
  }

  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(function (n) { return chars[n % chars.length]; }).join('');
  }

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- UI pieces ---------------- */

  function toast(message, type) {
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'ok');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = message;
    $('#toasts').appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.remove(); }, 250);
    }, type === 'error' ? 6500 : 3500);
  }

  function setBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.textContent;
      if (busyLabel) btn.textContent = busyLabel;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  // opts: { title, body, submitLabel, busyLabel, danger, wide, cancelLabel, onOpen(form), onSubmit(form) }
  function modal(opts) {
    return new Promise(function (resolve) {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML =
        '<form class="modal' + (opts.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>' +
          '<h2 id="modal-title">' + esc(opts.title) + '</h2>' +
          '<div class="modal-body">' + (opts.body || '') + '</div>' +
          '<p class="form-error" role="alert" hidden></p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn btn-quiet" data-cancel>' + esc(opts.cancelLabel || (opts.submitLabel ? 'Cancel' : 'Close')) + '</button>' +
            (opts.submitLabel ? '<button type="submit" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '">' + esc(opts.submitLabel) + '</button>' : '') +
          '</div>' +
        '</form>';
      document.body.appendChild(wrap);
      document.body.classList.add('modal-open');

      const form = $('form', wrap);
      const errEl = $('.form-error', wrap);
      const prevFocus = document.activeElement;
      let closed = false;

      function close(value) {
        if (closed) return;
        closed = true;
        wrap.remove();
        document.body.classList.remove('modal-open');
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Tab') { // keep focus inside the dialog
          const items = $$('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href]', form).filter(function (el) { return el.offsetParent !== null; });
          if (!items.length) return;
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey);
      $('[data-cancel]', wrap).addEventListener('click', function () { close(null); });
      wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(null); });

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errEl.hidden = true;
        const btn = $('button[type=submit]', form);
        try {
          setBusy(btn, true, opts.busyLabel);
          const result = opts.onSubmit ? await opts.onSubmit(form) : true;
          close(result === undefined ? true : result);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          setBusy(btn, false);
        }
      });

      if (opts.onOpen) opts.onOpen(form);
      const first = $('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])', form) || $('button[type=submit]', form) || $('[data-cancel]', form);
      if (first) first.focus();
    });
  }

  function confirmAction(opts) {
    const body = '<p>' + esc(opts.message) + '</p>' +
      (opts.typeToConfirm
        ? '<label class="field"><span>Type <strong>' + esc(opts.typeToConfirm) + '</strong> to confirm</span><input name="confirmText" autocomplete="off" spellcheck="false"></label>'
        : '');
    return modal({
      title: opts.title,
      body: body,
      submitLabel: opts.confirmLabel || 'Confirm',
      busyLabel: opts.busyLabel,
      danger: opts.danger,
      onSubmit: async function (form) {
        if (opts.typeToConfirm && form.elements.confirmText.value.trim() !== opts.typeToConfirm) {
          throw new Error('The text you typed does not match.');
        }
        if (opts.action) await opts.action();
        return true;
      },
    });
  }

  function pageHead(title, sub, actions) {
    return '<header class="page-head">' +
      '<div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="page-sub">' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') +
      '</header>';
  }

  function emptyState(title, text, action) {
    return '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + (action || '') + '</div>';
  }

  // Spreadsheet-style tab strip used across the portal.
  function sheetTabs(tabs, active, opts) {
    opts = opts || {};
    const items = (opts.all ? [{ v: '__all', l: 'All tabs' }] : []).concat(tabs.map(function (t) { return { v: t, l: t }; }));
    return '<div class="sheet-tabs" role="tablist" aria-label="' + esc(opts.label || 'Tabs') + '">' +
      items.map(function (i) {
        return '<button type="button" role="tab" class="sheet-tab" data-tab="' + esc(i.v) + '" aria-selected="' + (i.v === active) + '">' + esc(i.l) + '</button>';
      }).join('') + '</div>';
  }

  function brandMark(size) {
    const s = size || 28;
    return '<svg class="brand-mark" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect width="24" height="24" rx="5" fill="currentColor"/>' +
      '<path d="M4 9h16M4 15h16M9 4v16M15 4v16" stroke="#fff" stroke-opacity=".45"/>' +
      '<rect x="15" y="15" width="5" height="5" fill="#E2A01B"/></svg>';
  }

  /* ---------------- router ---------------- */

  const routes = [];
  let ticket = 0;

  function route(path, roles, nav, render) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ re: re, keys: keys, roles: roles, nav: nav, render: render });
  }

  const NAV = [
    { key: 'reports', label: 'Reports', href: '#/reports', roles: ['superadmin'] },
    { key: 'lists', label: 'Lists', href: '#/lists', roles: ['superadmin'] },
    { key: 'entry', label: 'Enter data', href: '#/entry', roles: ['superadmin', 'user'] },
    { key: 'view', label: 'View reports', href: '#/view', roles: ['superadmin', 'admin'] },
    { key: 'status', label: 'Status', href: '#/status', roles: ['superadmin'] },
    { key: 'users', label: 'Users', href: '#/users', roles: ['superadmin'] },
    { key: 'access', label: 'Report access', href: '#/access', roles: ['superadmin'] },
    { key: 'activity', label: 'Activity log', href: '#/activity', roles: ['superadmin'] },
  ];

  function home(role) {
    return role === 'superadmin' ? '/reports' : role === 'admin' ? '/view' : '/entry';
  }

  // A page with unsaved changes registers a guard; leaving asks first.
  let leaveGuard = null;
  let currentHash = location.hash;
  function setLeaveGuard(fn) { leaveGuard = fn; }
  window.addEventListener('beforeunload', function (e) {
    if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; }
  });

  function onHashChange() {
    if (leaveGuard && leaveGuard() && location.hash !== currentHash) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        history.replaceState(null, '', currentHash || '#/');
        return;
      }
    }
    navigate();
  }

  async function navigate() {
    const my = ++ticket;
    leaveGuard = null;
    currentHash = location.hash;
    const path = (location.hash || '#/').slice(1).split('?')[0] || '/';

    if (!state.token) {
      if (path !== '/login') history.replaceState(null, '', '#/login');
      renderLogin();
      return;
    }
    if (path === '/' || path === '/login') {
      location.replace('#' + home(state.user.role));
      return;
    }

    let match = null;
    const params = {};
    for (let i = 0; i < routes.length; i++) {
      const m = routes[i].re.exec(path);
      if (m) {
        match = routes[i];
        match.keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
        break;
      }
    }

    renderShell(match ? match.nav : '');
    // Swap in a fresh <main> so listeners from the previous page never leak.
    const oldMain = $('#main');
    const main = oldMain.cloneNode(false);
    oldMain.replaceWith(main);
    if (!match || match.roles.indexOf(state.user.role) === -1) {
      main.innerHTML = emptyState('Page not found', 'This page does not exist, or your role cannot open it.',
        '<a class="btn btn-primary" href="#' + home(state.user.role) + '">Go to your start page</a>');
      return;
    }

    main.innerHTML = '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading…</div>';
    const ctx = { params: params, alive: function () { return my === ticket; } };
    try {
      await match.render(main, ctx);
      if (ctx.alive()) main.focus({ preventScroll: true });
    } catch (err) {
      if (!ctx.alive()) return;
      main.innerHTML = '<div class="empty error-state"><h2>This page could not load</h2><p>' + esc(err.message) + '</p>' +
        '<button class="btn btn-primary" type="button" id="retry">Try again</button></div>';
      $('#retry').addEventListener('click', navigate);
    }
  }

  function renderShell(active) {
    if (!$('#shell')) {
      const u = state.user;
      $('#app').innerHTML =
        '<div id="shell" class="shell">' +
          '<header class="topbar">' +
            '<button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="rail">Menu</button>' +
            '<a class="brand" href="#/">' + brandMark(24) + '<span>' + esc(CONFIG.APP_NAME) + '</span></a>' +
          '</header>' +
          '<aside class="rail" id="rail">' +
            '<a class="brand" href="#/">' + brandMark(28) + '<span>' + esc(CONFIG.APP_NAME) + '</span></a>' +
            '<nav aria-label="Main"><ul class="nav">' +
              NAV.filter(function (n) { return n.roles.indexOf(u.role) !== -1; }).map(function (n) {
                return '<li><a href="' + n.href + '" data-nav="' + n.key + '">' + esc(n.label) + '</a></li>';
              }).join('') +
            '</ul></nav>' +
            '<div class="rail-foot">' +
              '<a class="me" href="#/account" data-nav="account"><span class="avatar" aria-hidden="true">' + esc(initials(u.name)) + '</span>' +
              '<span class="me-text"><strong>' + esc(u.name) + '</strong><small>' + esc(ROLE_LABEL[u.role]) + '</small></span></a>' +
              '<button class="btn btn-quiet btn-block" id="signout" type="button">Sign out</button>' +
            '</div>' +
          '</aside>' +
          '<div class="scrim" id="scrim"></div>' +
          '<main id="main" class="main" tabindex="-1"></main>' +
        '</div>';
      $('#signout').addEventListener('click', signOut);
      $('#menu-btn').addEventListener('click', function () {
        const open = $('#shell').classList.toggle('nav-open');
        $('#menu-btn').setAttribute('aria-expanded', String(open));
      });
      $('#scrim').addEventListener('click', function () {
        $('#shell').classList.remove('nav-open');
        $('#menu-btn').setAttribute('aria-expanded', 'false');
      });
    }
    $$('[data-nav]').forEach(function (a) {
      const on = a.dataset.nav === active;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('#shell').classList.remove('nav-open');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
  }

  function signOut() {
    api('auth.logout').catch(function () { /* ignore */ });
    clearSession();
    clearListsCache();
    clearReportsCache();
    forgetRecords();
    $('#app').innerHTML = '';
    history.replaceState(null, '', '#/login');
    navigate();
  }

  /* ---------------- login ---------------- */

  function renderLogin() {
    $('#app').innerHTML =
      '<div class="login">' +
        '<div class="login-side">' +
          '<a class="brand brand-large" href="#/login">' + brandMark(40) + '<span>' + esc(CONFIG.APP_NAME) + '</span></a>' +
          '<p>Enter branch reports and review them in one place.</p>' +
        '</div>' +
        '<main class="login-main">' +
          '<form class="login-card" id="login-form" novalidate>' +
            '<h1>Sign in</h1>' +
            '<label class="field"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
            '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>' +
            '<p class="form-error" role="alert" hidden></p>' +
            '<button class="btn btn-primary btn-block" type="submit">Sign in</button>' +
            '<p class="hint">Forgot your password? Ask your super admin to reset it.</p>' +
          '</form>' +
        '</main>' +
      '</div>';

    const form = $('#login-form');
    const errEl = $('.form-error', form);
    if (!apiConfigured()) {
      errEl.textContent = 'The portal is not connected yet. Set API_URL in assets/js/config.js to your Apps Script web app URL.';
      errEl.hidden = false;
    }
    form.elements.username.focus();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errEl.hidden = true;
      const username = form.elements.username.value.trim();
      const password = form.elements.password.value;
      if (!username || !password) {
        errEl.textContent = 'Enter your username and password.';
        errEl.hidden = false;
        return;
      }
      const btn = $('button[type=submit]', form);
      setBusy(btn, true, 'Signing in…');
      try {
        const res = await api('auth.login', { username: username, password: password });
        saveSession(res.token, res.user);
        clearListsCache();
        clearReportsCache();
        forgetRecords();
        boot().catch(function () { /* pages retry on their own */ });
        $('#app').innerHTML = '';
        history.replaceState(null, '', '#' + home(res.user.role));
        navigate();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        setBusy(btn, false);
        form.elements.password.select();
      }
    });
  }

  /* ---------------- account ---------------- */

  route('/account', ['superadmin', 'admin', 'user'], 'account', async function (main) {
    const u = state.user;
    main.innerHTML = pageHead('Your account') +
      '<div class="stack narrow">' +
        '<section class="panel"><dl class="facts">' +
          '<dt>Name</dt><dd>' + esc(u.name) + '</dd>' +
          '<dt>Username</dt><dd>' + esc(u.username) + '</dd>' +
          '<dt>Role</dt><dd>' + esc(ROLE_LABEL[u.role]) + '</dd>' +
        '</dl></section>' +
        '<section class="panel"><h2>Change password</h2>' +
          '<form id="pw-form" novalidate>' +
            '<label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>' +
            '<label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>' +
            '<label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password" required></label>' +
            '<p class="form-error" role="alert" hidden></p>' +
            '<button class="btn btn-primary" type="submit">Change password</button>' +
          '</form></section>' +
      '</div>';

    const form = $('#pw-form', main);
    const errEl = $('.form-error', form);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errEl.hidden = true;
      const f = form.elements;
      let msg = '';
      if (!f.current.value) msg = 'Enter your current password.';
      else if (f.next.value.length < 8) msg = 'The new password must be at least 8 characters.';
      else if (f.next.value !== f.confirm.value) msg = 'The new passwords do not match.';
      if (msg) { errEl.textContent = msg; errEl.hidden = false; return; }

      const btn = $('button[type=submit]', form);
      setBusy(btn, true, 'Changing…');
      try {
        const res = await api('auth.changePassword', { currentPassword: f.current.value, newPassword: f.next.value });
        saveSession(res.token, state.user);
        form.reset();
        toast('Password changed.');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
      setBusy(btn, false);
    });
  });

  /* ---------------- shared data ---------------- */

  let listsCache = null;
  let reportsCache = null;
  let booting = null;

  // Reports and lists arrive together in one request at start-up.
  function boot() {
    if (!booting) {
      booting = api('app.boot').then(function (d) {
        listsCache = d.lists;
        reportsCache = d.reports;
      }).finally(function () { booting = null; });
    }
    return booting;
  }
  async function getLists(force) {
    if (force) listsCache = null;
    if (!listsCache) {
      if (!reportsCache || booting) await boot();
      else listsCache = await api('lists.all');
    }
    return listsCache;
  }
  async function getReports(force) {
    if (force) reportsCache = null;
    if (!reportsCache) {
      if (!listsCache || booting) await boot();
      else reportsCache = await api('reports.list');
    }
    return reportsCache;
  }
  function clearListsCache() { listsCache = null; }
  function clearReportsCache() { reportsCache = null; }

  // Figures already seen are shown at once; fresh figures load in the background
  // and replace them if anything changed.
  let recordsCache = {};
  async function getRecords(reportId, from, to, onFresh) {
    const key = reportId + '|' + from + '|' + to;
    function fetchIt() {
      return api('records.get', { reportId: reportId, from: from, to: to }).then(function (d) {
        const sig = JSON.stringify([d.records, d.linked, d.locks, d.report.updatedAt]);
        const changed = !recordsCache[key] || recordsCache[key].sig !== sig;
        recordsCache[key] = { data: d, sig: sig };
        return { data: d, changed: changed };
      });
    }
    if (recordsCache[key]) {
      fetchIt().then(function (r) { if (r.changed && onFresh) onFresh(r.data); }).catch(function () { /* keep what is shown */ });
      return recordsCache[key].data;
    }
    return (await fetchIt()).data;
  }
  function forgetRecords() { recordsCache = {}; }

  // Shown when loading figures fails, instead of an endless "Loading…".
  function loadError(el, err, retry) {
    el.innerHTML = '<div class="empty compact" role="alert"><p><strong>Could not load the figures.</strong></p><p class="muted">' +
      esc(err && err.message ? err.message : String(err)) + '</p><button class="btn btn-primary" type="button">Try again</button></div>';
    el.querySelector('button').addEventListener('click', retry);
  }

  function reportMeta(r, lists) {
    const s = r.settings || {};
    const list = s.itemList ? (lists || []).find(function (l) { return l.id === s.itemList; }) : null;
    const period = s.periodType === 'date' ? 'By date' : 'Monthly';
    const year = Number(s.yearStart || 4) === 4 ? '' : ', year starts ' + MONTHS[Number(s.yearStart) - 1];
    return period + year + (list ? ', items: ' + list.name : '');
  }

  /* ---------------- start ---------------- */

  async function start() {
    window.addEventListener('hashchange', onHashChange);
    if (state.token) {
      try {
        const user = await api('auth.me');
        saveSession(state.token, user); // picks up role or name changes
      } catch (e) {
        if (e.code === 'AUTH') clearSession();
      }
    }
    navigate();
  }

  return {
    state: state, api: api, esc: esc, $: $, $$: $$,
    toast: toast, modal: modal, confirmAction: confirmAction, setBusy: setBusy,
    route: route, navigate: navigate, pageHead: pageHead, emptyState: emptyState, sheetTabs: sheetTabs,
    fmtNumber: fmtNumber, fmtCurrency: fmtCurrency, fmtCompact: fmtCompact, fmtDate: fmtDate,
    fmtDateTime: fmtDateTime, fmtValue: fmtValue, monthLabel: monthLabel, todayISO: todayISO,
    isBlank: isBlank, randomPassword: randomPassword, reduceMotion: reduceMotion,
    ROLE_LABEL: ROLE_LABEL, MONTHS: MONTHS, start: start, signOut: signOut, setLeaveGuard: setLeaveGuard, getLists: getLists, clearListsCache: clearListsCache, getReports: getReports, clearReportsCache: clearReportsCache, loadError: loadError, getRecords: getRecords, forgetRecords: forgetRecords, boot: boot, reportMeta: reportMeta,
  };
})();
