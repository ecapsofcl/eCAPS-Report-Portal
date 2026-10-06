/* Report Portal - super admin screens */
(function () {
  'use strict';
  const {
    api, esc, $, $$, toast, modal, confirmAction, setBusy, route, navigate, getReports, clearReportsCache,
    pageHead, emptyState, fmtDateTime, randomPassword, state, ROLE_LABEL, MONTHS, getLists, clearListsCache, reportMeta,
  } = RP;
  const C = window.RPCalc;

  const TYPE_LABEL = {
    amount: 'Amount (₹)', number: 'Number', quantity: 'Quantity', percent: 'Percentage',
    text: 'Text', dropdown: 'Dropdown', date: 'Date', yesno: 'Yes / No',
  };
  const FORMAT_LABEL = { amount: 'Amount', number: 'Number', percent: 'Percentage', text: 'Text' };
  const ROLLUP_LABEL = { sum: 'Sum', avg: 'Average', last: 'Last value' };
  const UNIT_LABEL = { rupees: 'Rupees', lakhs: 'Lakhs', crores: 'Crores' };
  const GROUPS = ['Sales', 'Stock and ageing', 'Targets', 'Other'];
  const ROLE_HELP = {
    user: 'Enters data for the reports and branches you assign.',
    admin: 'Views reports as tables and charts for assigned reports and branches. Cannot enter data.',
    superadmin: 'Full control of reports, lists, users and access.',
  };
  const isNumeric = function (t) { return C.NUMERIC.indexOf(t) !== -1; };

  function codeFrom(label) {
    let c = String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[A-Z]/.test(c)) c = 'F_' + c;
    return c.slice(0, 24).replace(/_+$/, '');
  }

  /* =============== Reports list =============== */

  route('/reports', ['superadmin'], 'reports', async function (main, ctx) {
    const res = await Promise.all([getReports(true), getLists()]);
    if (!ctx.alive()) return;
    const reports = res[0], lists = res[1];
    const newBtn = '<a class="btn btn-primary" href="#/reports/new">New report</a>';
    if (!reports.length) {
      main.innerHTML = pageHead('Reports') + emptyState('No reports yet',
        'Create a report, or run seedStandardReports() in Apps Script to create the 11 standard reports.', newBtn);
      return;
    }
    const groups = {};
    reports.forEach(function (r) { (groups[r.group || 'Other'] = groups[r.group || 'Other'] || []).push(r); });

    main.innerHTML = pageHead('Reports', 'Every report follows the same structure: settings, input fields, calculated fields and summaries.', newBtn) +
      Object.keys(groups).sort().map(function (g) {
        return '<section class="report-group"><h2>' + esc(g) + '</h2><div class="table-wrap panel-flush"><table class="table">' +
          '<thead><tr><th scope="col">Report</th><th scope="col">Period and items</th><th scope="col" class="num">Fields</th><th scope="col">Last changed</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
          groups[g].map(function (r) {
            const inputs = r.fields.filter(function (f) { return !f.archived; }).length;
            return '<tr><td><strong>' + esc(r.name) + '</strong>' + (r.description ? '<div class="muted small">' + esc(r.description) + '</div>' : '') + '</td>' +
              '<td>' + esc(reportMeta(r, lists)) + '<div class="muted small">' + esc(r.settings.branches.length + ' branch' + (r.settings.branches.length === 1 ? '' : 'es')) + '</div></td>' +
              '<td class="num">' + inputs + ' + ' + r.calcs.length + '<div class="muted small">input + calculated</div></td>' +
              '<td>' + esc(fmtDateTime(r.updatedAt || r.createdAt)) + '</td>' +
              '<td class="row-actions">' +
                '<a class="btn btn-small" href="#/entry/' + encodeURIComponent(r.id) + '">Enter</a>' +
                '<a class="btn btn-small" href="#/view/' + encodeURIComponent(r.id) + '">View</a>' +
                '<a class="btn btn-small" href="#/reports/' + encodeURIComponent(r.id) + '/edit">Edit</a>' +
                '<a class="btn btn-small" href="#/import/' + encodeURIComponent(r.id) + '">Import</a>' +
                '<a class="btn btn-small" href="' + esc(r.spreadsheetUrl) + '" target="_blank" rel="noopener">Sheet</a>' +
                '<button class="btn btn-small btn-danger-quiet" type="button" data-delete="' + esc(r.id) + '">Delete</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table></div></section>';
      }).join('');

    main.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-delete]');
      if (!btn) return;
      const r = reports.find(function (x) { return x.id === btn.dataset.delete; });
      const ok = await confirmAction({
        title: 'Delete "' + r.name + '"?',
        message: 'The report leaves the portal and its Google Sheet moves to Drive trash, where it can be recovered for 30 days.',
        confirmLabel: 'Delete report', busyLabel: 'Deleting…', danger: true, typeToConfirm: r.name,
        action: function () { return api('reports.delete', { id: r.id }); },
      });
      if (ok) { clearReportsCache(); toast('Report deleted.'); navigate(); }
    });
  });

  /* =============== Report builder =============== */

  route('/reports/new', ['superadmin'], 'reports', async function (main, ctx) {
    const res = await Promise.all([getReports(true), getLists(true)]);
    if (!ctx.alive()) return;
    renderBuilder(main, null, res[0], res[1]);
  });

  route('/reports/:id/edit', ['superadmin'], 'reports', async function (main, ctx) {
    const res = await Promise.all([getReports(true), getLists(true)]);
    if (!ctx.alive()) return;
    const report = res[0].find(function (r) { return r.id === ctx.params.id; });
    if (!report) { main.innerHTML = emptyState('Report not found', 'It may have been deleted.', '<a class="btn" href="#/reports">All reports</a>'); return; }
    renderBuilder(main, report, res[0], res[1]);
  });

  function renderBuilder(main, report, reports, lists) {
    const editing = !!report;
    const branchList = lists.find(function (l) { return l.id === 'l_branches'; });
    const allBranches = branchList ? branchList.items.map(function (i) { return i.name; }) : [];
    const others = reports.filter(function (r) { return !report || r.id !== report.id; });
    const clone = function (x) { return JSON.parse(JSON.stringify(x)); };

    const st = {
      name: editing ? report.name : '',
      group: editing ? report.group : 'Sales',
      description: editing ? report.description || '' : '',
      settings: editing ? clone(report.settings) : { periodType: 'month', yearStart: 4, branches: allBranches.slice(), itemList: '', unit: 'lakhs', decimals: 2 },
      fields: editing ? clone(report.fields).map(function (f) { f.saved = true; return f; }) : [
        { code: 'SALES', label: 'Sales', type: 'amount', level: 'item', required: false, negative: true, rollup: 'sum', links: [], codeTouched: false },
      ],
      calcs: editing ? clone(report.calcs) : [],
      summaries: editing ? clone(report.summaries) : { total: true, avg: false, avgBranch: false, count: false, min: false, max: false, share: '', rank: '', top: null },
    };
    st.summaries.top = st.summaries.top || null;

    main.innerHTML = pageHead(editing ? 'Edit report' : 'New report',
      editing ? 'Saved fields keep their code, type and level so past data stays correct.' : 'Build the report from settings, input fields, calculated fields and summaries.',
      '<a class="btn btn-quiet" href="#/reports">Cancel</a>') +
      '<form id="builder" class="builder-form" novalidate>' +
        '<section class="panel"><h2>Details</h2><div class="form-grid">' +
          '<div class="field"><label for="b-name">Report name</label><input id="b-name" maxlength="100" required></div>' +
          '<div class="field"><label for="b-group">Group</label><input id="b-group" list="b-groups" maxlength="40"><datalist id="b-groups">' +
            GROUPS.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist></div>' +
          '<div class="field span-2"><label for="b-desc">Description <em>optional</em></label><input id="b-desc" maxlength="500"></div>' +
        '</div></section>' +
        '<section class="panel"><h2>Part 1: Settings</h2><div id="b-settings"></div></section>' +
        '<section class="panel"><div class="panel-head"><h2>Part 2: Input fields</h2><button type="button" class="btn btn-small" id="add-field">Add field</button></div>' +
          '<p class="muted small">What the head office person types. The code is used in formulas.</p><div id="b-fields" class="def-list"></div></section>' +
        '<section class="panel"><div class="panel-head"><h2>Part 3: Calculated fields</h2><button type="button" class="btn btn-small" id="add-calc">Add calculated field</button></div>' +
          '<p class="muted small">Worked out from other fields; never typed. Totals are recalculated, not added up.</p>' +
          '<div id="b-calcs" class="def-list"></div>' + functionHelp() + '</section>' +
        '<section class="panel"><h2>Part 4: Summaries</h2><div id="b-summaries"></div></section>' +
        '<section class="panel"><h2>Preview</h2><p class="muted small">Every report shows its data in this standard shape.</p><div id="b-preview"></div></section>' +
        '<p class="form-error" role="alert" hidden></p>' +
        '<div class="builder-actions"><button class="btn btn-primary" type="submit">' + (editing ? 'Save changes' : 'Create report') + '</button></div>' +
      '</form>';

    const form = $('#builder', main);
    const errEl = $('.form-error', form);
    $('#b-name', form).value = st.name;
    $('#b-group', form).value = st.group;
    $('#b-desc', form).value = st.description;
    $('#b-name', form).addEventListener('input', function (e) { st.name = e.target.value; });
    $('#b-group', form).addEventListener('input', function (e) { st.group = e.target.value; });
    $('#b-desc', form).addEventListener('input', function (e) { st.description = e.target.value; });

    const activeFields = function () { return st.fields.filter(function (f) { return !f.archived; }); };
    const hasItems = function () { return !!st.settings.itemList; };
    const allCodes = function () {
      return activeFields().map(function (f) { return f.code; }).concat(st.calcs.map(function (c) { return c.code; }));
    };
    const numericCodes = function () {
      return activeFields().filter(function (f) { return isNumeric(f.type); }).map(function (f) { return { code: f.code, label: f.label }; })
        .concat(st.calcs.filter(function (c) { return c.format !== 'text'; }).map(function (c) { return { code: c.code, label: c.label }; }));
    };

    /* ----- settings ----- */
    function renderSettings() {
      const s = st.settings;
      $('#b-settings', form).innerHTML =
        '<div class="form-grid three">' +
          '<div class="field"><label for="s-ptype">Period</label><select id="s-ptype"' + (editing ? ' disabled' : '') + '>' +
            '<option value="month"' + (s.periodType === 'month' ? ' selected' : '') + '>Monthly</option>' +
            '<option value="date"' + (s.periodType === 'date' ? ' selected' : '') + '>By date (snapshots, e.g. ageing)</option></select></div>' +
          '<div class="field"><label for="s-ystart">Year starts in</label><select id="s-ystart">' +
            MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (Number(s.yearStart) === i + 1 ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="s-items">Item list</label><select id="s-items"' + (editing ? ' disabled' : '') + '>' +
            '<option value="">None: one row per branch</option>' +
            lists.filter(function (l) { return l.id !== 'l_branches'; }).map(function (l) {
              return '<option value="' + esc(l.id) + '"' + (s.itemList === l.id ? ' selected' : '') + '>' + esc(l.name) + ' (' + l.items.length + ')</option>';
            }).join('') + '</select><small><a href="#/lists">Manage lists</a></small></div>' +
          '<div class="field"><label for="s-unit">Show amounts in</label><select id="s-unit">' +
            Object.keys(UNIT_LABEL).map(function (u) { return '<option value="' + u + '"' + (s.unit === u ? ' selected' : '') + '>' + UNIT_LABEL[u] + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="s-dec">Decimals</label><select id="s-dec">' +
            [0, 1, 2].map(function (d) { return '<option value="' + d + '"' + (Number(s.decimals) === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
          (s.itemList ? '<div class="field"><label for="s-rows">Entry screen</label><select id="s-rows">' +
            '<option value="0">List every item</option>' +
            [3, 5, 6, 7, 8, 10, 12, 15, 20].concat(Number(s.entryRows) > 0 && [3, 5, 6, 7, 8, 10, 12, 15, 20].indexOf(Number(s.entryRows)) === -1 ? [Number(s.entryRows)] : [])
              .map(function (n) { return '<option value="' + n + '"' + (Number(s.entryRows) === n ? ' selected' : '') + '>Pick items from a dropdown: ' + n + ' rows</option>'; }).join('') +
            '</select></div>' : '') +
          '<div class="field"><span class="label">Record key</span><p class="static">' + (s.itemList ? 'Period + Branch + Item' : 'Period + Branch') + '</p></div>' +
        '</div>' +
        '<fieldset class="field"><legend>Branches</legend><div class="check-grid">' +
          allBranches.map(function (b) { return '<label class="check"><input type="checkbox" value="' + esc(b) + '"' + (s.branches.indexOf(b) !== -1 ? ' checked' : '') + '>' + esc(b) + '</label>'; }).join('') +
        '</div></fieldset>' +
        (editing ? '<p class="muted small">Period type and item list are fixed once a report is created, because stored data depends on them.</p>' : '');
      const box = $('#b-settings', form);
      $('#s-ptype', box).addEventListener('change', function (e) { s.periodType = e.target.value; renderPreview(); });
      $('#s-ystart', box).addEventListener('change', function (e) { s.yearStart = Number(e.target.value); });
      $('#s-items', box).addEventListener('change', function (e) {
        s.itemList = e.target.value;
        st.fields.forEach(function (f) { if (!f.saved) { f.level = 'item'; f.links = []; } });
        renderSettings(); renderFields(); renderPreview();
      });
      $('#s-unit', box).addEventListener('change', function (e) { s.unit = e.target.value; });
      const rowsSel = $('#s-rows', box);
      if (rowsSel) rowsSel.addEventListener('change', function (e) { s.entryRows = Number(e.target.value); });
      $('#s-dec', box).addEventListener('change', function (e) { s.decimals = Number(e.target.value); });
      $$('.check-grid input', box).forEach(function (c) {
        c.addEventListener('change', function () {
          s.branches = $$('.check-grid input:checked', box).map(function (x) { return x.value; });
        });
      });
    }

    /* ----- input fields ----- */
    function renderFields() {
      const box = $('#b-fields', form);
      box.innerHTML = st.fields.map(function (f, i) {
        const locked = !!f.saved;
        const numeric = isNumeric(f.type);
        const canUp = !locked && i > 0 && !st.fields[i - 1].saved;
        const canDown = !locked && i < st.fields.length - 1;
        return '<div class="def-row' + (f.archived ? ' is-archived' : '') + '" data-i="' + i + '">' +
          '<div class="def-main">' +
            '<div class="def-line">' +
              '<div class="field"><label>Label</label><input data-k="label" value="' + esc(f.label) + '" maxlength="60"' + (f.archived ? ' disabled' : '') + '></div>' +
              '<div class="field code"><label>Code</label><input data-k="code" value="' + esc(f.code) + '" maxlength="24"' + (locked ? ' disabled' : '') + '></div>' +
              '<div class="field"><label>Type</label><select data-k="type"' + (locked ? ' disabled' : '') + '>' +
                Object.keys(TYPE_LABEL).map(function (t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>'; }).join('') + '</select></div>' +
              (hasItems() ? '<div class="field"><label>Entered</label><select data-k="level"' + (locked ? ' disabled' : '') + '>' +
                '<option value="item"' + (f.level !== 'branch' ? ' selected' : '') + '>Per item</option>' +
                '<option value="branch"' + (f.level === 'branch' ? ' selected' : '') + '>Once per branch and period</option></select></div>' : '') +
              (numeric ? '<div class="field"><label>Over periods</label><select data-k="rollup">' +
                Object.keys(ROLLUP_LABEL).map(function (r) { return '<option value="' + r + '"' + (f.rollup === r ? ' selected' : '') + '>' + ROLLUP_LABEL[r] + '</option>'; }).join('') + '</select></div>' : '') +
              (f.type === 'dropdown' ? '<div class="field"><label>Options from</label><select data-k="options"><option value="">Choose a list</option>' +
                lists.map(function (l) { return '<option value="' + esc(l.id) + '"' + (f.options === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></div>' : '') +
            '</div>' +
            '<div class="def-flags">' +
              '<label class="check"><input type="checkbox" data-k="required"' + (f.required ? ' checked' : '') + (f.archived ? ' disabled' : '') + '>Required</label>' +
              (numeric ? '<label class="check"><input type="checkbox" data-k="negative"' + (f.negative ? ' checked' : '') + (f.archived ? ' disabled' : '') + '>Negative allowed</label>' : '') +
              (hasItems() && f.level !== 'branch' && !f.archived
                ? '<button type="button" class="btn btn-small" data-act="links">' + ((f.links || []).length ? 'Filled from other reports: ' + f.links.length + ' item' + (f.links.length === 1 ? '' : 's') : 'Fill some items from other reports') + '</button>' : '') +
              (f.archived ? '<span class="muted small">Removed from entry. Its column and data stay in the sheet.</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="def-tools">' +
            (!locked ? '<button type="button" class="icon-btn" data-act="up" aria-label="Move up"' + (canUp ? '' : ' disabled') + '>\u2191</button>' +
              '<button type="button" class="icon-btn" data-act="down" aria-label="Move down"' + (canDown ? '' : ' disabled') + '>\u2193</button>' : '') +
            (f.archived ? '<button type="button" class="btn btn-small" data-act="restore">Restore</button>'
              : '<button type="button" class="btn btn-small btn-danger-quiet" data-act="remove">Remove</button>') +
          '</div></div>';
      }).join('');
    }

    const fieldsBox = $('#b-fields', form);
    fieldsBox.addEventListener('input', function (e) {
      const row = e.target.closest('.def-row');
      if (!row) return;
      const f = st.fields[Number(row.dataset.i)];
      const k = e.target.dataset.k;
      if (k === 'label') {
        f.label = e.target.value;
        if (!f.saved && !f.codeTouched) { f.code = codeFrom(f.label); $('[data-k=code]', row).value = f.code; }
      }
      if (k === 'code') { f.code = e.target.value.toUpperCase(); f.codeTouched = true; }
      renderPreview();
    });
    fieldsBox.addEventListener('change', function (e) {
      const row = e.target.closest('.def-row');
      if (!row) return;
      const f = st.fields[Number(row.dataset.i)];
      const k = e.target.dataset.k;
      if (k === 'code') { e.target.value = f.code; }
      if (k === 'type') { f.type = e.target.value; if (!isNumeric(f.type)) { f.rollup = 'last'; f.negative = false; } else if (f.rollup === 'last' && !f.saved) f.rollup = 'sum'; renderFields(); renderSummaries(); }
      if (k === 'level') { f.level = e.target.value; if (f.level === 'branch') f.links = []; renderFields(); }
      if (k === 'rollup') f.rollup = e.target.value;
      if (k === 'options') f.options = e.target.value;
      if (k === 'required') f.required = e.target.checked;
      if (k === 'negative') f.negative = e.target.checked;
      renderPreview();
    });
    fieldsBox.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const i = Number(btn.closest('.def-row').dataset.i);
      const f = st.fields[i];
      const act = btn.dataset.act;
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        const t = st.fields[i]; st.fields[i] = st.fields[j]; st.fields[j] = t;
      } else if (act === 'remove') {
        if (f.saved) f.archived = true; else st.fields.splice(i, 1);
      } else if (act === 'restore') {
        f.archived = false;
      } else if (act === 'links') {
        const links = await editLinks(f);
        if (links) f.links = links;
      }
      renderFields(); renderSummaries(); renderPreview(); checkCalcs();
    });
    $('#add-field', form).addEventListener('click', function () {
      st.fields.push({ code: '', label: '', type: 'amount', level: 'item', required: false, negative: false, rollup: 'sum', links: [], codeTouched: false });
      renderFields(); renderPreview();
      const inputs = $$('[data-k=label]', fieldsBox);
      inputs[inputs.length - 1].focus();
    });

    // Items of this report that take their figure from another report.
    async function editLinks(f) {
      const list = lists.find(function (l) { return l.id === st.settings.itemList; });
      const items = list ? list.items.map(function (x) { return x.name; }) : [];
      const rows = (f.links || []).map(function (l) { return Object.assign({}, l); });
      const sources = others.filter(function (r) { return r.fields.some(function (x) { return !x.archived && isNumeric(x.type); }); });
      function rowHtml(l, k) {
        const src = sources.find(function (r) { return r.id === l.reportId; });
        return '<tr data-k="' + k + '">' +
          '<td><select data-f="item"><option value="">Item</option>' + items.map(function (n) { return '<option' + (l.item === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></td>' +
          '<td><select data-f="reportId"><option value="">Report</option>' + sources.map(function (r) { return '<option value="' + esc(r.id) + '"' + (l.reportId === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select></td>' +
          '<td><select data-f="field">' + (src ? src.fields.filter(function (x) { return !x.archived && isNumeric(x.type); }).map(function (x) {
            return '<option value="' + esc(x.code) + '"' + (l.field === x.code ? ' selected' : '') + '>' + esc(x.label + ' (' + x.code + ')') + '</option>'; }).join('') : '<option value="">Field</option>') + '</select></td>' +
          '<td><button type="button" class="btn btn-small btn-danger-quiet" data-del="' + k + '">Remove</button></td></tr>';
      }
      return modal({
        title: 'Fill "' + (f.label || f.code) + '" from other reports', wide: true, submitLabel: 'Save links',
        body: '<p class="muted small">For these items the figure comes from another report, so it is typed only once. ' +
          'If that report has no data yet for the month and branch, a typed value is used instead (useful for history).</p>' +
          '<div class="table-wrap"><table class="table compact-table"><thead><tr><th>Item</th><th>Take from report</th><th>Field</th><th></th></tr></thead><tbody id="lk-rows"></tbody></table></div>' +
          '<button type="button" class="btn btn-small" id="lk-add">Add item</button>',
        onOpen: function (mf) {
          const body = $('#lk-rows', mf);
          const draw = function () { body.innerHTML = rows.map(rowHtml).join(''); };
          draw();
          body.addEventListener('change', function (e) {
            const tr = e.target.closest('tr');
            const l = rows[Number(tr.dataset.k)];
            l[e.target.dataset.f] = e.target.value;
            if (e.target.dataset.f === 'reportId') {
              const src = sources.find(function (r) { return r.id === l.reportId; });
              const fld = src ? src.fields.find(function (x) { return !x.archived && isNumeric(x.type); }) : null;
              l.field = fld ? fld.code : '';
              draw();
            }
          });
          body.addEventListener('click', function (e) {
            const b = e.target.closest('[data-del]');
            if (b) { rows.splice(Number(b.dataset.del), 1); draw(); }
          });
          $('#lk-add', mf).addEventListener('click', function () { rows.push({ item: '', reportId: '', field: '' }); draw(); });
        },
        onSubmit: function () {
          const out = rows.filter(function (l) { return l.item || l.reportId; });
          out.forEach(function (l) { if (!l.item || !l.reportId || !l.field) throw new Error('Choose the item, report and field on every row.'); });
          const seen = {};
          out.forEach(function (l) { if (seen[l.item]) throw new Error('"' + l.item + '" is listed twice.'); seen[l.item] = true; });
          return out;
        },
      });
    }

    /* ----- calculated fields ----- */
    function renderCalcs() {
      $('#b-calcs', form).innerHTML = st.calcs.length ? st.calcs.map(function (c, i) {
        return '<div class="def-row" data-i="' + i + '"><div class="def-main">' +
          '<div class="def-line">' +
            '<div class="field"><label>Label</label><input data-k="label" value="' + esc(c.label) + '" maxlength="60"></div>' +
            '<div class="field code"><label>Code</label><input data-k="code" value="' + esc(c.code) + '" maxlength="24"></div>' +
            '<div class="field"><label>Shown as</label><select data-k="format">' +
              Object.keys(FORMAT_LABEL).map(function (k) { return '<option value="' + k + '"' + (c.format === k ? ' selected' : '') + '>' + FORMAT_LABEL[k] + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Show on</label><select data-k="where"><option value="all"' + (c.where !== 'totals' ? ' selected' : '') + '>Every row</option>' +
              '<option value="totals"' + (c.where === 'totals' ? ' selected' : '') + '>Branch and total rows only</option></select></div>' +
          '</div>' +
          '<div class="field formula"><label>Formula</label><input data-k="formula" value="' + esc(c.formula) + '" spellcheck="false" placeholder="e.g. SALES - TARGET"><small class="formula-msg" aria-live="polite"></small></div>' +
        '</div><div class="def-tools"><button type="button" class="btn btn-small btn-danger-quiet" data-act="remove">Remove</button></div></div>';
      }).join('') : '<p class="muted">No calculated fields.</p>';
      checkCalcs();
    }
    function reportCodes(name) {
      const r = others.find(function (x) { return x.name.toLowerCase() === String(name).toLowerCase(); });
      return r ? r.fields.map(function (f) { return f.code; }) : null;
    }
    function checkCalcs() {
      let ok = true;
      $$('#b-calcs .def-row', form).forEach(function (row) {
        const c = st.calcs[Number(row.dataset.i)];
        const msg = $('.formula-msg', row);
        try {
          C.check(c.formula, allCodes().filter(function (x) { return x !== c.code; }), reportCodes);
          msg.textContent = 'Formula is valid.';
          msg.className = 'formula-msg ok';
        } catch (e) {
          msg.textContent = e.message;
          msg.className = 'formula-msg bad';
          ok = false;
        }
      });
      return ok;
    }
    const calcsBox = $('#b-calcs', form);
    calcsBox.addEventListener('input', function (e) {
      const row = e.target.closest('.def-row');
      if (!row) return;
      const c = st.calcs[Number(row.dataset.i)];
      const k = e.target.dataset.k;
      if (k === 'label') {
        c.label = e.target.value;
        if (!c.codeTouched && !c.id) { c.code = codeFrom(c.label); $('[data-k=code]', row).value = c.code; }
      }
      if (k === 'code') { c.code = e.target.value.toUpperCase(); c.codeTouched = true; }
      if (k === 'formula') c.formula = e.target.value;
      checkCalcs(); renderPreview();
    });
    calcsBox.addEventListener('change', function (e) {
      const row = e.target.closest('.def-row');
      if (!row) return;
      const c = st.calcs[Number(row.dataset.i)];
      if (e.target.dataset.k === 'format') { c.format = e.target.value; renderSummaries(); }
      if (e.target.dataset.k === 'where') c.where = e.target.value;
      if (e.target.dataset.k === 'code') e.target.value = c.code;
    });
    calcsBox.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act=remove]');
      if (!btn) return;
      st.calcs.splice(Number(btn.closest('.def-row').dataset.i), 1);
      renderCalcs(); renderSummaries(); renderPreview();
    });
    $('#add-calc', form).addEventListener('click', function () {
      st.calcs.push({ code: '', label: '', format: 'amount', formula: '', where: 'all' });
      renderCalcs();
      const inputs = $$('#b-calcs [data-k=label]', form);
      inputs[inputs.length - 1].focus();
    });

    /* ----- summaries ----- */
    function renderSummaries() {
      const s = st.summaries;
      const nums = numericCodes();
      const opt = function (cur, none) {
        return '<option value="">' + none + '</option>' + nums.map(function (n) {
          return '<option value="' + esc(n.code) + '"' + (cur === n.code ? ' selected' : '') + '>' + esc(n.label + ' (' + n.code + ')') + '</option>';
        }).join('');
      };
      const branchNums = activeFields().filter(function (f) { return isNumeric(f.type) && (f.level === 'branch'); });
      $('#b-summaries', form).innerHTML =
        '<div class="check-grid">' +
          [['total', 'Total row'], ['avg', 'Average per period'], ['avgBranch', 'Average per branch per period'], ['count', 'Count of rows with figures'], ['min', 'Lowest'], ['max', 'Highest']]
            .map(function (x) { return '<label class="check"><input type="checkbox" data-s="' + x[0] + '"' + (s[x[0]] ? ' checked' : '') + '>' + x[1] + '</label>'; }).join('') +
        '</div>' +
        '<div class="form-grid three">' +
          '<div class="field"><label for="sm-share">Show % share of</label><select id="sm-share">' + opt(s.share, 'No share column') + '</select></div>' +
          '<div class="field"><label for="sm-rank">Rank rows by</label><select id="sm-rank">' + opt(s.rank, 'No ranking') + '</select></div>' +
          '<div class="field"><label for="sm-top">Top N by</label><select id="sm-top">' + opt(s.top ? s.top.code : '', 'Show all items') + '</select></div>' +
          (s.top ? '<div class="field"><label for="sm-n">N</label><input id="sm-n" type="number" min="1" max="50" value="' + esc(s.top.n) + '"></div>' +
            '<div class="field"><label for="sm-tt">Others = this total minus the top N</label><select id="sm-tt"><option value="">Sum of the remaining items</option>' +
              branchNums.map(function (f) { return '<option value="' + esc(f.code) + '"' + (s.top.totalCode === f.code ? ' selected' : '') + '>' + esc(f.label + ' (' + f.code + ')') + '</option>'; }).join('') +
            '</select></div>' : '') +
        '</div>';
      const box = $('#b-summaries', form);
      $$('[data-s]', box).forEach(function (c) { c.addEventListener('change', function () { s[c.dataset.s] = c.checked; }); });
      $('#sm-share', box).addEventListener('change', function (e) { s.share = e.target.value; });
      $('#sm-rank', box).addEventListener('change', function (e) { s.rank = e.target.value; });
      $('#sm-top', box).addEventListener('change', function (e) {
        s.top = e.target.value ? { code: e.target.value, n: (s.top && s.top.n) || 6, totalCode: (s.top && s.top.totalCode) || '' } : null;
        renderSummaries();
      });
      if (s.top) {
        $('#sm-n', box).addEventListener('input', function (e) { s.top.n = Number(e.target.value); });
        $('#sm-tt', box).addEventListener('change', function (e) { s.top.totalCode = e.target.value; });
      }
    }

    /* ----- preview ----- */
    function renderPreview() {
      const cols = ['Period', 'Branch'].concat(hasItems() ? ['Item'] : [])
        .map(function (c) { return { l: c, cls: 'sys' }; })
        .concat(activeFields().map(function (f) { return { l: (f.label || 'Untitled') + (f.level === 'branch' && hasItems() ? ' *' : ''), cls: 'in' }; }))
        .concat(st.calcs.map(function (c) { return { l: c.label || 'Untitled', cls: 'calc' }; }));
      const sample = [st.settings.periodType === 'date' ? '31 Aug 2026' : 'Aug 2026', st.settings.branches[0] || 'Branch']
        .concat(hasItems() ? [((lists.find(function (l) { return l.id === st.settings.itemList; }) || { items: [{ name: 'Item' }] }).items[0] || { name: 'Item' }).name] : [])
        .concat(activeFields().map(function (f) { return isNumeric(f.type) ? '12,345' : f.type === 'date' ? '31 Aug 2026' : '…'; }))
        .concat(st.calcs.map(function () { return 'calculated'; }));
      $('#b-preview', form).innerHTML = '<div class="table-wrap"><table class="table preview-table"><thead><tr>' +
        cols.map(function (c) { return '<th class="' + c.cls + '">' + esc(c.l) + '</th>'; }).join('') + '</tr></thead><tbody><tr>' +
        sample.map(function (v, i) { return '<td class="' + cols[i].cls + '">' + esc(v) + '</td>'; }).join('') + '</tr></tbody></table></div>' +
        '<p class="muted small">Grey: record key. Teal: calculated, never typed.' + (activeFields().some(function (f) { return f.level === 'branch'; }) && hasItems() ? ' * entered once per branch and period.' : '') + '</p>';
    }

    /* ----- save ----- */
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errEl.hidden = true;
      let msg = '';
      const codeRe = /^[A-Z][A-Z0-9_]{0,23}$/;
      const seen = {};
      if (!st.name.trim()) msg = 'Give the report a name.';
      else if (!st.settings.branches.length) msg = 'Choose at least one branch.';
      else if (!activeFields().length) msg = 'Add at least one input field.';
      if (!msg) {
        st.fields.concat(st.calcs).some(function (f) {
          if (f.archived) { seen[f.code] = true; return false; }
          if (!String(f.label || '').trim()) { msg = 'Every field needs a label.'; return true; }
          if (!codeRe.test(f.code)) { msg = 'The code "' + f.code + '" (' + f.label + ') must start with a capital letter and use only A–Z, 0–9 and _.'; return true; }
          if (C.FUNCTIONS[f.code]) { msg = f.code + ' is a function name; choose another code.'; return true; }
          if (seen[f.code]) { msg = 'Two fields use the code ' + f.code + '.'; return true; }
          seen[f.code] = true;
          if (f.type === 'dropdown' && !f.options) { msg = 'Choose the list for the dropdown "' + f.label + '".'; return true; }
          return false;
        });
      }
      if (!msg && !checkCalcs()) msg = 'Fix the formulas marked in red.';
      if (msg) { errEl.textContent = msg; errEl.hidden = false; errEl.scrollIntoView({ block: 'center' }); return; }

      const payload = {
        id: editing ? report.id : undefined,
        name: st.name.trim(), group: st.group.trim(), description: st.description.trim(),
        settings: st.settings,
        fields: st.fields.map(function (f) {
          return { id: f.saved ? f.id : undefined, code: f.code, label: f.label.trim(), type: f.type, level: f.level, required: !!f.required,
            negative: !!f.negative, rollup: f.rollup, options: f.options || '', links: f.links || [], archived: !!f.archived };
        }),
        calcs: st.calcs.map(function (c) { return { id: c.id, code: c.code, label: c.label.trim(), format: c.format, formula: c.formula, where: c.where }; }),
        summaries: st.summaries,
      };
      const btn = $('button[type=submit]', form);
      setBusy(btn, true, editing ? 'Saving…' : 'Creating the sheet…');
      try {
        const saved = await api(editing ? 'reports.update' : 'reports.create', payload);
        clearReportsCache();
        toast(editing ? 'Changes saved.' : 'Report created.');
        location.hash = editing ? '#/reports' : '#/access/' + encodeURIComponent(saved.id);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        setBusy(btn, false);
      }
    });

    renderSettings(); renderFields(); renderCalcs(); renderSummaries(); renderPreview();
    if (!editing) $('#b-name', form).focus();
  }

  function functionHelp() {
    const rows = [
      ['A + B, A - B, A * B, A / B', 'SALES - TARGET', 'Add, difference, multiply, divide'],
      ['PCT(A, B)', 'PCT(SALES, TARGET)', 'A as a % of B (achieved %)'],
      ['GROWTH(A, B)', 'GROWTH(SALES, LY(SALES))', '% change from B to A'],
      ['PREV(A)', 'PREV(SALES)', 'Value in the previous period'],
      ['LY(A)', 'LY(SALES)', 'Same period last year'],
      ['YTD(A)', 'YTD(SALES)', 'Year to date'],
      ['MIN(A, B), MAX(A, B)', 'MAX(TARGET - SALES, 0)', 'Lowest or highest'],
      ['ROUND(A, n)', 'ROUND(VALUE / QTY, 0)', 'Round to n decimals'],
      ['ABS(A)', 'ABS(SALES - TARGET)', 'Without the minus sign'],
      ['IF(test, x, y)', 'IF(SALES >= TARGET, "Met", "Short")', 'Choose by a condition (> < >= <= = <>)'],
      ['LINK("Report", FIELD)', 'LINK("Molex Sales", TARGET)', 'Same period and branch from another report'],
    ];
    return '<details class="help"><summary>Functions you can use</summary><div class="table-wrap"><table class="table compact-table">' +
      '<thead><tr><th>Format</th><th>Example</th><th>Gives</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><code>' + esc(r[0]) + '</code></td><td><code>' + esc(r[1]) + '</code></td><td>' + esc(r[2]) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details>';
  }

  /* =============== Lists =============== */

  async function renderLists(main, ctx) {
    const res = await Promise.all([getLists(true), api('reports.list')]);
    if (!ctx.alive()) return;
    const lists = res[0], reports = res[1];
    const isNew = ctx.params.id === 'new';
    const current = isNew ? { id: '', name: '', items: [], system: false } : (lists.find(function (l) { return l.id === ctx.params.id; }) || lists[0]);
    const savedNames = (current.items || []).map(function (i) { return i.name; });
    const items = (current.items || []).map(function (i) { return { name: i.name, active: i.active !== false, saved: true }; });
    const usedBy = reports.filter(function (r) {
      return r.settings.itemList === current.id || r.fields.some(function (f) { return f.options === current.id; }) || (current.id === 'l_branches');
    });

    main.innerHTML = pageHead('Lists', 'Branches, brands, product lines, models and anything else reports use as items or dropdown options.',
      '<a class="btn btn-primary" href="#/lists/new">New list</a>') +
      '<div class="split-layout">' +
        '<nav class="side-list" aria-label="Lists"><ul>' +
          lists.map(function (l) {
            return '<li><a href="#/lists/' + encodeURIComponent(l.id) + '"' + (!isNew && l.id === current.id ? ' class="active" aria-current="page"' : '') + '>' +
              '<span>' + esc(l.name) + '</span><small>' + l.items.length + ' item' + (l.items.length === 1 ? '' : 's') + '</small></a></li>';
          }).join('') +
        '</ul></nav>' +
        '<form class="panel" id="list-form" novalidate>' +
          '<div class="field"><label for="l-name">List name</label><input id="l-name" maxlength="60"' + (current.system ? ' disabled' : '') + '></div>' +
          (usedBy.length && current.id !== 'l_branches' ? '<p class="muted small">Used by: ' + esc(usedBy.map(function (r) { return r.name; }).join(', ')) + '</p>' : '') +
          '<div class="table-wrap"><table class="table compact-table"><thead><tr><th>Item</th><th>Active</th><th><span class="sr-only">Order</span></th></tr></thead><tbody id="l-items"></tbody></table></div>' +
          '<div class="field"><label for="l-add">Add items <em>one per line</em></label><textarea id="l-add" rows="3" placeholder="New item names"></textarea></div>' +
          '<p class="muted small">Rename updates every report\u2019s saved figures too. Remove deletes the item and, after you confirm, its figures. Untick Active to hide an item from entry but keep its history.</p>' +
          '<p class="form-error" role="alert" hidden></p>' +
          '<div class="form-actions"><button class="btn btn-primary" type="submit">' + (isNew ? 'Create list' : 'Save list') + '</button>' +
            (!isNew && !current.system ? '<button class="btn btn-danger-quiet" type="button" id="l-delete">Delete list</button>' : '') + '</div>' +
        '</form>' +
      '</div>';

    const form = $('#list-form', main);
    $('#l-name', form).value = current.name;
    const tbody = $('#l-items', form);
    function draw() {
      tbody.innerHTML = items.map(function (it, i) {
        return '<tr data-i="' + i + '"><td><input data-k="name" value="' + esc(it.name) + '"' + (it.saved ? ' disabled' : '') + ' maxlength="80"></td>' +
          '<td><input type="checkbox" data-k="active"' + (it.active ? ' checked' : '') + ' aria-label="Active"></td>' +
          '<td class="row-actions"><button type="button" class="icon-btn" data-act="up" aria-label="Move up"' + (i ? '' : ' disabled') + '>\u2191</button>' +
          '<button type="button" class="icon-btn" data-act="down" aria-label="Move down"' + (i < items.length - 1 ? '' : ' disabled') + '>\u2193</button>' +
          (!it.saved ? '<button type="button" class="btn btn-small btn-danger-quiet" data-act="del">Remove</button>'
            : '<button type="button" class="btn btn-small" data-act="rename">Rename</button>' +
               '<button type="button" class="btn btn-small btn-danger-quiet" data-act="remove">Remove</button>') + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="muted">No items yet.</td></tr>';
    }
    draw();
    tbody.addEventListener('input', function (e) {
      const tr = e.target.closest('tr[data-i]');
      if (tr && e.target.dataset.k === 'name') items[Number(tr.dataset.i)].name = e.target.value;
    });
    tbody.addEventListener('change', function (e) {
      const tr = e.target.closest('tr[data-i]');
      if (tr && e.target.dataset.k === 'active') items[Number(tr.dataset.i)].active = e.target.checked;
    });
    function afterListChange(msg) {
      clearListsCache();
      RP.clearReportsCache();
      RP.forgetRecords();
      toast(msg);
      navigate();
    }
    tbody.addEventListener('click', async function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const i = Number(b.closest('tr').dataset.i);
      if (b.dataset.act === 'rename') {
        const oldName = items[i].name;
        const others = lists.filter(function (l) {
          return l.id !== current.id && !l.system && l.items.some(function (x) { return x.name === oldName; });
        });
        const ok = await modal({
          title: 'Rename "' + oldName + '"', submitLabel: 'Rename', busyLabel: 'Renaming…',
          body: '<label class="field"><span>New name</span><input name="to" maxlength="80" value="' + esc(oldName) + '" required></label>' +
            (others.length ? '<fieldset class="field"><legend>Also in other lists</legend>' + others.map(function (l) {
              return '<label class="check"><input type="checkbox" name="also" value="' + esc(l.id) + '" checked>Rename it in ' + esc(l.name) + ' too</label>';
            }).join('') + '<small>Keep these ticked so reports that take figures from each other still match.</small></fieldset>' : '') +
            '<p class="muted small">' + (current.system
              ? 'Every report\u2019s figures, branch settings and people\u2019s access for "' + esc(oldName) + '" move to the new name.'
              : 'Every report\u2019s figures for "' + esc(oldName) + '" move to the new name, including history and links.') + '</p>',
          onSubmit: function (form) {
            const to = form.elements.to.value.trim();
            if (!to) throw new Error('Type the new name.');
            const also = $$('input[name=also]:checked', form).map(function (c) { return c.value; });
            return api('lists.renameItem', { listId: current.id, from: oldName, to: to, alsoListIds: also });
          },
        });
        if (ok) afterListChange('Renamed. ' + (ok.renamed ? ok.renamed + ' saved figure' + (ok.renamed === 1 ? '' : 's') + ' updated.' : ''));
        return;
      }
      if (b.dataset.act === 'remove') {
        const name = items[i].name;
        let res;
        try { res = await api('lists.removeItem', { listId: current.id, name: name }); }
        catch (err) { toast(err.message, 'error'); return; }
        if (res.removed) { afterListChange('"' + name + '" removed.' + (res.accessRemoved ? ' ' + res.accessRemoved + ' access entr' + (res.accessRemoved === 1 ? 'y' : 'ies') + ' that only covered it were removed.' : '')); return; }
        const ok = await confirmAction({
          title: 'Remove "' + name + '" and its figures?',
          message: '"' + name + '" has ' + res.rows + ' saved row' + (res.rows === 1 ? '' : 's') + ' of figures in: ' + res.reports.join(', ') +
            '. Removing it deletes those figures permanently' + (current.system ? ', takes it out of every report and removes it from people\u2019s access' : '') +
            (current.system ? '. To stop using it but keep its history, untick it under Branches in each report\u2019s Edit page instead.'
              : '. To hide it from entry but keep history, untick Active instead.'),
          confirmLabel: 'Remove and delete figures', busyLabel: 'Removing…', danger: true, typeToConfirm: name,
          action: function () { return api('lists.removeItem', { listId: current.id, name: name, deleteData: true }); },
        });
        if (ok) afterListChange('"' + name + '" and its figures removed.');
        return;
      }
      if (b.dataset.act === 'del') items.splice(i, 1);
      else {
        const j = b.dataset.act === 'up' ? i - 1 : i + 1;
        const t = items[i]; items[i] = items[j]; items[j] = t;
      }
      draw();
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = $('.form-error', form);
      errEl.hidden = true;
      const extra = $('#l-add', form).value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      const all = items.concat(extra.map(function (n) { return { name: n, active: true }; }));
      const btn = $('button[type=submit]', form);
      setBusy(btn, true, 'Saving…');
      try {
        const saved = await api('lists.save', { id: current.id || undefined, name: $('#l-name', form).value, items: all.map(function (i) { return { name: i.name, active: i.active }; }) });
        clearListsCache();
        toast('List saved.');
        if (isNew) location.hash = '#/lists/' + encodeURIComponent(saved.id); else navigate();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        setBusy(btn, false);
      }
    });
    const del = $('#l-delete', form);
    if (del) del.addEventListener('click', async function () {
      const ok = await confirmAction({
        title: 'Delete "' + current.name + '"?', message: 'Lists used by a report can\u2019t be deleted.',
        confirmLabel: 'Delete list', danger: true, action: function () { return api('lists.delete', { id: current.id }); },
      });
      if (ok) { clearListsCache(); toast('List deleted.'); location.hash = '#/lists'; }
    });
    void savedNames;
  }
  route('/lists', ['superadmin'], 'lists', renderLists);
  route('/lists/:id', ['superadmin'], 'lists', renderLists);

  /* =============== Report access =============== */

  async function renderAccess(main, ctx) {
    const res = await Promise.all([api('reports.list'), api('users.list'), api('access.all')]);
    if (!ctx.alive()) return;
    const reports = res[0], users = res[1], access = res[2];
    if (!reports.length) {
      main.innerHTML = pageHead('Report access') + emptyState('No reports yet', 'Create a report first, then choose who can use it here.', '<a class="btn btn-primary" href="#/reports/new">New report</a>');
      return;
    }
    const report = reports.find(function (r) { return r.id === ctx.params.id; }) || reports[0];
    const rows = access.filter(function (a) { return a.reportId === report.id; })
      .map(function (a) { return { a: a, u: users.find(function (u) { return u.id === a.userId; }) }; })
      .filter(function (x) { return x.u; })
      .sort(function (x, y) { return x.u.name.localeCompare(y.u.name); });
    const branches = report.settings.branches;
    const single = branches.length === 1;

    main.innerHTML = pageHead('Report access', 'Users enter data and admins view reports, for the branches you choose. Super admins always have full access.') +
      '<div class="split-layout">' +
        '<nav class="side-list" aria-label="Reports"><ul>' +
          reports.map(function (r) {
            const n = access.filter(function (a) { return a.reportId === r.id; }).length;
            return '<li><a href="#/access/' + encodeURIComponent(r.id) + '"' + (r.id === report.id ? ' aria-current="page" class="active"' : '') + '>' +
              '<span>' + esc(r.name) + '</span><small>' + n + ' ' + (n === 1 ? 'person' : 'people') + '</small></a></li>';
          }).join('') +
        '</ul></nav>' +
        '<section class="panel">' +
          '<div class="panel-head"><div><h2>' + esc(report.name) + '</h2><p class="muted small">' + esc(branches.join(', ')) + '</p></div>' +
          '<button class="btn btn-primary" type="button" id="grant">Give access</button></div>' +
          (rows.length
            ? '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Person</th><th scope="col">Can</th>' + (single ? '' : '<th scope="col">Branches</th>') + '<th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
              rows.map(function (x) {
                return '<tr' + (x.u.status !== 'active' ? ' class="is-muted"' : '') + '><td><strong>' + esc(x.u.name) + '</strong><div class="muted small">' + esc(x.u.username) + '</div></td>' +
                  '<td><span class="role role-' + esc(x.u.role) + '">' + (x.u.role === 'admin' ? 'View reports' : 'Enter data') + '</span></td>' +
                  (single ? '' : '<td>' + (x.a.branches === '*' ? 'All branches' : '<div class="chips">' + x.a.branches.map(function (b) { return '<span class="chip">' + esc(b) + '</span>'; }).join('') + '</div>') + '</td>') +
                  '<td class="row-actions">' + (single ? '' : '<button class="btn btn-small" type="button" data-edit="' + esc(x.u.id) + '">Change branches</button>') +
                  '<button class="btn btn-small btn-danger-quiet" type="button" data-revoke="' + esc(x.u.id) + '">Remove</button></td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<div class="empty compact"><p>Nobody has access to this report yet.</p></div>') +
        '</section></div>';

    function scopeFields(current) {
      if (single) return '';
      const all = !current || current === '*';
      return '<fieldset class="field"><legend>Branches</legend>' +
        '<label class="radio"><input type="radio" name="scope" value="all"' + (all ? ' checked' : '') + '> All branches of this report</label>' +
        '<label class="radio"><input type="radio" name="scope" value="some"' + (all ? '' : ' checked') + '> Only these branches</label>' +
        '<div class="tab-checks"' + (all ? ' hidden' : '') + '>' +
          branches.map(function (b) { return '<label class="check"><input type="checkbox" name="branch" value="' + esc(b) + '"' + (!all && current.indexOf(b) !== -1 ? ' checked' : '') + '>' + esc(b) + '</label>'; }).join('') +
        '</div></fieldset>';
    }
    function wireScope(form) {
      $$('input[name=scope]', form).forEach(function (r) {
        r.addEventListener('change', function () { $('.tab-checks', form).hidden = form.querySelector('input[name=scope]:checked').value === 'all'; });
      });
    }
    function readScope(form) {
      if (single || form.querySelector('input[name=scope]:checked').value === 'all') return '*';
      const picked = $$('input[name=branch]:checked', form).map(function (c) { return c.value; });
      if (!picked.length) throw new Error('Choose at least one branch.');
      return picked;
    }

    $('#grant', main).addEventListener('click', async function () {
      const eligible = users.filter(function (u) { return u.role !== 'superadmin' && u.status === 'active' && !rows.some(function (x) { return x.u.id === u.id; }); });
      if (!eligible.length) {
        await modal({ title: 'No one to add', body: '<p>Every active user and admin already has access. Add more people on the Users page.</p>', cancelLabel: 'Close' });
        return;
      }
      const ok = await modal({
        title: 'Give access to ' + report.name, submitLabel: 'Give access', busyLabel: 'Saving…',
        body: '<label class="field"><span>Person</span><select name="user">' + eligible.map(function (u) {
          return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(u.username) + '), ' + (u.role === 'admin' ? 'views reports' : 'enters data') + '</option>';
        }).join('') + '</select></label>' + scopeFields(null),
        onOpen: single ? null : wireScope,
        onSubmit: function (form) { return api('access.set', { reportId: report.id, userId: form.elements.user.value, branches: readScope(form) }); },
      });
      if (ok) { toast('Access given.'); navigate(); }
    });

    main.addEventListener('click', async function (e) {
      const edit = e.target.closest('[data-edit]');
      const revoke = e.target.closest('[data-revoke]');
      if (!edit && !revoke) return;
      const x = rows.find(function (r) { return r.u.id === (edit || revoke).dataset[edit ? 'edit' : 'revoke']; });
      if (edit) {
        const ok = await modal({
          title: 'Branches for ' + x.u.name, submitLabel: 'Save changes', busyLabel: 'Saving…', body: scopeFields(x.a.branches), onOpen: wireScope,
          onSubmit: function (form) { return api('access.set', { reportId: report.id, userId: x.u.id, branches: readScope(form) }); },
        });
        if (ok) { toast('Changes saved.'); navigate(); }
      } else {
        const ok = await confirmAction({
          title: 'Remove ' + x.u.name + '?', message: x.u.name + ' will no longer see "' + report.name + '". Data already entered stays.',
          confirmLabel: 'Remove access', danger: true, action: function () { return api('access.revoke', { reportId: report.id, userId: x.u.id }); },
        });
        if (ok) { toast('Access removed.'); navigate(); }
      }
    });
  }
  route('/access', ['superadmin'], 'access', renderAccess);
  route('/access/:id', ['superadmin'], 'access', renderAccess);

  /* =============== Status: what is entered, and month locks =============== */

  function lastMonth() {
    const d = new Date();
    return C.monthAdd(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), -1);
  }
  function monthPicker(id, value) {
    const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7));
    const years = [];
    for (let k = new Date().getFullYear() + 1; k >= 2018; k--) years.push(k);
    return '<div class="month-picker" id="' + id + '">' +
      '<select data-part="m" aria-label="Month">' + MONTHS.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
      '<select data-part="y" aria-label="Year">' + years.map(function (k) { return '<option' + (k === y ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>';
  }
  function readMonthPicker(el) {
    return $('[data-part=y]', el).value + '-' + String($('[data-part=m]', el).value).padStart(2, '0');
  }
  RP.monthPicker = monthPicker;
  RP.readMonthPicker = readMonthPicker;

  route('/status', ['superadmin'], 'status', async function (main, ctx) {
    const period = sessionStorage.getItem('rp_status_month') || lastMonth();
    const res = await Promise.all([api('status.get', { period: period }), api('locks.list'), getLists()]);
    if (!ctx.alive()) return;
    const status = res[0], locks = res[1];
    const branchList = (res[2].find(function (l) { return l.id === 'l_branches'; }) || { items: [] }).items.map(function (i) { return i.name; });
    const locked = locks.some(function (l) { return l.period === period; });
    let expected = 0, done = 0;
    status.forEach(function (r) { expected += r.branches.length; done += (r.entered || []).length; });

    main.innerHTML = pageHead('Status', 'Which reports and branches have data for a month, and which months are locked.') +
      '<section class="panel"><div class="status-bar">' + monthPicker('st-month', period) +
        '<p class="status-sum"><strong>' + done + ' of ' + expected + '</strong> report and branch combinations entered for ' + esc(C.monthLabel(period)) + '.</p>' +
        '<button class="btn ' + (locked ? '' : 'btn-primary') + '" type="button" id="st-lock">' + (locked ? 'Unlock ' : 'Lock ') + esc(C.monthLabel(period)) + '</button>' +
      '</div>' + (locked ? '<p class="notice">' + esc(C.monthLabel(period)) + ' is locked: figures can be viewed but not changed.</p>' : '') + '</section>' +
      '<div class="table-wrap panel-flush"><table class="table status-table"><thead><tr><th scope="col">Report</th>' +
        branchList.map(function (b) { return '<th scope="col" class="c">' + esc(b) + '</th>'; }).join('') + '<th scope="col" class="num">Done</th></tr></thead><tbody>' +
        status.map(function (r) {
          return '<tr><td><a href="#/entry/' + encodeURIComponent(r.id) + '">' + esc(r.name) + '</a></td>' +
            branchList.map(function (b) {
              if (r.branches.indexOf(b) === -1) return '<td class="c muted" aria-label="Not in this report">—</td>';
              if (r.entered === null) return '<td class="c bad">Sheet error</td>';
              return r.entered.indexOf(b) !== -1 ? '<td class="c ok">Entered</td>' : '<td class="c missing">Missing</td>';
            }).join('') + '<td class="num">' + (r.entered || []).length + '/' + r.branches.length + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      (locks.length ? '<section class="panel"><h2>Locked months</h2><div class="chips">' + locks.map(function (l) {
        return '<span class="chip">' + esc(C.monthLabel(l.period)) + '</span>'; }).join('') + '</div></section>' : '');

    $$('#st-month select', main).forEach(function (s) {
      s.addEventListener('change', function () { sessionStorage.setItem('rp_status_month', readMonthPicker($('#st-month', main))); navigate(); });
    });
    $('#st-lock', main).addEventListener('click', async function () {
      const ok = await confirmAction({
        title: (locked ? 'Unlock ' : 'Lock ') + C.monthLabel(period) + '?',
        message: locked ? 'Figures for this month can be changed again.' : 'Nobody can change figures for this month in any report until it is unlocked.',
        confirmLabel: locked ? 'Unlock' : 'Lock month',
        action: function () { return api('locks.set', { period: period, locked: !locked }); },
      });
      if (ok) { toast(locked ? 'Month unlocked.' : 'Month locked.'); navigate(); }
    });
  });

  /* =============== Users =============== */

  function roleRadios(current, disabled) {
    return '<fieldset class="field"><legend>Role</legend><div class="role-options">' +
      ['user', 'admin', 'superadmin'].map(function (r) {
        return '<label class="role-option"><input type="radio" name="role" value="' + r + '"' + (current === r ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
          '<span><strong>' + esc(ROLE_LABEL[r]) + '</strong><small>' + esc(ROLE_HELP[r]) + '</small></span></label>';
      }).join('') + '</div></fieldset>';
  }

  function passwordField(label, help) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<div class="input-row"><input name="password" required minlength="8" autocomplete="new-password" spellcheck="false">' +
      '<button type="button" class="btn btn-small" data-gen>Generate</button></div>' +
      '<small>' + esc(help) + '</small></label>';
  }

  function wireGenerate(form) {
    form.elements.password.value = randomPassword();
    $('[data-gen]', form).addEventListener('click', function () { form.elements.password.value = randomPassword(); });
  }

  route('/users', ['superadmin'], 'users', async function (main, ctx) {
    const results = await Promise.all([api('users.list'), api('access.all')]);
    if (!ctx.alive()) return;
    const users = results[0];
    const access = results[1];

    const counts = {};
    access.forEach(function (a) { counts[a.userId] = (counts[a.userId] || 0) + 1; });

    main.innerHTML = pageHead('Users', 'People who can sign in, and what their role lets them do.',
      '<button class="btn btn-primary" type="button" id="add-user">Add user</button>') +
      '<div class="table-wrap panel-flush"><table class="table">' +
        '<thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col" class="num">Reports</th><th scope="col">Added</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>' +
        '<tbody>' + users.map(function (u) {
          const self = u.id === state.user.id;
          return '<tr' + (u.status !== 'active' ? ' class="is-muted"' : '') + '>' +
            '<td><strong>' + esc(u.name) + '</strong>' + (self ? ' <span class="tag">You</span>' : '') + '<div class="muted small">' + esc(u.username) + '</div></td>' +
            '<td><span class="role role-' + esc(u.role) + '">' + esc(ROLE_LABEL[u.role]) + '</span></td>' +
            '<td>' + (u.status === 'active' ? 'Active' : 'Disabled') + '</td>' +
            '<td class="num">' + (u.role === 'superadmin' ? 'All' : (counts[u.id] || 0)) + '</td>' +
            '<td>' + esc(fmtDateTime(u.createdAt)) + '</td>' +
            '<td class="row-actions">' +
              '<button class="btn btn-small" type="button" data-edit="' + esc(u.id) + '">Edit</button>' +
              '<button class="btn btn-small" type="button" data-reset="' + esc(u.id) + '">Reset password</button>' +
              (self ? '' : '<button class="btn btn-small btn-danger-quiet" type="button" data-remove="' + esc(u.id) + '">Delete</button>') +
            '</td></tr>';
        }).join('') + '</tbody></table></div>';

    $('#add-user', main).addEventListener('click', async function () {
      const created = await modal({
        title: 'Add user',
        submitLabel: 'Add user', busyLabel: 'Adding…',
        body:
          '<label class="field"><span>Full name</span><input name="name" maxlength="80" required></label>' +
          '<label class="field"><span>Username</span><input name="username" maxlength="32" required autocapitalize="none" spellcheck="false" autocomplete="off">' +
            '<small>3 to 32 characters. Starts with a letter; letters, numbers, dots, dashes and underscores only.</small></label>' +
          roleRadios('user', false) +
          passwordField('Temporary password', 'Share it with the person privately. They can change it under Your account.'),
        onOpen: wireGenerate,
        onSubmit: async function (form) {
          const f = form.elements;
          const role = (form.querySelector('input[name=role]:checked') || {}).value;
          if (!f.name.value.trim() || !f.username.value.trim()) throw new Error('Enter a name and a username.');
          if (f.password.value.length < 8) throw new Error('The password must be at least 8 characters.');
          const user = await api('users.create', { name: f.name.value, username: f.username.value, role: role, password: f.password.value });
          return { user: user, password: f.password.value };
        },
      });
      if (!created) return;
      await modal({
        title: 'User added',
        body: '<p>Send these sign-in details to ' + esc(created.user.name) + ' privately. The password is not shown again.</p>' +
          '<dl class="facts"><dt>Username</dt><dd><code>' + esc(created.user.username) + '</code></dd>' +
          '<dt>Password</dt><dd><code>' + esc(created.password) + '</code></dd></dl>' +
          (created.user.role !== 'superadmin' ? '<p class="muted small">Next, give them access to reports on the Report access page.</p>' : ''),
        cancelLabel: 'Done',
      });
      navigate();
    });

    main.addEventListener('click', async function (e) {
      const editBtn = e.target.closest('[data-edit]');
      const resetBtn = e.target.closest('[data-reset]');
      const removeBtn = e.target.closest('[data-remove]');
      const id = (editBtn || resetBtn || removeBtn || {}).dataset;
      if (!id) return;
      const u = users.find(function (x) { return x.id === (id.edit || id.reset || id.remove); });
      const self = u.id === state.user.id;

      if (editBtn) {
        const saved = await modal({
          title: 'Edit ' + u.name,
          submitLabel: 'Save changes', busyLabel: 'Saving…',
          body:
            '<label class="field"><span>Full name</span><input name="name" maxlength="80" required value="' + esc(u.name) + '"></label>' +
            '<label class="field"><span>Username</span><input value="' + esc(u.username) + '" disabled><small>Usernames can\u2019t be changed.</small></label>' +
            roleRadios(u.role, self) +
            '<label class="field"><span>Status</span><select name="status"' + (self ? ' disabled' : '') + '>' +
              '<option value="active"' + (u.status === 'active' ? ' selected' : '') + '>Active: can sign in</option>' +
              '<option value="disabled"' + (u.status !== 'active' ? ' selected' : '') + '>Disabled: cannot sign in</option>' +
            '</select>' + (self ? '<small>You can\u2019t change your own role or status.</small>' : '') + '</label>',
          onSubmit: function (form) {
            const payload = { id: u.id, name: form.elements.name.value };
            if (!self) {
              payload.role = form.querySelector('input[name=role]:checked').value;
              payload.status = form.elements.status.value;
            }
            return api('users.update', payload);
          },
        });
        if (saved) {
          toast('Changes saved.');
          if (self) { state.user.name = saved.name; $('#app').innerHTML = ''; }
          navigate();
        }
      }

      if (resetBtn) {
        const pw = await modal({
          title: 'Reset password for ' + u.name,
          submitLabel: 'Reset password', busyLabel: 'Resetting…',
          body: passwordField('New password', 'They will be signed out everywhere and must use this password next time.'),
          onOpen: wireGenerate,
          onSubmit: async function (form) {
            if (form.elements.password.value.length < 8) throw new Error('The password must be at least 8 characters.');
            await api('users.update', { id: u.id, password: form.elements.password.value });
            return form.elements.password.value;
          },
        });
        if (pw) {
          if (self) { toast('Password reset. Sign in again with the new password.'); RP.signOut(); return; }
          await modal({
            title: 'Password reset',
            body: '<p>Send the new password to ' + esc(u.name) + ' privately. It is not shown again.</p><dl class="facts"><dt>Password</dt><dd><code>' + esc(pw) + '</code></dd></dl>',
            cancelLabel: 'Done',
          });
        }
      }

      if (removeBtn) {
        const ok = await confirmAction({
          title: 'Delete ' + u.name + '?',
          message: 'They can no longer sign in and lose access to all reports. Entries they already made stay in the sheets.',
          confirmLabel: 'Delete user', busyLabel: 'Deleting…', danger: true, typeToConfirm: u.username,
          action: function () { return api('users.delete', { id: u.id }); },
        });
        if (ok) { toast('User deleted.'); navigate(); }
      }
    });
  });


  /* =============== Activity log =============== */

  const ACTION_LABEL = {
    'auth.login': 'Signed in', 'auth.changePassword': 'Changed own password',
    'users.create': 'Added a user', 'users.update': 'Changed a user', 'users.delete': 'Deleted a user',
    'lists.save': 'Saved a list', 'lists.delete': 'Deleted a list',
    'lists.renameItem': 'Renamed a list item', 'lists.removeItem': 'Removed a list item',
    'reports.create': 'Created a report', 'reports.update': 'Edited a report', 'reports.delete': 'Deleted a report',
    'access.set': 'Gave or changed access', 'access.revoke': 'Removed access',
    'records.save': 'Saved figures', 'records.import': 'Imported figures',
    'locks.lock': 'Locked a month', 'locks.unlock': 'Unlocked a month',
  };

  function describe(details) {
    if (!details) return '';
    try {
      const d = JSON.parse(details);
      return Object.keys(d).map(function (k) {
        let v = d[k];
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
          v = v.map(function (c) { return [c.p, c.b, c.i, c.f].filter(Boolean).join(' ') + ': ' + (c.old === '' ? 'blank' : c.old) + ' → ' + (c.new === '' ? 'blank' : c.new); }).join('; ');
        } else if (Array.isArray(v)) v = v.join(', ') || 'none';
        else if (v && typeof v === 'object') v = Object.keys(v).map(function (kk) { return kk + ' ' + v[kk]; }).join(', ');
        else if (v === '*') v = 'all tabs';
        return k + ': ' + v;
      }).join('; ');
    } catch (e) { return details; }
  }

  route('/activity', ['superadmin'], 'activity', async function (main, ctx) {
    const items = await api('audit.list');
    if (!ctx.alive()) return;
    main.innerHTML = pageHead('Activity log', 'The latest 300 actions, newest first. Saved figures show the first changes with old and new values.') +
      (items.length
        ? '<div class="table-wrap panel-flush"><table class="table">' +
            '<thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Details</th></tr></thead>' +
            '<tbody>' + items.map(function (i) {
              return '<tr><td class="nowrap">' + esc(fmtDateTime(i.at)) + '</td><td>' + esc(i.user) + '</td><td>' + esc(ACTION_LABEL[i.action] || i.action) + '</td><td class="muted small">' + esc(describe(i.details)) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
        : emptyState('No activity yet', 'Sign-ins and changes to users, reports and access will appear here.'));
  });
})();
