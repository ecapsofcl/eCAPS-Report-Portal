/* Report Portal - data entry, report views and import */
(function () {
  'use strict';
  const { api, esc, $, $$, toast, modal, setBusy, route, state, pageHead, emptyState, getLists, reportMeta, MONTHS } = RP;
  const C = window.RPCalc;
  const isNumeric = function (t) { return C.NUMERIC.indexOf(t) !== -1; };
  const PALETTE = ['#0C6B65', '#E2A01B', '#4F6A8F', '#B0392A', '#6E8B3D', '#8A5A83', '#2A9D8F', '#C9772C', '#3D4F58', '#D4B24C'];
  const RUPEES = { unit: 'rupees', decimals: 2 };

  function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function remember(key, obj) { try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* ignore */ } }
  function recall(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function unitHeader(f) { return f.type === 'amount' ? ' (₹)' : f.type === 'percent' ? ' (%)' : ''; }
  function loadingHtml() { return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Loading…</div>'; }
  function fileName(name) { return name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-'); }

  function reportPicker(reports, base, title, sub, lists) {
    if (!reports.length) {
      return pageHead(title) + emptyState('No reports yet', state.user.role === 'superadmin'
        ? 'Create a report on the Reports page first.' : 'Your super admin hasn\u2019t given you access to a report yet.');
    }
    const groups = {};
    reports.forEach(function (r) { (groups[r.group || 'Other'] = groups[r.group || 'Other'] || []).push(r); });
    return pageHead(title, sub) + Object.keys(groups).sort().map(function (g) {
      return '<section class="report-group"><h2>' + esc(g) + '</h2><ul class="report-list">' + groups[g].map(function (r) {
        return '<li><a href="#/' + base + '/' + encodeURIComponent(r.id) + '"><span class="rl-name">' + esc(r.name) + '</span>' +
          (r.description ? '<span class="rl-desc">' + esc(r.description) + '</span>' : '') +
          '<span class="rl-tabs">' + esc(reportMeta(r, lists) + '. ' + r.branches.join(', ')) + '</span></a></li>';
      }).join('') + '</ul></section>';
    }).join('');
  }

  /* ======================================================================
     ENTER DATA
     ====================================================================== */

  route('/entry', ['superadmin', 'user'], 'entry', async function (main, ctx) {
    const res = await Promise.all([api('reports.list'), getLists()]);
    if (!ctx.alive()) return;
    main.innerHTML = reportPicker(res[0], 'entry', 'Enter data', 'Choose a report. Then pick the period and branch; saved figures appear ready to edit.', res[1]);
  });

  route('/entry/:id', ['superadmin', 'user'], 'entry', async function (main, ctx) {
    const res = await Promise.all([getLists(), api('reports.list')]);
    if (!ctx.alive()) return;
    const lists = res[0], reports = res[1];
    const report = reports.find(function (r) { return r.id === ctx.params.id; });
    if (!report) { main.innerHTML = emptyState('Report not available', 'It may have been deleted, or you no longer have access.', '<a class="btn" href="#/entry">All reports</a>'); return; }

    const isDate = report.settings.periodType === 'date';
    const key = 'rp_entry_' + report.id;
    const saved = recall(key) || {};
    const sel = {
      period: saved.period || (isDate ? isoDate(new Date()) : C.monthAdd(thisMonth(), -1)),
      branch: saved.branch && (saved.branch === '__all' || report.branches.indexOf(saved.branch) !== -1) ? saved.branch : report.branches[0],
      field: saved.field || '',
    };
    let ds = null, locks = [], originals = {};

    main.innerHTML = pageHead(report.name, reportMeta(report, lists),
      (state.user.role === 'superadmin' ? '<a class="btn btn-quiet" href="#/view/' + encodeURIComponent(report.id) + '">View report</a>' +
        '<a class="btn btn-quiet" href="#/import/' + encodeURIComponent(report.id) + '">Import</a>' : '')) +
      '<section class="panel selector-bar" id="en-sel"></section><div id="en-body">' + loadingHtml() + '</div>';

    RP.setLeaveGuard(function () { return dirtyCount() > 0; });

    async function load() {
      const m = sel.period.slice(0, 7);
      $('#en-body', main).innerHTML = loadingHtml();
      const data = await api('records.get', { reportId: report.id, from: C.monthAdd(m, -13), to: isDate ? sel.period : m });
      if (!ctx.alive()) return;
      ds = new C.Dataset(data.report, data.records, lists, data.linked);
      locks = data.locks;
      renderSelectors();
      renderGrid();
    }

    function inputFields() { return report.fields.filter(function (f) { return !f.archived; }); }
    function itemFields() { return inputFields().filter(function (f) { return !ds.hasItems || f.level !== 'branch'; }); }
    function branchFields() { return ds.hasItems ? inputFields().filter(function (f) { return f.level === 'branch'; }) : []; }
    function isLocked() { return locks.indexOf(sel.period.slice(0, 7)) !== -1; }

    /* ----- selectors ----- */
    function renderSelectors() {
      const bar = $('#en-sel', main);
      const recentDates = isDate && ds ? ds.periods.slice(-6).reverse() : [];
      bar.innerHTML =
        '<div class="field"><label for="en-report">Report</label><select id="en-report">' + reports.map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (r.id === report.id ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><span class="label">' + (isDate ? 'Date' : 'Month') + '</span><div class="with-steps">' +
          '<button type="button" class="icon-btn" data-step="-1" aria-label="Previous period">\u2039</button>' +
          (isDate ? '<input type="date" id="en-date" aria-label="Date" value="' + esc(sel.period) + '">' : RP.monthPicker('en-month', sel.period)) +
          '<button type="button" class="icon-btn" data-step="1" aria-label="Next period">\u203A</button></div>' +
          (recentDates.length ? '<small>Recent: ' + recentDates.map(function (d) { return '<a href="#" data-date="' + esc(d) + '">' + esc(C.dateLabel(d)) + '</a>'; }).join(', ') + '</small>' : '') +
        '</div>' +
        '<div class="field"><label for="en-branch">Branch</label><div class="with-steps">' +
          '<button type="button" class="icon-btn" data-bstep="-1" aria-label="Previous branch"' + (sel.branch === '__all' ? ' disabled' : '') + '>\u2039</button>' +
          '<select id="en-branch">' + report.branches.map(function (b) { return '<option' + (sel.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
            (report.branches.length > 1 ? '<option value="__all"' + (sel.branch === '__all' ? ' selected' : '') + '>All branches</option>' : '') + '</select>' +
          '<button type="button" class="icon-btn" data-bstep="1" aria-label="Next branch"' + (sel.branch === '__all' ? ' disabled' : '') + '>\u203A</button></div></div>' +
        (sel.branch === '__all' && ds && ds.hasItems ? '<div class="field"><label for="en-field">Field</label><select id="en-field">' + itemFields().map(function (f) {
          return '<option value="' + esc(f.code) + '"' + (sel.field === f.code ? ' selected' : '') + '>' + esc(f.label) + '</option>'; }).join('') + '</select></div>' : '');

      $('#en-report', bar).addEventListener('change', function (e) { location.hash = '#/entry/' + encodeURIComponent(e.target.value); });
      if (isDate) {
        $('#en-date', bar).addEventListener('change', function (e) { if (e.target.value) change({ period: e.target.value }); });
        $$('[data-date]', bar).forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); change({ period: a.dataset.date }); }); });
      } else {
        $$('#en-month select', bar).forEach(function (x) { x.addEventListener('change', function () { change({ period: RP.readMonthPicker($('#en-month', bar)) }); }); });
      }
      $$('[data-step]', bar).forEach(function (b) {
        b.addEventListener('click', function () {
          const n = Number(b.dataset.step);
          if (!isDate) { change({ period: C.monthAdd(sel.period, n) }); return; }
          const d = new Date(sel.period + 'T00:00:00');
          d.setDate(d.getDate() + n);
          change({ period: isoDate(d) });
        });
      });
      $('#en-branch', bar).addEventListener('change', function (e) { change({ branch: e.target.value }); });
      $$('[data-bstep]', bar).forEach(function (b) {
        b.addEventListener('click', function () {
          const i = report.branches.indexOf(sel.branch) + Number(b.dataset.bstep);
          if (i >= 0 && i < report.branches.length) change({ branch: report.branches[i] });
        });
      });
      const fs = $('#en-field', bar);
      if (fs) fs.addEventListener('change', function (e) { change({ field: e.target.value }); });
    }

    function change(patch) {
      if (dirtyCount() && !window.confirm('You have unsaved changes. Discard them?')) { renderSelectors(); return; }
      const periodChanged = patch.period && patch.period !== sel.period;
      Object.assign(sel, patch);
      remember(key, sel);
      if (periodChanged) load(); else { renderSelectors(); renderGrid(); }
    }

    /* ----- grid ----- */
    function linkInfo(f, b, item) {
      const link = ds.linkFor(f, item);
      if (!link) return null;
      const src = ds.linked[link.reportId];
      const live = !!(src && src.hasAny(sel.period, b));
      return { name: src ? src.report.name : 'another report', live: live, value: live ? ds.effective(f, sel.period, b, item) : null };
    }

    function cellHtml(f, b, item) {
      const k = b + '|' + item + '|' + f.code;
      const li = linkInfo(f, b, item);
      if (li && li.live) {
        return '<td class="num linked" title="From ' + esc(li.name) + '">' + esc(C.formatValue(li.value, f.type, RUPEES) || '0') +
          '<span class="link-tag">from ' + esc(li.name) + '</span></td>';
      }
      const v = ds.raw(sel.period, b, item, f.code);
      const val = v === null ? '' : String(v);
      originals[k] = val;
      const common = ' data-k="' + esc(k) + '" data-b="' + esc(b) + '" data-i="' + esc(item) + '" data-c="' + esc(f.code) + '"' + (isLocked() ? ' disabled' : '') +
        ' aria-label="' + esc(f.label + (item ? ', ' + item : '') + ', ' + b) + '"';
      let control;
      if (f.type === 'dropdown' || f.type === 'yesno') {
        const opts = f.type === 'yesno' ? ['Yes', 'No'] : ((lists.find(function (l) { return l.id === f.options; }) || { items: [] }).items.map(function (x) { return x.name; }));
        control = '<select' + common + '><option value=""></option>' + opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      } else if (f.type === 'date') {
        control = '<input type="date"' + common + ' value="' + esc(val) + '">';
      } else {
        control = '<input type="text" autocomplete="off"' + (isNumeric(f.type) ? ' inputmode="decimal" class="num-input"' : '') + common + ' value="' + esc(val) + '"' +
          (li ? ' placeholder="or from ' + esc(li.name) + '"' : '') + '>';
      }
      return '<td class="' + (isNumeric(f.type) ? 'num' : '') + '">' + control + '</td>';
    }

    function visibleItems(branches) {
      return ds.items.filter(function (it) {
        if (it.active !== false) return true;
        return branches.some(function (b) { return inputFields().some(function (f) { return ds.raw(sel.period, b, it.name, f.code) !== null; }); });
      }).map(function (it) { return it.name; });
    }

    function th(f) {
      return '<th scope="col" class="' + (isNumeric(f.type) ? 'num' : '') + '">' + esc(f.label + unitHeader(f)) + (f.required ? ' <span class="req" aria-label="required">*</span>' : '') + '</th>';
    }

    function renderGrid() {
      originals = {};
      const body = $('#en-body', main);
      const plabel = C.periodLabel(sel.period);
      const calcs = report.calcs;
      let html = isLocked() ? '<p class="notice">' + esc(C.monthLabel(sel.period.slice(0, 7))) + ' is locked. Figures can be viewed but not changed.</p>' : '';

      if (sel.branch !== '__all') {
        const b = sel.branch;
        const bf = branchFields();
        if (bf.length) {
          html += '<section class="panel"><h2>Once for ' + esc(b) + ', ' + esc(plabel) + '</h2><div class="table-wrap"><table class="table entry-table"><thead><tr>' +
            bf.map(th).join('') + '</tr></thead><tbody><tr>' + bf.map(function (f) { return cellHtml(f, b, ''); }).join('') + '</tr></tbody></table></div></section>';
        }
        const fields = itemFields();
        const rowCalcs = calcs.filter(function (c) { return c.where !== 'totals' || !ds.hasItems; });
        const items = ds.hasItems ? visibleItems([b]) : [''];
        html += '<section class="panel"><h2>' + esc(b) + ', ' + esc(plabel) + '</h2><div class="table-wrap"><table class="table entry-table" id="grid"><thead><tr>' +
          (ds.hasItems ? '<th scope="col">Item</th>' : '') + fields.map(th).join('') +
          rowCalcs.map(function (c) { return '<th scope="col" class="num calc-col">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          items.map(function (it) {
            return '<tr>' + (ds.hasItems ? '<th scope="row">' + esc(it) + '</th>' : '') +
              fields.map(function (f) { return cellHtml(f, b, it); }).join('') +
              rowCalcs.map(function (c) { return '<td class="num calc-col" data-calc="' + esc(c.code) + '" data-ci="' + esc(it) + '"></td>'; }).join('') + '</tr>';
          }).join('') + '</tbody>' +
          (ds.hasItems ? '<tfoot><tr><th scope="row">Total</th>' + fields.map(function (f) { return '<td class="num" data-total="' + esc(f.code) + '"></td>'; }).join('') +
            rowCalcs.map(function (c) { return '<td class="num calc-col" data-calc="' + esc(c.code) + '" data-ci="__total"></td>'; }).join('') + '</tr></tfoot>' : '') +
          '</table></div>' +
          (ds.hasItems && calcs.some(function (c) { return c.where === 'totals'; }) ? '<p class="calc-note" id="tot-calcs"></p>' : '') +
          '</section>';
      } else if (!ds.hasItems) {
        const fields = inputFields();
        html += '<section class="panel"><h2>All branches, ' + esc(plabel) + '</h2><div class="table-wrap"><table class="table entry-table" id="grid"><thead><tr><th scope="col">Field</th>' +
          report.branches.map(function (b) { return '<th scope="col" class="num">' + esc(b) + '</th>'; }).join('') + '<th scope="col" class="num">Total</th></tr></thead><tbody>' +
          fields.map(function (f) {
            return '<tr><th scope="row">' + esc(f.label + unitHeader(f)) + '</th>' + report.branches.map(function (b) { return cellHtml(f, b, ''); }).join('') +
              '<td class="num" data-rowtotal="' + esc(f.code) + '"></td></tr>';
          }).join('') + '</tbody></table></div></section>';
      } else {
        const bf = branchFields();
        if (bf.length) {
          html += '<section class="panel"><h2>Once per branch, ' + esc(plabel) + '</h2><div class="table-wrap"><table class="table entry-table"><thead><tr><th scope="col">Field</th>' +
            report.branches.map(function (b) { return '<th scope="col" class="num">' + esc(b) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            bf.map(function (f) { return '<tr><th scope="row">' + esc(f.label + unitHeader(f)) + '</th>' + report.branches.map(function (b) { return cellHtml(f, b, ''); }).join('') + '</tr>'; }).join('') +
            '</tbody></table></div></section>';
        }
        const fields = itemFields();
        const f = fields.find(function (x) { return x.code === sel.field; }) || fields[0];
        sel.field = f ? f.code : '';
        if (f) {
          const items = visibleItems(report.branches);
          html += '<section class="panel"><h2>' + esc(f.label + unitHeader(f)) + ', all branches, ' + esc(plabel) + '</h2><div class="table-wrap"><table class="table entry-table" id="grid"><thead><tr><th scope="col">Item</th>' +
            report.branches.map(function (b) { return '<th scope="col" class="num">' + esc(b) + '</th>'; }).join('') + '<th scope="col" class="num">Total</th></tr></thead><tbody>' +
            items.map(function (it) {
              return '<tr><th scope="row">' + esc(it) + '</th>' + report.branches.map(function (b) { return cellHtml(f, b, it); }).join('') +
                '<td class="num" data-rowtotal="' + esc(it) + '"></td></tr>';
            }).join('') + '</tbody>' +
            '<tfoot><tr><th scope="row">Total</th>' + report.branches.map(function (b) { return '<td class="num" data-coltotal="' + esc(b) + '"></td>'; }).join('') +
            '<td class="num" data-coltotal="__all"></td></tr></tfoot></table></div></section>';
        }
      }

      html += '<div class="save-bar" id="save-bar"><span id="dirty-note">No unsaved changes.</span>' +
        '<button type="button" class="btn btn-quiet" id="discard" disabled>Discard</button>' +
        '<button type="button" class="btn btn-primary" id="save" disabled>Save changes</button></div>' +
        '<p class="muted small">Type amounts in rupees. You can paste a block of cells copied from Excel. Enter moves down. Clearing every value of a row removes that row.</p>';
      body.innerHTML = html;
      refresh();
    }

    function inputs() { return $$('[data-k]', $('#en-body', main)); }
    function norm(el) {
      let v = String(el.value || '').trim();
      if (el.classList.contains('num-input')) v = v.replace(/[,₹\s]/g, '');
      return v;
    }
    function dirtyCount() {
      if (!ds) return 0;
      return inputs().filter(function (el) { return norm(el) !== (originals[el.dataset.k] || ''); }).length;
    }

    function validate(el) {
      const f = ds.fields[el.dataset.c];
      const v = norm(el);
      let bad = '';
      if (v && isNumeric(f.type)) {
        const n = Number(v);
        if (!isFinite(n)) bad = 'Not a number';
        else if (n < 0 && !f.negative) bad = 'Cannot be negative';
        else if (f.type === 'quantity' && Math.round(n) !== n) bad = 'Whole numbers only';
      }
      if (bad) { el.setAttribute('aria-invalid', 'true'); el.title = bad; } else { el.removeAttribute('aria-invalid'); el.title = ''; }
      el.classList.toggle('dirty', v !== (originals[el.dataset.k] || ''));
      return !bad;
    }

    // Recompute totals and calculated columns from what is on screen.
    function refresh() {
      const body = $('#en-body', main);
      const draft = {};
      inputs().forEach(function (el) {
        const k = sel.period + '|' + el.dataset.b + '|' + el.dataset.i;
        const f = ds.fields[el.dataset.c];
        const v = norm(el);
        if (!draft[k]) {
          const ex = ds.index[sel.period] && ds.index[sel.period][el.dataset.b] && ds.index[sel.period][el.dataset.b][el.dataset.i];
          draft[k] = { p: sel.period, b: el.dataset.b, i: el.dataset.i, v: ex ? Object.assign({}, ex.v) : {} };
        }
        if (v === '' || (isNumeric(f.type) && !isFinite(Number(v)))) delete draft[k].v[f.code];
        else draft[k].v[f.code] = isNumeric(f.type) ? Number(v) : v;
      });
      const preview = new C.Dataset(ds.report, ds.records, lists, []);
      preview.linked = ds.linked;
      preview.linkedByName = ds.linkedByName;
      preview.upsert(Object.keys(draft).map(function (k) { return draft[k]; }));

      const fmt = function (v, type) { return C.formatValue(v, type, RUPEES); };
      const scope = sel.branch === '__all' ? report.branches : [sel.branch];
      $$('[data-total]', body).forEach(function (td) {
        const f = ds.fields[td.dataset.total];
        td.textContent = isNumeric(f.type) ? fmt(preview.value(f.code, preview.ctx([sel.period], scope, null)), f.type) : '';
      });
      $$('[data-calc]', body).forEach(function (td) {
        const c = ds.calcs[td.dataset.calc];
        const items = td.dataset.ci === '__total' || !ds.hasItems ? null : [td.dataset.ci];
        td.textContent = fmt(preview.value(c.code, preview.ctx([sel.period], scope, items)), c.format);
      });
      const note = $('#tot-calcs', body);
      if (note) {
        note.textContent = report.calcs.filter(function (c) { return c.where === 'totals'; }).map(function (c) {
          return c.label + ': ' + (fmt(preview.value(c.code, preview.ctx([sel.period], scope, null)), c.format) || 'blank');
        }).join('     ');
      }
      $$('[data-rowtotal]', body).forEach(function (td) {
        const code = ds.hasItems ? sel.field : td.dataset.rowtotal;
        const f = ds.fields[code];
        if (!f || !isNumeric(f.type)) { td.textContent = ''; return; }
        const items = ds.hasItems ? [td.dataset.rowtotal] : null;
        td.textContent = fmt(preview.value(code, preview.ctx([sel.period], report.branches, items)), f.type);
      });
      $$('[data-coltotal]', body).forEach(function (td) {
        const f = ds.fields[sel.field];
        if (!f || !isNumeric(f.type)) { td.textContent = ''; return; }
        const bs = td.dataset.coltotal === '__all' ? report.branches : [td.dataset.coltotal];
        td.textContent = fmt(preview.value(f.code, preview.ctx([sel.period], bs, null)), f.type);
      });
      const n = dirtyCount();
      $('#dirty-note', body).textContent = n ? n + ' unsaved change' + (n === 1 ? '' : 's') + '.' : 'No unsaved changes.';
      $('#save', body).disabled = !n || isLocked();
      $('#discard', body).disabled = !n;
      $('#save-bar', body).classList.toggle('has-changes', !!n);
    }

    function gridMatrix(el) {
      return $$('tbody tr', el.closest('table')).map(function (tr) {
        return $$('td', tr).map(function (td) { return td.querySelector('[data-k]'); });
      });
    }
    function findPos(matrix, el) {
      for (let r = 0; r < matrix.length; r++) {
        const c = matrix[r].indexOf(el);
        if (c !== -1) return { r: r, c: c };
      }
      return null;
    }

    // Listeners live on the stable container so re-rendering the grid never stacks them.
    const enBody = $('#en-body', main);
    enBody.addEventListener('input', function (e) { if (e.target.dataset && e.target.dataset.k) { validate(e.target); refresh(); } });
    enBody.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.k) { validate(e.target); refresh(); } });
    enBody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.k || e.target.tagName === 'SELECT') return;
      e.preventDefault();
      const m = gridMatrix(e.target), p = findPos(m, e.target);
      if (!p) return;
      for (let r = p.r + 1; r < m.length; r++) {
        const t = m[r][p.c];
        if (t && !t.disabled) { t.focus(); if (t.select) t.select(); return; }
      }
    });
    enBody.addEventListener('paste', function (e) {
      const el = e.target;
      if (!el.dataset || !el.dataset.k) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text)) return;
      e.preventDefault();
      const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function (r) { return r.split('\t'); });
      const matrix = gridMatrix(el), pos = findPos(matrix, el);
      if (!pos) return;
      rows.forEach(function (cells, i) {
        cells.forEach(function (v, j) {
          const row = matrix[pos.r + i];
          const target = row && row[pos.c + j];
          if (target && !target.disabled) { target.value = v.trim(); validate(target); }
        });
      });
      refresh();
    });
    enBody.addEventListener('click', function (e) {
      if (e.target.closest('#discard')) renderGrid();
      if (e.target.closest('#save')) save();
    });

    function historyAverage(b, item, code) {
      const vals = [];
      let p = sel.period;
      for (let k = 0; k < 6; k++) {
        p = ds.prevPeriod(p);
        if (!p) break;
        const v = ds.raw(p, b, item, code);
        if (typeof v === 'number') vals.push(v);
      }
      return vals.length ? vals.reduce(function (a, x) { return a + x; }, 0) / vals.length : null;
    }

    async function save() {
      const changed = inputs().filter(function (el) { return norm(el) !== (originals[el.dataset.k] || ''); });
      if (!changed.length) return;
      if (changed.map(validate).some(function (ok) { return !ok; })) { toast('Fix the cells marked in red first.', 'error'); return; }
      const unusual = [];
      const rows = {};
      changed.forEach(function (el) {
        const f = ds.fields[el.dataset.c];
        const v = norm(el);
        const k = el.dataset.b + '|' + el.dataset.i;
        rows[k] = rows[k] || { period: sel.period, branch: el.dataset.b, item: el.dataset.i, values: {} };
        rows[k].values[f.code] = v;
        if (v && isNumeric(f.type) && Number(v) > 0) {
          const avg = historyAverage(el.dataset.b, el.dataset.i, f.code);
          if (avg && avg > 0 && Number(v) > 3 * avg) {
            unusual.push({ label: [el.dataset.b, el.dataset.i, f.label].filter(Boolean).join(', '), v: Number(v), avg: avg, type: f.type });
          }
        }
      });
      if (unusual.length) {
        const ok = await modal({
          title: 'Some figures are much higher than usual', submitLabel: 'Save anyway', cancelLabel: 'Go back and check',
          body: '<p>These are more than 3 times the average of the previous 6 periods. Check for an extra zero before saving.</p><ul class="plain-list">' +
            unusual.map(function (u) {
              return '<li><strong>' + esc(u.label) + '</strong>: ' + esc(C.formatValue(u.v, u.type, RUPEES)) + ' (usually about ' + esc(C.formatValue(u.avg, u.type, RUPEES)) + ')</li>';
            }).join('') + '</ul>',
        });
        if (!ok) return;
      }
      const btn = $('#save', main);
      setBusy(btn, true, 'Saving…');
      try {
        const res = await api('records.save', { reportId: report.id, rows: Object.keys(rows).map(function (k) { return rows[k]; }) });
        ds.upsert(res.records);
        toast(res.saved ? 'Saved ' + res.saved + ' change' + (res.saved === 1 ? '' : 's') + '.' : 'Nothing needed saving.');
        renderGrid();
      } catch (err) {
        toast(err.message, 'error');
        setBusy(btn, false);
      }
    }

    renderSelectors();
    load();
  });

  /* ======================================================================
     VIEW REPORTS
     ====================================================================== */

  route('/view', ['superadmin', 'admin'], 'view', async function (main, ctx) {
    const res = await Promise.all([api('reports.list'), getLists()]);
    if (!ctx.alive()) return;
    main.innerHTML = reportPicker(res[0], 'view', 'View reports', 'Choose a report to see it by month, quarter, half-year or year.', res[1]);
  });

  route('/view/:id', ['superadmin', 'admin'], 'view', async function (main, ctx) {
    const res = await Promise.all([getLists(), api('reports.list')]);
    if (!ctx.alive()) return;
    const lists = res[0], reports = res[1];
    const report = reports.find(function (r) { return r.id === ctx.params.id; });
    if (!report) { main.innerHTML = emptyState('Report not available', 'It may have been deleted, or you no longer have access.', '<a class="btn" href="#/view">All reports</a>'); return; }
    const s = report.settings;
    const ys = Number(s.yearStart) || 4;
    const isDate = s.periodType === 'date';
    const vkey = 'rp_view_' + report.id;
    const now = thisMonth();
    const sel = Object.assign({
      fy: C.fyStartYear(now, ys), level: isDate ? 'date' : 'month', branch: '', item: '',
      rows: 'period', cols: 'fields', measure: '', chart: 'auto',
    }, recall(vkey) || {});
    let ds = null, loadedFy = null, chart = null, lastModel = null;

    main.innerHTML = pageHead(report.name, reportMeta(report, lists) + '. Amounts in ' + C.unitLabel(s) + '.',
      (state.user.role === 'superadmin' ? '<a class="btn btn-quiet" href="#/entry/' + encodeURIComponent(report.id) + '">Enter data</a>' : '') +
      '<button class="btn btn-quiet" type="button" id="v-print">Print or PDF</button>' +
      '<button class="btn" type="button" id="v-xlsx">Export Excel</button>') +
      '<section class="panel selector-bar" id="v-sel"></section><div id="v-body">' + loadingHtml() + '</div>';

    $('#v-print', main).addEventListener('click', function () { window.print(); });
    $('#v-xlsx', main).addEventListener('click', function () { exportExcel(); });

    async function load() {
      $('#v-body', main).innerHTML = loadingHtml();
      const data = await api('records.get', {
        reportId: report.id, from: C.fyStartMonth(sel.fy - 1, ys), to: C.monthAdd(C.fyStartMonth(sel.fy, ys), 11),
      });
      if (!ctx.alive()) return;
      ds = new C.Dataset(data.report, data.records, lists, data.linked);
      loadedFy = sel.fy;
      render();
    }

    const fields = function () { return report.fields.filter(function (f) { return !f.archived; }); };
    const numericCols = function () {
      return fields().filter(function (f) { return isNumeric(f.type); }).map(function (f) { return { code: f.code, label: f.label, type: f.type, calc: false }; })
        .concat(report.calcs.filter(function (c) { return c.format !== 'text'; }).map(function (c) { return { code: c.code, label: c.label, type: c.format, calc: true }; }));
    };
    const allCols = function () {
      return fields().map(function (f) { return { code: f.code, label: f.label, type: f.type, calc: false, branchLevel: ds.hasItems && f.level === 'branch' }; })
        .concat(report.calcs.map(function (c) { return { code: c.code, label: c.label, type: c.format, calc: true, where: c.where }; }));
    };

    function fyPeriods() {
      if (!isDate) return C.fyMonths(sel.fy, ys);
      const first = C.fyStartMonth(sel.fy, ys), last = C.monthAdd(first, 11);
      return ds.periods.filter(function (p) { return p.slice(0, 7) >= first && p.slice(0, 7) <= last; });
    }
    function buckets() {
      const map = {}, order = [];
      fyPeriods().forEach(function (p) {
        const b = C.bucketOf(p, sel.level, ys);
        if (!map[b]) { map[b] = []; order.push(b); }
        map[b].push(p);
      });
      return { map: map, order: order };
    }

    function renderSelectors() {
      const bar = $('#v-sel', main);
      const years = [];
      for (let y = C.fyStartYear(now, ys) + 1; y >= 2018; y--) years.push(y);
      const levels = (isDate ? [['date', 'Each date']] : []).concat([['month', 'Month'], ['quarter', 'Quarter'], ['half', 'Half-year'], ['year', 'Year']]);
      const hasItems = ds ? ds.hasItems : !!s.itemList;
      const dims = [['period', 'Period'], ['branch', 'Branch']].concat(hasItems ? [['item', 'Item']] : []);
      const itemNames = ds ? ds.itemNames : [];
      bar.innerHTML =
        '<div class="field"><label for="v-report">Report</label><select id="v-report">' + reports.map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (r.id === report.id ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="v-fy">Year</label><select id="v-fy">' + years.map(function (y) {
          return '<option value="' + y + '"' + (y === sel.fy ? ' selected' : '') + '>FY ' + esc(C.fyLabel(y, ys)) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="v-level">View by</label><select id="v-level">' + levels.map(function (l) {
          return '<option value="' + l[0] + '"' + (sel.level === l[0] ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="v-branch">Branch</label><select id="v-branch"><option value="">All branches</option>' + report.branches.map(function (b) {
          return '<option' + (sel.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></div>' +
        (hasItems ? '<div class="field"><label for="v-item">Item</label><select id="v-item"><option value="">All items</option>' + itemNames.map(function (i) {
          return '<option' + (sel.item === i ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') + '</select></div>' : '') +
        '<div class="field"><label for="v-rows">Rows</label><select id="v-rows">' + dims.map(function (d) {
          return '<option value="' + d[0] + '"' + (sel.rows === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="v-cols">Columns</label><select id="v-cols"><option value="fields"' + (sel.cols === 'fields' ? ' selected' : '') + '>Fields</option>' +
          dims.filter(function (d) { return d[0] !== sel.rows; }).map(function (d) {
            return '<option value="' + d[0] + '"' + (sel.cols === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') + '</select></div>' +
        (sel.cols !== 'fields' ? '<div class="field"><label for="v-measure">Showing</label><select id="v-measure">' + numericCols().map(function (c) {
          return '<option value="' + esc(c.code) + '"' + (sel.measure === c.code ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>' : '');

      const set = function (patch) { Object.assign(sel, patch); remember(vkey, sel); if (sel.fy !== loadedFy) { renderSelectors(); load(); } else render(); };
      $('#v-report', bar).addEventListener('change', function (e) { location.hash = '#/view/' + encodeURIComponent(e.target.value); });
      $('#v-fy', bar).addEventListener('change', function (e) { set({ fy: Number(e.target.value) }); });
      $('#v-level', bar).addEventListener('change', function (e) { set({ level: e.target.value }); });
      $('#v-branch', bar).addEventListener('change', function (e) { set({ branch: e.target.value }); });
      const vi = $('#v-item', bar); if (vi) vi.addEventListener('change', function (e) { set({ item: e.target.value }); });
      $('#v-rows', bar).addEventListener('change', function (e) { set({ rows: e.target.value, cols: sel.cols === e.target.value ? 'fields' : sel.cols }); });
      $('#v-cols', bar).addEventListener('change', function (e) { set({ cols: e.target.value }); });
      const vm = $('#v-measure', bar); if (vm) vm.addEventListener('change', function (e) { set({ measure: e.target.value }); });
    }

    // The table model: columns, body rows and summary rows. Values stay raw (rupees) here.
    function buildModel() {
      if (!ds.hasItems) { if (sel.rows === 'item') sel.rows = 'period'; if (sel.cols === 'item') sel.cols = 'fields'; sel.item = ''; }
      if (sel.cols === sel.rows) sel.cols = 'fields';
      const bk = buckets();
      const allPeriods = fyPeriods();
      const branchesSel = sel.branch ? [sel.branch] : report.branches;
      const itemsSel = sel.item ? [sel.item] : null;
      const sm = report.summaries || {};

      function dimValues(dim) {
        if (dim === 'period') return bk.order.map(function (b) { return { v: b, l: C.bucketLabel(b, sel.level, ys) }; });
        if (dim === 'branch') return branchesSel.map(function (b) { return { v: b, l: b }; });
        if (itemsSel) return itemsSel.map(function (n) { return { v: n, l: n }; });
        const probe = numericCols().filter(function (c) { return !c.calc; })[0];
        return ds.items.filter(function (it) {
          if (!probe) return it.active !== false;
          return ds.value(probe.code, ds.ctx(allPeriods, branchesSel, [it.name])) !== null;
        }).map(function (it) { return { v: it.name, l: it.name }; });
      }
      function ctxFor(parts) {
        return ds.ctx(parts.period ? bk.map[parts.period] : allPeriods, parts.branch ? [parts.branch] : branchesSel, parts.item ? [parts.item] : itemsSel);
      }
      const val = function (code, parts) { return ds.value(code, ctxFor(parts)); };
      const rowVals = dimValues(sel.rows);
      const model = { rowHead: { period: 'Period', branch: 'Branch', item: 'Item' }[sel.rows], cols: [], rows: [], summary: [] };

      if (sel.cols === 'fields') {
        allCols().forEach(function (c) {
          if (sel.rows === 'item' && (c.branchLevel || (c.calc && c.where === 'totals'))) return;
          model.cols.push(c);
          if (sm.share === c.code) model.cols.push({ code: '__share', label: '% share', type: 'percent', share: c.code });
        });
        if (sm.rank && sel.rows !== 'period' && model.cols.some(function (c) { return c.code === sm.rank; })) {
          model.cols.push({ code: '__rank', label: 'Rank', type: 'rank', rank: sm.rank });
        }
        const shareTotal = sm.share ? val(sm.share, {}) : null;
        let rows = rowVals.map(function (rv) {
          const parts = {}; parts[sel.rows] = rv.v;
          return { label: rv.l, cells: model.cols.map(function (c) {
            if (c.share) { const x = val(c.share, parts); return x === null || !shareTotal ? null : x / shareTotal * 100; }
            if (c.rank) return null;
            return val(c.code, parts);
          }) };
        });

        let topGrand = null, ti = -1;
        if (sm.top && sm.top.code && sel.rows === 'item' && !itemsSel) {
          ti = model.cols.findIndex(function (c) { return c.code === sm.top.code; });
          if (ti >= 0) {
            rows.sort(function (a, b) { return (b.cells[ti] || 0) - (a.cells[ti] || 0); });
            const top = rows.slice(0, sm.top.n), rest = rows.slice(sm.top.n);
            topGrand = sm.top.totalCode ? val(sm.top.totalCode, {}) : null;
            const topSum = top.reduce(function (a, r) { return a + (r.cells[ti] || 0); }, 0);
            const othersMain = topGrand !== null ? topGrand - topSum : rest.reduce(function (a, r) { return a + (r.cells[ti] || 0); }, 0);
            const base = topGrand !== null ? topGrand : shareTotal;
            const others = { label: 'Others', others: true, cells: model.cols.map(function (c, i) {
              if (i === ti) return othersMain;
              if (c.share) return c.share === sm.top.code && base ? othersMain / base * 100 : null;
              if (c.calc || c.rank || !isNumeric(c.type)) return null;
              return rest.length ? rest.reduce(function (a, r) { return a + (r.cells[i] || 0); }, 0) : null;
            }) };
            if (topGrand !== null) {
              const si = model.cols.findIndex(function (c) { return c.share === sm.top.code; });
              if (si >= 0) top.forEach(function (r) { r.cells[si] = r.cells[ti] === null || !topGrand ? null : r.cells[ti] / topGrand * 100; });
            }
            rows = top.concat(topGrand !== null || rest.length ? [others] : []);
          }
        }
        const ri = model.cols.findIndex(function (c) { return c.rank; });
        if (ri >= 0) {
          const src = model.cols.findIndex(function (c) { return c.code === sm.rank; });
          const sorted = rows.filter(function (r) { return !r.others && r.cells[src] !== null; }).map(function (r) { return r.cells[src]; }).sort(function (a, b) { return b - a; });
          rows.forEach(function (r) { if (!r.others && r.cells[src] !== null) r.cells[ri] = sorted.indexOf(r.cells[src]) + 1; });
        }
        model.rows = rows;

        const plain = function (c) { return isNumeric(c.type) && !c.share && !c.rank; };
        if (sm.total !== false) {
          model.summary.push({ label: 'Total', cells: model.cols.map(function (c, i) {
            if (c.share) return shareTotal !== null || topGrand !== null ? 100 : null;
            if (c.rank) return null;
            if (topGrand !== null && i === ti) return topGrand;
            return val(c.code, {});
          }) });
        }
        const levelWord = { date: 'date', month: 'month', quarter: 'quarter', half: 'half-year', year: 'year' }[sel.level];
        const bucketsWithData = function (code) {
          return bk.order.filter(function (b) { return ds.value(code, ds.ctx(bk.map[b], branchesSel, itemsSel)) !== null; }).length;
        };
        if (sm.avg) {
          model.summary.push({ label: 'Average per ' + levelWord, cells: model.cols.map(function (c) {
            if (!plain(c) || c.calc) return null;
            const t = val(c.code, {}), n = bucketsWithData(c.code);
            return t === null || !n ? null : t / n;
          }) });
        }
        if (sm.avgBranch) {
          model.summary.push({ label: 'Average per branch per ' + levelWord, cells: model.cols.map(function (c) {
            if (!plain(c) || c.calc) return null;
            const t = val(c.code, {}), n = bucketsWithData(c.code);
            const nb = branchesSel.filter(function (b) { return ds.value(c.code, ds.ctx(allPeriods, [b], itemsSel)) !== null; }).length;
            return t === null || !n || !nb ? null : t / (n * nb);
          }) });
        }
        const over = function (fn, label, count) {
          model.summary.push({ label: label, count: count, cells: model.cols.map(function (c, i) {
            if (!plain(c)) return null;
            const vals = model.rows.filter(function (r) { return !r.others; }).map(function (r) { return r.cells[i]; }).filter(function (v) { return v !== null; });
            return vals.length ? fn(vals) : null;
          }) });
        };
        if (sm.count) over(function (v) { return v.length; }, 'Count of rows with figures', true);
        if (sm.min) over(function (v) { return Math.min.apply(null, v); }, 'Lowest');
        if (sm.max) over(function (v) { return Math.max.apply(null, v); }, 'Highest');
      } else {
        const m = numericCols().find(function (c) { return c.code === sel.measure; }) || numericCols()[0];
        if (!m) return null;
        sel.measure = m.code;
        model.measure = m;
        dimValues(sel.cols).forEach(function (cv) { model.cols.push({ code: m.code, label: cv.l, type: m.type, calc: m.calc, part: cv.v }); });
        model.cols.push({ code: m.code, label: 'Total', type: m.type, calc: m.calc, total: true });
        model.rows = rowVals.map(function (rv) {
          return { label: rv.l, cells: model.cols.map(function (c) {
            const p = {}; p[sel.rows] = rv.v;
            if (!c.total) p[sel.cols] = c.part;
            return val(m.code, p);
          }) };
        });
        if (sm.total !== false) {
          model.summary.push({ label: 'Total', cells: model.cols.map(function (c) {
            const p = {};
            if (!c.total) p[sel.cols] = c.part;
            return val(m.code, p);
          }) });
        }
        if ((sm.avg || sm.avgBranch) && !m.calc) {
          model.summary.push({ label: 'Average per row', cells: model.cols.map(function (c, i) {
            const vals = model.rows.map(function (r) { return r.cells[i]; }).filter(function (v) { return v !== null; });
            return vals.length ? vals.reduce(function (a, x) { return a + x; }, 0) / vals.length : null;
          }) });
        }
      }
      return model;
    }

    function cellText(v, c, row) {
      if (c.rank || (row && row.count)) return v === null ? '' : String(v);
      return C.formatValue(v, c.type, s);
    }
    function numCls(c) { return (isNumeric(c.type) || c.rank ? 'num' : '') + (c.calc ? ' calc-col' : ''); }

    function render() {
      renderSelectors();
      const body = $('#v-body', main);
      if (chart) { chart.destroy(); chart = null; }
      const model = buildModel();
      lastModel = model;
      if (!model) { body.innerHTML = emptyState('Nothing to show', 'This report has no number fields to show across columns.'); return; }
      const hasData = model.rows.some(function (r) { return r.cells.some(function (v) { return v !== null && v !== ''; }); });
      body.innerHTML =
        '<section class="panel panel-flush"><div class="table-wrap"><table class="table report-table" id="v-table"><thead><tr><th scope="col">' + esc(model.rowHead) + '</th>' +
          model.cols.map(function (c) { return '<th scope="col" class="' + numCls(c) + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        model.rows.map(function (r) {
          return '<tr' + (r.others ? ' class="others-row"' : '') + '><th scope="row">' + esc(r.label) + '</th>' + r.cells.map(function (v, i) {
            return '<td class="' + numCls(model.cols[i]) + '">' + esc(cellText(v, model.cols[i], r)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>' +
        (model.summary.length ? '<tfoot>' + model.summary.map(function (r) {
          return '<tr><th scope="row">' + esc(r.label) + '</th>' + r.cells.map(function (v, i) {
            return '<td class="' + numCls(model.cols[i]) + '">' + esc(cellText(v, model.cols[i], r)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tfoot>' : '') +
        '</table></div></section>' +
        (hasData ? '' : '<p class="notice">No figures for this selection yet.</p>') +
        '<p class="muted small">Amounts in ' + esc(C.unitLabel(s)) + '. Totals and calculated fields are recalculated from the data, never added up.' +
          (model.measure ? ' Showing ' + esc(model.measure.label) + '.' : '') + '</p>' +
        '<section class="panel chart-panel"><div class="chart-head"><h2>Chart</h2><div class="field"><label for="v-chart">Style</label><select id="v-chart">' +
          [['auto', 'Automatic'], ['bar', 'Bars'], ['line', 'Line']].map(function (o) { return '<option value="' + o[0] + '"' + (sel.chart === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div></div><div class="chart-box"><canvas id="v-canvas" role="img" aria-label="Chart of this report"></canvas></div><p class="muted small" id="v-chart-note"></p></section>';
      $('#v-chart', body).addEventListener('change', function (e) { sel.chart = e.target.value; remember(vkey, sel); render(); });
      drawChart(model);
    }

    function drawChart(model) {
      const noteEl = $('#v-chart-note', main);
      if (typeof Chart === 'undefined') { noteEl.textContent = 'Charts could not load. Check your internet connection.'; return; }
      let series;
      if (sel.cols === 'fields') {
        const i = model.cols.findIndex(function (c) { return (c.type === 'amount' || c.type === 'number' || c.type === 'quantity') && !c.rank; });
        if (i < 0) { noteEl.textContent = 'No amount or number column to chart.'; return; }
        series = [{ label: model.cols[i].label, data: model.rows.map(function (r) { return r.cells[i]; }), type: model.cols[i].type }];
        noteEl.textContent = 'Showing ' + model.cols[i].label + '. Set Columns to Branch or Item to compare them on the chart.';
      } else {
        series = model.cols.filter(function (c) { return !c.total; }).slice(0, 10).map(function (c) {
          const i = model.cols.indexOf(c);
          return { label: c.label, data: model.rows.map(function (r) { return r.cells[i]; }), type: c.type };
        });
        noteEl.textContent = model.cols.length - 1 > 10 ? 'Showing the first 10 columns.' : '';
      }
      const type = sel.chart === 'auto' ? (sel.rows === 'period' ? 'line' : 'bar') : sel.chart;
      const factor = { rupees: 1, lakhs: 1e5, crores: 1e7 }[s.unit] || 1;
      chart = new Chart($('#v-canvas', main), {
        type: type,
        data: {
          labels: model.rows.map(function (r) { return r.label; }),
          datasets: series.map(function (x, k) {
            const col = PALETTE[k % PALETTE.length];
            return {
              label: x.label, data: x.data.map(function (v) { return v === null ? null : (x.type === 'amount' ? v / factor : v); }),
              backgroundColor: col, borderColor: col, borderWidth: type === 'line' ? 2.5 : 0, borderRadius: 3, maxBarThickness: 44,
              tension: 0.25, spanGaps: true, pointRadius: 3,
            };
          }),
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: RP.reduceMotion ? false : { duration: 250 },
          plugins: { legend: { display: series.length > 1, position: 'bottom' } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#E7ECEA' }, title: { display: series[0].type === 'amount', text: C.unitLabel(s) } },
            x: { grid: { display: false } },
          },
        },
      });
    }

    function exportExcel() {
      if (!lastModel) return;
      if (typeof XLSX === 'undefined') { toast('The Excel library could not load. Check your internet connection.', 'error'); return; }
      const m = lastModel;
      const levelName = { date: 'Each date', month: 'Month', quarter: 'Quarter', half: 'Half-year', year: 'Year' }[sel.level];
      const selText = ['FY ' + C.fyLabel(sel.fy, ys), 'View by ' + levelName, sel.branch || 'All branches',
        ds.hasItems ? (sel.item || 'All items') : '', 'Amounts in ' + C.unitLabel(s)].filter(Boolean).join(', ');
      const aoa = [[report.name], [selText], ['Exported ' + new Date().toLocaleString('en-IN')], [],
        [m.rowHead].concat(m.cols.map(function (c) { return c.label; }))];
      m.rows.concat(m.summary).forEach(function (r) {
        aoa.push([r.label].concat(r.cells.map(function (v, i) {
          const c = m.cols[i];
          if (c.rank || r.count) return v === null ? '' : v;
          return C.exportValue(v, c.type, s);
        })));
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 26 }].concat(m.cols.map(function () { return { wch: 15 }; }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, fileName(report.name) + '-FY' + C.fyLabel(sel.fy, ys) + '.xlsx');
    }

    renderSelectors();
    load();
  });

  /* ======================================================================
     IMPORT (super admin)
     ====================================================================== */

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }

  function normalizePeriod(v, isDate) {
    const s = String(v || '').trim();
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
    if (m) {
      const ym = m[1] + '-' + m[2].padStart(2, '0');
      if (!isDate) return ym;
      return m[3] ? ym + '-' + m[3].padStart(2, '0') : '';
    }
    m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(s);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const ym = y + '-' + m[2].padStart(2, '0');
      return isDate ? ym + '-' + m[1].padStart(2, '0') : ym;
    }
    m = /^([A-Za-z]{3,9})[\s\-]*(\d{2,4})$/.exec(s);
    if (m && !isDate) {
      const idx = MONTHS.findIndex(function (x) { return x.toLowerCase() === m[1].slice(0, 3).toLowerCase(); });
      if (idx >= 0) return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + String(idx + 1).padStart(2, '0');
    }
    return '';
  }
  RP.normalizePeriod = normalizePeriod;

  route('/import/:id', ['superadmin'], 'reports', async function (main, ctx) {
    const res = await Promise.all([getLists(), api('reports.list')]);
    if (!ctx.alive()) return;
    const lists = res[0];
    const report = res[1].find(function (r) { return r.id === ctx.params.id; });
    if (!report) { main.innerHTML = emptyState('Report not found', 'It may have been deleted.', '<a class="btn" href="#/reports">All reports</a>'); return; }
    const isDate = report.settings.periodType === 'date';
    const list = report.settings.itemList ? lists.find(function (l) { return l.id === report.settings.itemList; }) : null;
    const fields = report.fields.filter(function (f) { return !f.archived; });
    const cols = ['Period', 'Branch'].concat(list ? ['Item'] : []).concat(fields.map(function (f) { return f.code; }));

    main.innerHTML = pageHead('Import into ' + report.name, 'Load history, or a month\u2019s figures, from a CSV file in the standard format.',
      '<a class="btn btn-quiet" href="#/reports">Back to reports</a>') +
      '<section class="panel"><h2>File format</h2>' +
        '<p>One header row, then one row per ' + (list ? 'period, branch and item' : 'period and branch') + '. Columns can be in any order.</p>' +
        '<div class="table-wrap"><table class="table compact-table"><thead><tr><th>Column</th><th>What to put</th></tr></thead><tbody>' +
          '<tr><td><code>Period</code></td><td>' + (isDate ? 'Date as YYYY-MM-DD, for example 2026-08-31' : 'Month as YYYY-MM, for example 2026-08 (Aug-26 and Aug 2026 also work)') + '</td></tr>' +
          '<tr><td><code>Branch</code></td><td>One of: ' + esc(report.branches.join(', ')) + '</td></tr>' +
          (list ? '<tr><td><code>Item</code></td><td>An item from the ' + esc(list.name) + ' list. Leave blank for fields entered once per branch.</td></tr>' : '') +
          fields.map(function (f) {
            return '<tr><td><code>' + esc(f.code) + '</code></td><td>' + esc(f.label) + (f.type === 'amount' ? ', in rupees' : '') +
              (f.level === 'branch' && list ? ' (on rows with a blank Item)' : '') + '</td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<p class="muted small">Blank cells are skipped, so importing never clears a figure. A figure for the same period, branch and item is replaced.</p>' +
        '<div class="form-actions"><button class="btn" type="button" id="im-template">Download blank template</button></div>' +
      '</section>' +
      '<section class="panel"><h2>Choose file</h2><div class="field"><label for="im-file">CSV file</label><input type="file" id="im-file" accept=".csv,text/csv"></div><div id="im-result"></div></section>';

    $('#im-template', main).addEventListener('click', function () {
      const blob = new Blob(['\ufeff' + cols.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName(report.name) + '-template.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });

    $('#im-file', main).addEventListener('change', async function (e) {
      const file = e.target.files[0];
      const out = $('#im-result', main);
      if (!file) return;
      const rows = parseCsv((await file.text()).replace(/^\ufeff/, ''));
      if (rows.length < 2) { out.innerHTML = '<p class="form-error">The file has no data rows.</p>'; return; }
      const head = rows[0].map(function (h) { return h.trim(); });
      const find = function (name) { return head.findIndex(function (h) { return h.toLowerCase() === name.toLowerCase(); }); };
      const ip = find('Period'), ib = find('Branch'), ii = find('Item');
      const fmap = fields.map(function (f) {
        let i = find(f.code);
        if (i < 0) i = find(f.label);
        return { f: f, i: i };
      }).filter(function (x) { return x.i >= 0; });
      const errors = [];
      if (ip < 0) errors.push('The Period column is missing.');
      if (ib < 0) errors.push('The Branch column is missing.');
      if (!fmap.length) errors.push('No field columns found. Use the codes: ' + fields.map(function (f) { return f.code; }).join(', ') + '.');
      const ignored = head.filter(function (h, i) { return h && i !== ip && i !== ib && i !== ii && !fmap.some(function (x) { return x.i === i; }); });

      const records = [];
      if (!errors.length) {
        rows.slice(1).forEach(function (r, n) {
          const line = n + 2;
          const period = normalizePeriod(r[ip], isDate);
          const branch = String(r[ib] || '').trim();
          const item = ii >= 0 ? String(r[ii] || '').trim() : '';
          if (!period) { errors.push('Line ' + line + ': "' + (r[ip] || '') + '" is not a valid ' + (isDate ? 'date.' : 'month.')); return; }
          if (report.branches.indexOf(branch) === -1) { errors.push('Line ' + line + ': "' + branch + '" is not a branch of this report.'); return; }
          if (item && (!list || !list.items.some(function (x) { return x.name === item; }))) { errors.push('Line ' + line + ': "' + item + '" is not in the item list.'); return; }
          const values = {};
          fmap.forEach(function (x) {
            const v = String(r[x.i] === undefined ? '' : r[x.i]).trim();
            if (v === '') return;
            if (list && (x.f.level === 'branch') !== !item) return;
            const clean = isNumeric(x.f.type) ? v.replace(/[,₹\s]/g, '') : v;
            if (isNumeric(x.f.type) && !isFinite(Number(clean))) { errors.push('Line ' + line + ': ' + x.f.code + ' "' + v + '" is not a number.'); return; }
            values[x.f.code] = clean;
          });
          if (Object.keys(values).length) records.push({ period: period, branch: branch, item: item, values: values });
        });
      }
      const periods = records.map(function (r) { return r.period; }).sort();
      out.innerHTML =
        (errors.length ? '<div class="form-error"><strong>' + errors.length + ' problem' + (errors.length === 1 ? '' : 's') + ' to fix first:</strong><ul class="plain-list">' +
          errors.slice(0, 20).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + (errors.length > 20 ? '<p>…and ' + (errors.length - 20) + ' more.</p>' : '') + '</div>' : '') +
        (ignored.length ? '<p class="muted small">Columns ignored: ' + esc(ignored.join(', ')) + '</p>' : '') +
        (!errors.length && records.length
          ? '<p><strong>' + records.length.toLocaleString('en-IN') + '</strong> rows ready, from ' + esc(C.periodLabel(periods[0])) + ' to ' + esc(C.periodLabel(periods[periods.length - 1])) + '.</p>' +
            '<div class="table-wrap"><table class="table compact-table"><thead><tr><th>Period</th><th>Branch</th>' + (list ? '<th>Item</th>' : '') +
              fmap.map(function (x) { return '<th class="num">' + esc(x.f.code) + '</th>'; }).join('') + '</tr></thead><tbody>' +
              records.slice(0, 8).map(function (r) {
                return '<tr><td>' + esc(r.period) + '</td><td>' + esc(r.branch) + '</td>' + (list ? '<td>' + esc(r.item) + '</td>' : '') +
                  fmap.map(function (x) { return '<td class="num">' + esc(r.values[x.f.code] || '') + '</td>'; }).join('') + '</tr>';
              }).join('') + '</tbody></table></div>' +
            '<div class="form-actions"><button class="btn btn-primary" type="button" id="im-go">Import ' + records.length.toLocaleString('en-IN') + ' rows</button><span id="im-progress" class="muted" aria-live="polite"></span></div>'
          : (!errors.length ? '<p class="muted">No rows with values found.</p>' : ''));

      const go = $('#im-go', out);
      if (go) go.addEventListener('click', async function () {
        setBusy(go, true, 'Importing…');
        const prog = $('#im-progress', out);
        let done = 0, changed = 0;
        try {
          for (let k = 0; k < records.length; k += 500) {
            const r = await api('records.import', { reportId: report.id, rows: records.slice(k, k + 500) });
            done += Math.min(500, records.length - k);
            changed += r.saved;
            prog.textContent = done.toLocaleString('en-IN') + ' of ' + records.length.toLocaleString('en-IN') + ' rows…';
          }
          toast('Import finished: ' + changed.toLocaleString('en-IN') + ' figures added or changed.');
          prog.textContent = 'Done. ' + changed.toLocaleString('en-IN') + ' figures added or changed.';
          setBusy(go, false);
          go.disabled = true;
          go.textContent = 'Imported';
        } catch (err) {
          toast(err.message, 'error');
          prog.textContent = 'Stopped after ' + done.toLocaleString('en-IN') + ' rows: ' + err.message;
          setBusy(go, false);
        }
      });
    });
  });
})();
