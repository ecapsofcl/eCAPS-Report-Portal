/* Report Portal - dashboard view for View reports
   KPI cards, labelled charts and a drill-down, built from the same Dataset the table uses,
   so totals and calculated fields are worked out exactly as in the table. */
(function () {
  'use strict';
  const C = window.RPCalc;
  const esc = function (v) { return RP.esc(v); };

  // Same colours as the table chart. A member keeps its colour across months and filters.
  const PALETTE = ['#0C6B65', '#E2A01B', '#4F6A8F', '#B0392A', '#6E8B3D', '#8A5A83', '#2A9D8F', '#C9772C', '#3D4F58', '#D4B24C'];
  const OTHERS_COLOR = '#A3ADB0';
  const INK = '#16252D', INK2 = '#4E5F66', GRID = '#E7ECEA';
  const UNIT = { rupees: 1, lakhs: 1e5, crores: 1e7 };

  // Data labels are off unless a dashboard chart turns them on, so other charts are unchanged.
  if (window.Chart && window.ChartDataLabels) {
    Chart.register(ChartDataLabels);
    Chart.defaults.plugins.datalabels = Object.assign(Chart.defaults.plugins.datalabels || {}, { display: false });
  }

  // Printing: the page shrinks to A4, so each chart is redrawn at print size first, then restored.
  // A4 printable width is about 718px; charts sharing a row get half of it. Heights keep the whole dashboard on one page.
  const PRINT_W = 680, PRINT_HALF = 330, PRINT_H = 158;
  const live = [];
  let printing = false; // charts label fewer points when printed small
  function forPrint(ch) {
    const grid = ch.canvas.closest('.db-grid');
    const paired = grid && !grid.classList.contains('db-one');
    if (ch.config.type === 'doughnut') { const l = ch.options.plugins.legend.labels; l.font = { size: 8 }; l.boxWidth = 7; l.boxHeight = 7; l.padding = 4; }
    if (ch.options.indexAxis === 'y') ch.options.scales.y.ticks.font = { size: 8, weight: 600 };
    ch.resize(paired ? PRINT_HALF : PRINT_W, PRINT_H);
    ch.update('none');
  }
  function forScreen(ch) {
    if (ch.config.type === 'doughnut') { const l = ch.options.plugins.legend.labels; l.font = { size: 12 }; l.boxWidth = 10; l.boxHeight = 10; l.padding = 10; }
    if (ch.options.indexAxis === 'y') ch.options.scales.y.ticks.font = { weight: 600 };
    ch.resize();
    ch.update('none');
  }
  window.addEventListener('beforeprint', function () { printing = true; live.forEach(forPrint); });
  window.addEventListener('afterprint', function () { printing = false; live.forEach(forScreen); });

  function remember(key, obj) { try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* ignore */ } }
  function recall(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  /* --------------------------------------------------------------------
     render(el, o) draws the dashboard into el.
     o: { report, ds, sel (the top filters, read only), lists }
     Returns { destroy } so the caller can clean up charts.
     -------------------------------------------------------------------- */
  function render(el, o) {
    const report = o.report, ds = o.ds, sel = o.sel, lists = o.lists || [];
    const s = report.settings || {};
    const ys = Number(s.yearStart) || 4;
    const isDate = ds.isDate;
    const loc = (window.CONFIG && CONFIG.LOCALE) || 'en-IN';
    const dec = s.decimals !== undefined ? Number(s.decimals) : 2;
    const factor = UNIT[s.unit] || 1;
    const sm = report.summaries || {};
    const defaultTop = sm.top && sm.top.n ? Number(sm.top.n) : 6;
    const key = 'rp_dash_' + report.id;
    const dst = Object.assign({ period: '', measure: '', topN: 0, focus: '', branch: '', range: '24', allLabels: false, fy: null, srcBranch: '', srcItem: '' }, recall(key) || {});
    let charts = [];

    /* ---------- measures (number fields and calculated fields) ---------- */
    const measures = report.fields.filter(function (f) { return !f.archived && C.NUMERIC.indexOf(f.type) !== -1; })
      .map(function (f) { return { code: f.code, label: f.label, type: f.type, calc: false, branchOnly: ds.hasItems && f.level === 'branch', rollup: f.rollup || 'sum' }; })
      .concat((report.calcs || []).filter(function (c) { return c.format !== 'text'; })
        .map(function (c) { return { code: c.code, label: c.label, type: c.format, calc: true, branchOnly: ds.hasItems && c.where === 'totals', where: c.where }; }));
    if (!measures.length) { el.innerHTML = RP.emptyState('Nothing to chart', 'This report has no number fields.'); return { destroy: function () {} }; }
    function defaultMeasure() {
      if (sm.top && sm.top.code && find(sm.top.code)) return sm.top.code;
      if (sm.share && find(sm.share)) return sm.share;
      const total = measures.find(function (m) { return m.calc && /^total$/i.test(m.code); });
      if (total) return total.code;
      const amt = measures.find(function (m) { return !m.calc && m.type === 'amount' && !m.branchOnly; });
      return (amt || measures[0]).code;
    }
    function find(code) { return measures.find(function (m) { return m.code === code; }); }
    if (!find(dst.measure)) dst.measure = defaultMeasure();
    const M = find(dst.measure);
    const isPct = M.type === 'percent';
    const additive = !isPct && (!M.calc || M.where === 'all') && (M.calc || M.rollup === 'sum');

    /* ---------- dimension: items, or branches when the report has no items ---------- */
    const dim = ds.hasItems && !M.branchOnly ? 'item' : 'branch';
    const list = s.itemList ? lists.find(function (l) { return l.id === s.itemList; }) : null;
    const dimWord = dim === 'item' ? (list ? list.name : 'Items') : 'Branches';
    const oneWord = dim === 'item' ? (list ? list.name.split(/\s+/).pop().replace(/ies$/i, 'y').replace(/s$/i, '').toLowerCase() : 'item') : 'branch';
    const allBranches = report.branches.slice();

    // The top Branch and Item filters set the starting point; clicks inside the dashboard refine it.
    if (dst.srcBranch !== (sel.branch || '')) { dst.branch = ''; dst.srcBranch = sel.branch || ''; }
    if (dst.srcItem !== (sel.item || '')) { if (sel.item) dst.focus = sel.item; dst.srcItem = sel.item || ''; }
    const branchSel = dst.branch || sel.branch || '';
    const brs = branchSel && dim === 'item' ? [branchSel] : allBranches;

    /* ---------- periods ---------- */
    const fyFirst = C.fyStartMonth(sel.fy, ys), fyLast = C.monthAdd(fyFirst, 11);
    const prevFirst = C.fyStartMonth(sel.fy - 1, ys);
    const inRange = function (p, a, b) { const m = p.slice(0, 7); return m >= a && m <= b; };
    const fyPeriods = isDate ? ds.periods.filter(function (p) { return inRange(p, fyFirst, fyLast); }) : C.fyMonths(sel.fy, ys);
    const loaded = isDate ? ds.periods.filter(function (p) { return inRange(p, prevFirst, fyLast); }) : C.fyMonths(sel.fy - 1, ys).concat(fyPeriods);

    /* ---------- values ---------- */
    function v(code, periods, branches, items) {
      if (!periods.length || !branches.length) return null;
      return ds.value(code, ds.ctx(periods, branches, items || null));
    }
    function memberVal(name, p) { return dim === 'item' ? v(M.code, [p], brs, [name]) : v(M.code, [p], [name]); }
    function totalVal(p) { return dim === 'item' ? v(M.code, [p], brs) : v(M.code, [p], branchSel && !additive ? [branchSel] : allBranches); }
    function grandFor(p) {
      // A report can store its own total (e.g. BRANCH_TOTAL); then "Others" is that total minus the top rows, as in the table.
      if (dim === 'item' && sm.top && sm.top.totalCode && sm.top.code === M.code) {
        const g = v(sm.top.totalCode, [p], brs);
        if (g !== null) return g;
      }
      return totalVal(p);
    }
    const hasData = function (p) { return totalVal(p) !== null; };
    const label = function (p) { return C.periodLabel(p); };

    if (dst.fy !== sel.fy || fyPeriods.indexOf(dst.period) === -1) {
      const withData = fyPeriods.filter(hasData);
      dst.period = withData.length ? withData[withData.length - 1] : '';
      dst.fy = sel.fy;
    }
    remember(key, dst);
    if (!dst.period) {
      el.innerHTML = '<div class="db">' + controlsHtml() + RP.emptyState('No figures yet', 'There are no figures for FY ' + C.fyLabel(sel.fy, ys) + ' with these filters.') + '</div>';
      bind();
      return { destroy: destroy };
    }
    const P = dst.period;

    /* ---------- breakdown for the chosen period ---------- */
    const members = dim === 'item' ? ds.itemNames.slice() : allBranches.slice();
    const isOthersItem = function (n) { return dim === 'item' && /^others?$/i.test(n); };
    const rows = members.map(function (n) { return { name: n, v: memberVal(n, P) }; })
      .filter(function (r) { return r.v !== null && r.v !== 0; });
    const named = rows.filter(function (r) { return !isOthersItem(r.name); }).sort(function (a, b) { return b.v - a.v; });
    const topN = dst.topN || defaultTop;
    const canFold = additive && named.length > topN;
    let shown = canFold ? named.slice(0, topN) : named.slice();
    const grand = additive ? grandFor(P) : totalVal(P);
    if (additive) {
      const topSum = shown.reduce(function (a, r) { return a + r.v; }, 0);
      let othersV;
      if (dim === 'item' && sm.top && sm.top.totalCode && sm.top.code === M.code && grand !== null && grand !== totalVal(P)) othersV = grand - topSum;
      else othersV = rows.filter(function (r) { return shown.indexOf(r) === -1; }).reduce(function (a, r) { return a + r.v; }, 0);
      if (Math.abs(othersV) > 1e-9) shown.push({ name: dim === 'item' ? 'Others' : 'Other branches', v: othersV, others: true });
    }
    const names = shown.map(function (r) { return r.name; });

    // Colour follows the member: its place in the list (or branch order), never its rank this month.
    const colors = {};
    (function assign() {
      const used = {};
      shown.forEach(function (r) {
        if (r.others) return;
        const idx = members.indexOf(r.name);
        let c = PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
        if (used[c]) c = PALETTE.find(function (x) { return !used[x]; }) || c;
        used[c] = true; colors[r.name] = c;
      });
    })();
    const colorOf = function (n) { return colors[n] || (n === 'Others' || n === 'Other branches' ? OTHERS_COLOR : PALETTE[Math.max(0, members.indexOf(n)) % PALETTE.length]); };

    // Drill-down subject: chosen, or the top member.
    if (!dst.focus || members.indexOf(dst.focus) === -1 || (memberVal(dst.focus, P) === null && !named.some(function (r) { return r.name === dst.focus; }))) {
      dst.focus = dim === 'branch' && branchSel ? branchSel : (named[0] ? named[0].name : '');
      remember(key, dst);
    }
    const F = dst.focus;

    /* ---------- formatting ---------- */
    const fmt = function (x) { return x === null || x === undefined ? '—' : C.formatValue(x, M.type, s); };
    const chartNum = function (x) { return x === null ? null : (M.type === 'amount' ? x / factor : x); };
    const chartLabel = function (x) {
      if (x === null || x === undefined) return '';
      if (M.type === 'amount') return (x / factor).toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
      return C.formatValue(x, M.type, s);
    };
    const unitWord = M.type === 'amount' ? C.unitLabel(s) : (isPct ? '%' : '');
    const unitSuffix = M.type === 'amount' && s.unit !== 'rupees' ? (s.unit === 'lakhs' ? ' L' : ' Cr') : '';
    function change(a, b) {
      if (a === null || b === null || b === undefined) return null;
      if (isPct) return { pts: a - b };
      if (b === 0) return null;
      return { pct: (a - b) / Math.abs(b) * 100 };
    }
    function changeText(c) { if (!c) return '—'; const x = c.pts !== undefined ? c.pts : c.pct; return (x > 0 ? '+' : '') + x.toFixed(1) + (c.pts !== undefined ? ' pts' : '%'); }
    function dir(c) { if (!c) return ''; const x = c.pts !== undefined ? c.pts : c.pct; return Math.abs(x) < 0.05 ? 'flat' : (x > 0 ? 'up' : 'down'); }
    function chip(c) { const d = dir(c); if (!d) return '<span class="db-chip">no earlier figure</span>'; return '<span class="db-chip db-' + d + '">' + (d === 'up' ? '▲' : d === 'down' ? '▼' : '■') + ' ' + esc(changeText(c)) + '</span>'; }
    const short = function (p) { return isDate ? C.dateLabel(p) : C.MONTHS[Number(p.slice(5, 7)) - 1] + '-' + p.slice(2, 4); };
    const share = function (x, t) { return additive && x !== null && t ? (x / t * 100).toFixed(1) + '%' : ''; };

    /* ---------- comparison periods ---------- */
    const prevP = function (p) { return isDate ? ds.prevPeriod(p) : C.monthAdd(p, -1); };
    const qP = function (p) { return isDate ? null : C.monthAdd(p, -3); };
    const lyP = function (p) { return isDate ? (Number(p.slice(0, 4)) - 1) + p.slice(4) : C.monthAdd(p, -12); };
    const ytd = function (p) { return fyPeriods.filter(function (x) { return x <= p; }); };
    const isLoaded = function (p) { return !!p && loaded.indexOf(p) !== -1; };

    /* ================= HTML ================= */
    function controlsHtml() {
      const opts = fyPeriods.slice().reverse().map(function (p) {
        return '<option value="' + esc(p) + '"' + (p === dst.period ? ' selected' : '') + '>' + esc(label(p)) + (hasData(p) ? '' : ' (no figures)') + '</option>';
      }).join('');
      const i = fyPeriods.indexOf(dst.period);
      return '<section class="panel db-controls">' +
        '<div class="field"><label for="db-period">' + (isDate ? 'Date' : 'Month') + '</label><div class="with-steps">' +
          '<button class="btn btn-quiet icon-btn" type="button" data-step="-1" aria-label="Earlier"' + (i <= 0 ? ' disabled' : '') + '>‹</button>' +
          '<select id="db-period">' + opts + '</select>' +
          '<button class="btn btn-quiet icon-btn" type="button" data-step="1" aria-label="Later"' + (i < 0 || i >= fyPeriods.length - 1 ? ' disabled' : '') + '>›</button></div></div>' +
        (measures.length > 1 ? '<div class="field"><label for="db-measure">Measure</label><select id="db-measure">' + measures.map(function (m) {
          return '<option value="' + esc(m.code) + '"' + (m.code === dst.measure ? ' selected' : '') + '>' + esc(m.label) + '</option>'; }).join('') + '</select></div>' : '') +
        (dim === 'item' && additive && ds.itemNames.length > 6 ? '<div class="field"><label for="db-topn">Show</label><select id="db-topn">' + [[6, 'Top 6 + Others'], [8, 'Top 8 + Others'], [10, 'Top 10 + Others'], [999, 'Every ' + oneWord]].map(function (x) {
          return '<option value="' + x[0] + '"' + ((dst.topN || defaultTop) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' : '') +
        '</section>';
    }

    function crumbsHtml() {
      const parts = [];
      if (sel.branch) parts.push('<span>' + esc(sel.branch) + '</span>');
      else parts.push(dst.branch ? '<button type="button" class="db-link" data-act="all-branches">All branches</button>' : '<span>All branches</span>');
      if (dst.branch && !sel.branch) parts.push('<span>' + esc(dst.branch) + '</span>');
      parts.push('<b>' + esc(label(P)) + '</b>');
      if (F) parts.push('<b>' + esc(F) + '</b>');
      return '<nav class="db-crumbs" aria-label="Dashboard path">' + parts.join('<span class="db-sep" aria-hidden="true">›</span>') + '</nav>';
    }

    function stripHtml() {
      return '<section class="panel panel-flush db-strip"><div class="table-wrap"><table class="table">' +
        '<thead><tr><th scope="col">' + esc(dim === 'item' ? (list ? list.name : 'Item') : 'Branch') + '</th>' + shown.map(function (r) {
          return '<th scope="col" class="num' + (r.name === F ? ' db-on' : '') + '">' + (r.others ? '' : '<button type="button" class="db-link" data-focus="' + esc(r.name) + '">') +
            '<span class="db-sw" style="background:' + colorOf(r.name) + '"></span>' + esc(r.name) + (r.others ? '' : '</button>') + '</th>'; }).join('') +
        (additive ? '<th scope="col" class="num">Total</th>' : '') + '</tr></thead><tbody>' +
        '<tr><th scope="row">' + esc(M.label) + (unitWord && M.type === 'amount' ? ' (' + esc(unitWord) + ')' : '') + '</th>' + shown.map(function (r) { return '<td class="num">' + esc(fmt(r.v)) + '</td>'; }).join('') +
          (additive ? '<td class="num"><b>' + esc(fmt(grand)) + '</b></td>' : '') + '</tr>' +
        (additive ? '<tr class="db-share-row"><th scope="row">% share</th>' + shown.map(function (r) { return '<td class="num">' + share(r.v, grand) + '</td>'; }).join('') + '<td class="num">100%</td></tr>' : '') +
        '</tbody></table></div></section>';
    }

    function kpiCard(k, val, sub, cls) {
      return '<div class="db-kpi' + (cls ? ' ' + cls : '') + '"><div class="db-k">' + esc(k) + '</div><div class="db-v">' + val + '</div><div class="db-s">' + (sub || '') + '</div></div>';
    }
    function deltaCard(k, c, sub) { return kpiCard(k, c ? '<span class="db-' + dir(c) + '">' + esc(changeText(c)) + '</span>' : '—', sub); }
    const big = function (x) { return esc(fmt(x)) + (unitSuffix ? '<small>' + unitSuffix + '</small>' : ''); };

    function kpisHtml() {
      const pp = prevP(P), ly = lyP(P);
      const prevV = isLoaded(pp) ? totalVal(pp) : null, lyV = isLoaded(ly) ? totalVal(ly) : null;
      const cards = [];
      cards.push(kpiCard(additive && !/^total/i.test(M.label) ? 'Total ' + M.label.toLowerCase() : M.label, big(grand), chip(change(grand, prevV)) + ' vs ' + (pp ? esc(short(pp)) : 'earlier')));
      const best = named[0], worst = named[named.length - 1];
      cards.push(kpiCard(additive ? 'Top ' + oneWord : 'Highest', best ? '<span class="db-name">' + esc(best.name) + '</span>' : '—',
        best ? (additive ? share(best.v, grand) + ' share · ' : '') + esc(fmt(best.v)) + unitSuffix : ''));
      if (additive) {
        cards.push(kpiCard(dimWord + ' with figures', String(rows.length), 'in ' + esc(label(P))));
        cards.push(kpiCard('Average per ' + oneWord, big(rows.length ? grand / rows.length : null), 'total ÷ ' + dimWord.toLowerCase() + ' with figures'));
      } else {
        cards.push(kpiCard('Lowest', worst ? '<span class="db-name">' + esc(worst.name) + '</span>' : '—', worst ? esc(fmt(worst.v)) : ''));
        cards.push(kpiCard(dimWord + ' with figures', String(rows.length), 'in ' + esc(label(P))));
      }
      cards.push(deltaCard(isDate ? 'vs previous date' : 'vs last month', change(grand, prevV), pp && isLoaded(pp) ? esc(label(pp)) + ': ' + esc(fmt(prevV)) + unitSuffix : 'no earlier figures loaded'));
      cards.push(deltaCard('vs last year', change(grand, lyV), lyV !== null ? esc(label(ly)) + ': ' + esc(fmt(lyV)) + unitSuffix : 'no figures a year earlier'));
      if (!isDate && additive) {
        const y = ytd(P), yv = totalOver(y), lyv = totalOver(y.map(lyP));
        cards.push(kpiCard('FY to date', big(yv), chip(change(yv, lyv)) + ' vs last FY to date'));
      }
      return '<div class="db-kpis">' + cards.join('') + '</div>';
    }
    function totalOver(periods) {
      if (dim === 'item') return v(M.code, periods, brs);
      return v(M.code, periods, branchSel && !additive ? [branchSel] : allBranches);
    }

    function panel(id, title, hint, extra, cls) {
      return '<section class="panel db-panel' + (cls ? ' ' + cls : '') + '"><div class="db-ph"><h2>' + title + '</h2>' + (extra || '') + (hint ? '<span class="db-hint">' + esc(hint) + '</span>' : '') + '</div>' +
        '<div class="db-box"><canvas id="' + id + '" role="img" aria-label="' + esc(title.replace(/<[^>]+>/g, '')) + '"></canvas></div></section>';
    }

    function drillHtml() {
      if (!F) return '';
      const isItem = dim === 'item';
      const fv = memberVal(F, P);
      const pp = prevP(P), q = qP(P), ly = lyP(P);
      const f = function (p) { return isLoaded(p) ? memberVal(F, p) : null; };
      const cards = [
        kpiCard(M.label, big(fv), esc(label(P))),
        additive ? kpiCard('Contribution', share(fv, grand) || '—', 'of ' + esc(isItem ? (branchSel || 'all-branch') : 'all-branch') + ' ' + esc(M.label.toLowerCase())) : '',
        deltaCard(isDate ? 'vs previous date' : 'vs last month', change(fv, f(pp)), isLoaded(pp) ? esc(label(pp)) + ': ' + esc(fmt(f(pp))) + unitSuffix : ''),
        q ? deltaCard('vs last quarter', change(fv, f(q)), isLoaded(q) ? esc(label(q)) + ': ' + esc(fmt(f(q))) + unitSuffix : '') : '',
        deltaCard('vs last year', change(fv, f(ly)), isLoaded(ly) ? esc(label(ly)) + ': ' + esc(fmt(f(ly))) + unitSuffix : ''),
        !isDate && additive ? kpiCard('FY to date', big(isItem ? v(M.code, ytd(P), brs, [F]) : v(M.code, ytd(P), [F])), share(isItem ? v(M.code, ytd(P), brs, [F]) : v(M.code, ytd(P), [F]), totalOver(ytd(P))) + ' of FY ' + esc(M.label.toLowerCase())) : '',
      ].join('');
      const chips = named.slice(0, 12).map(function (r) {
        return '<button type="button" class="db-pill' + (r.name === F ? ' is-on' : '') + '" data-focus="' + esc(r.name) + '">' + esc(r.name) + '</button>'; }).join('');
      const showBranchSplit = isItem && allBranches.length > 1;
      return '<section class="db-drill" id="db-drill">' +
        '<div class="db-dh"><h2><span class="db-sw db-sw-lg" style="background:' + colorOf(F) + '"></span>' + esc(F) + ' drill-down <span class="db-dsub">' +
          esc(isItem ? (branchSel || 'All branches') : '') + (isItem ? ' · ' : '') + esc(label(P)) + '</span></h2><div class="db-pills" role="group" aria-label="Choose what to drill into">' + chips + '</div></div>' +
        '<div class="db-kpis">' + cards + '</div>' +
        '<div class="db-grid' + (showBranchSplit ? '' : ' db-one') + '">' +
          panel('db-trend', 'Trend', '', '<div class="db-tools"><label class="check db-check"><input type="checkbox" id="db-all-labels"' + (dst.allLabels ? ' checked' : '') + '> Label every point</label>' +
            '<div class="db-seg" role="group" aria-label="Range"><button type="button" data-range="fy" class="' + (dst.range === 'fy' ? 'is-on' : '') + '">This FY</button><button type="button" data-range="24" class="' + (dst.range !== 'fy' ? 'is-on' : '') + '">24 months</button></div></div>', 'db-tall') +
          (showBranchSplit ? panel('db-split', 'Branch contribution', esc(F) + ' · ' + label(P) + ' · click a branch to filter', '', 'db-tall') : '') +
        '</div>' + drillTableHtml() + '</section>';
    }

    function drillTableHtml() {
      const isItem = dim === 'item';
      const upto = loaded.filter(function (p) { return p <= P; }).slice(-12);
      const perBranch = isItem && !branchSel && allBranches.length > 1 && allBranches.length <= 8;
      const f = function (p) { return isLoaded(p) ? memberVal(F, p) : null; };
      const cell = function (c) { return c ? '<span class="db-' + dir(c) + '">' + esc(changeText(c)) + '</span>' : '—'; };
      return '<section class="panel panel-flush db-table"><div class="db-ph db-ph-pad"><h2>' + esc(F) + ' ' + (isDate ? 'by date' : 'month by month') + '</h2><span class="db-hint">Last ' + upto.length + ' ' + (isDate ? 'dates' : 'months') + ' · selected highlighted</span></div>' +
        '<div class="table-wrap"><table class="table report-table"><thead><tr><th scope="col">' + (isDate ? 'Date' : 'Month') + '</th><th scope="col" class="num">' + esc(M.label) + '</th>' +
        '<th scope="col" class="num">vs previous</th><th scope="col" class="num">vs last year</th>' + (additive ? '<th scope="col" class="num">Share</th>' : '') +
        (perBranch ? allBranches.map(function (b) { return '<th scope="col" class="num">' + esc(b) + '</th>'; }).join('') : '') + '</tr></thead><tbody>' +
        upto.map(function (p) {
          const x = f(p);
          return '<tr' + (p === P ? ' class="db-row-on"' : '') + '><th scope="row">' + esc(label(p)) + '</th><td class="num"><b>' + esc(fmt(x)) + '</b></td>' +
            '<td class="num">' + cell(change(x, f(prevP(p)))) + '</td><td class="num">' + cell(change(x, f(lyP(p)))) + '</td>' +
            (additive ? '<td class="num">' + share(x, isItem ? v(M.code, [p], brs) : totalVal(p)) + '</td>' : '') +
            (perBranch ? allBranches.map(function (b) { return '<td class="num">' + esc(fmt(v(M.code, [p], [b], [F]))) + '</td>'; }).join('') : '') + '</tr>';
        }).join('') + '</tbody></table></div></section>';
    }

    function draw() {
      destroyCharts();
      const isItem = dim === 'item';
      const showDonut = additive && shown.length > 1 && shown.every(function (r) { return r.v >= 0; });
      const showBranches = isItem && allBranches.length > 1;
      el.innerHTML = '<div class="db">' + controlsHtml() + crumbsHtml() + stripHtml() + kpisHtml() +
        '<div class="db-grid' + (showDonut ? '' : ' db-one') + '">' +
          panel('db-bar', esc(M.label) + ' by ' + esc(isItem ? (list ? list.name : 'item') : 'branch') + (unitWord ? ' <span class="db-unit">(' + esc(unitWord) + ')</span>' : ''), 'Click a bar to drill down') +
          (showDonut ? panel('db-donut', 'Share (%)', 'Click a slice to drill down') : '') +
        '</div>' +
        '<div class="db-grid' + (showBranches ? '' : ' db-one') + '">' +
          (showBranches ? panel('db-branches', esc(M.label) + ' by branch', 'Click a branch to filter; click again for all') : '') +
          panel('db-months', (isDate ? 'By date' : 'By month') + ', last ' + Math.min(12, loaded.filter(function (p) { return p <= P; }).length) + (isDate ? ' dates' : ' months'), 'Click a ' + (isDate ? 'date' : 'month') + ' to show it') +
        '</div>' +
        drillHtml() +
        '<p class="muted small">' + (M.type === 'amount' ? 'Amounts in ' + esc(C.unitLabel(s)) + '. ' : '') +
          (isDate ? '' : '“vs last quarter” compares with the same month three months earlier. ') +
          'Totals and calculated fields are recalculated from the data, never added up.' + (canFold ? ' Others includes every ' + oneWord + ' outside the top ' + topN + '.' : '') + '</p>' +
        '</div>';
      bind();
      if (typeof Chart === 'undefined') return;
      drawBar(); if (showDonut) drawDonut(); if (showBranches) drawBranches(); drawMonths(); if (F) { drawTrend(); if (isItem && allBranches.length > 1) drawSplit(); }
    }

    /* ================= charts ================= */
    const anim = RP.reduceMotion ? false : { duration: 250 };
    const tip = { backgroundColor: INK, padding: 10, cornerRadius: 6, boxPadding: 4 };
    const pointer = function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    function mk(id, cfg) {
      const cv = document.getElementById(id); if (!cv) return null;
      cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: anim, onHover: pointer }, cfg.options || {});
      cfg.options.plugins = Object.assign({ legend: { display: false } }, cfg.options.plugins || {});
      const ch = new Chart(cv, cfg); charts.push(ch); live.push(ch); return ch;
    }
    const valueAxis = function () { return { beginAtZero: true, grid: { color: GRID }, border: { display: false }, title: { display: !!unitWord, text: unitWord } }; };
    const labels = function (extra) { return Object.assign({ display: true, color: INK, font: { weight: 600, size: 11 }, formatter: function (x) { return chartLabel(M.type === 'amount' ? x * factor : x); } }, extra || {}); };

    function drawBar() {
      const data = shown.map(function (r) { return chartNum(r.v); });
      mk('db-bar', {
        type: 'bar',
        data: { labels: names, datasets: [{ data: data, backgroundColor: names.map(colorOf),
          borderColor: names.map(function (n) { return n === F ? INK : 'transparent'; }), borderWidth: names.map(function (n) { return n === F ? 2 : 0; }),
          borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 56 }] },
        options: {
          layout: { padding: { top: 22 } },
          onClick: function (e, els) { if (els.length && !shown[els[0].index].others) setFocus(names[els[0].index], true); },
          scales: { y: valueAxis(), x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45, font: { size: 11 } } } },
          plugins: { tooltip: Object.assign({}, tip, { callbacks: { label: function (c) { const r = shown[c.dataIndex]; return ' ' + fmt(r.v) + unitSuffix + (additive ? ' · ' + share(r.v, grand) + ' share' : ''); } } }),
            datalabels: labels({ anchor: 'end', align: 'end', offset: 2 }) },
        },
      });
    }
    function drawDonut() {
      mk('db-donut', {
        type: 'doughnut',
        data: { labels: names, datasets: [{ data: shown.map(function (r) { return chartNum(r.v); }), backgroundColor: names.map(colorOf), borderColor: '#fff', borderWidth: 2,
          offset: names.map(function (n) { return n === F ? 10 : 0; }), hoverOffset: 6 }] },
        options: {
          cutout: '58%', layout: { padding: 12 },
          onClick: function (e, els) { if (els.length && !shown[els[0].index].others) setFocus(names[els[0].index], true); },
          plugins: {
            legend: { display: true, position: 'right', labels: { boxWidth: 10, boxHeight: 10, font: { size: 12 },
              generateLabels: function (ch) { return names.map(function (n, i) { return { text: n + ' (' + share(shown[i].v, grand) + ')', fillStyle: colorOf(n), strokeStyle: colorOf(n), index: i, hidden: false }; }); } },
              onClick: function (e, item) { if (!shown[item.index].others) setFocus(names[item.index], true); } },
            tooltip: Object.assign({}, tip, { callbacks: { label: function (c) { const r = shown[c.dataIndex]; return ' ' + r.name + ': ' + fmt(r.v) + unitSuffix + ' (' + share(r.v, grand) + ')'; } } }),
            datalabels: { display: function (c) { return grand && shown[c.dataIndex].v / grand >= (printing ? 0.10 : 0.04); }, color: '#fff', font: { weight: 700, size: 12 },
              textStrokeColor: 'rgba(0,0,0,.35)', textStrokeWidth: 2, formatter: function (x, c) { return Math.round(shown[c.dataIndex].v / grand * 100) + '%'; } },
          },
        },
      });
    }
    function hbar(id, branchVals, color, total, tipWord) {
      mk(id, {
        type: 'bar',
        data: { labels: allBranches, datasets: [{ data: branchVals.map(chartNum),
          backgroundColor: allBranches.map(function (b) { return !branchSel || b === branchSel ? color : color + '55'; }),
          borderRadius: 4, borderSkipped: 'left', maxBarThickness: 26 }] },
        options: {
          indexAxis: 'y', layout: { padding: { right: 96 } },
          onClick: function (e, els) { if (els.length) setBranch(allBranches[els[0].index]); },
          scales: { x: valueAxis(), y: { grid: { display: false }, ticks: { autoSkip: false, font: { weight: 600 } } } },
          plugins: { tooltip: Object.assign({}, tip, { callbacks: { label: function (c) { const x = branchVals[c.dataIndex]; return ' ' + fmt(x) + unitSuffix + (additive && total ? ' · ' + share(x, total) + ' of ' + tipWord : ''); } } }),
            datalabels: labels({ anchor: 'end', align: 'end', offset: 4, clip: false,
              formatter: function (x, c) { const raw = branchVals[c.dataIndex]; return raw === null ? '' : chartLabel(raw) + (additive && total ? '  (' + Math.round(raw / total * 100) + '%)' : ''); } }) },
        },
      });
    }
    function drawBranches() {
      const vals = allBranches.map(function (b) { return v(M.code, [P], [b]); });
      const t = v(M.code, [P], allBranches);
      hbar('db-branches', vals, PALETTE[2], t, 'all branches');
    }
    function drawMonths() {
      const ps = loaded.filter(function (p) { return p <= P; }).slice(-12);
      const vals = ps.map(totalVal);
      let hi = -1, lo = -1;
      vals.forEach(function (x, i) { if (x === null) return; if (hi < 0 || x > vals[hi]) hi = i; if (lo < 0 || x < vals[lo]) lo = i; });
      mk('db-months', {
        type: 'bar',
        data: { labels: ps.map(short), datasets: [{ data: vals.map(chartNum), backgroundColor: ps.map(function (p) { return p === P ? PALETTE[0] : '#A9CFCB'; }), borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 34 }] },
        options: {
          layout: { padding: { top: 20 } },
          onClick: function (e, els) { if (els.length) { const p = ps[els[0].index]; if (fyPeriods.indexOf(p) !== -1) setPeriod(p); else RP.toast('That ' + (isDate ? 'date' : 'month') + ' is in the previous year. Change Year at the top to see it.'); } },
          scales: { y: valueAxis(), x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 11 } } } },
          plugins: { tooltip: Object.assign({}, tip, { displayColors: false, callbacks: { title: function (c) { return label(ps[c[0].dataIndex]); }, label: function (c) { return fmt(vals[c.dataIndex]) + unitSuffix; } } }),
            datalabels: labels({ anchor: 'end', align: 'end', offset: 1, color: INK2, font: { size: 10, weight: 600 },
              display: function (c) { return vals[c.dataIndex] !== null && (!printing || c.dataIndex === hi || c.dataIndex === lo || ps[c.dataIndex] === P); },
              formatter: function (x) { return x === null ? '' : Math.round(x).toLocaleString(loc); } }) },
        },
      });
    }
    function drawTrend() {
      const ps = (dst.range === 'fy' ? fyPeriods : loaded).filter(function (p) { return p <= P || dst.range === 'fy'; });
      const vals = ps.map(function (p) { return memberVal(F, p); });
      const idxP = ps.indexOf(P);
      let mx = -1, mn = -1;
      vals.forEach(function (x, i) { if (x === null) return; if (mx < 0 || x > vals[mx]) mx = i; if (mn < 0 || x < vals[mn]) mn = i; });
      let last = -1; vals.forEach(function (x, i) { if (x !== null) last = i; });
      const key = [mx, mn, idxP, last];
      const col = colorOf(F);
      mk('db-trend', {
        type: 'line',
        data: { labels: ps.map(short), datasets: [{ data: vals.map(chartNum), borderColor: col, backgroundColor: col + '22', fill: true, tension: 0.3, borderWidth: 2, spanGaps: true,
          pointRadius: ps.map(function (p) { return p === P ? 6 : 3; }), pointHoverRadius: 7,
          pointBackgroundColor: ps.map(function (p) { return p === P ? INK : col; }), pointBorderColor: '#fff', pointBorderWidth: 2 }] },
        options: {
          layout: { padding: { top: 24, right: 18 } }, interaction: { mode: 'index', intersect: false },
          onClick: function (e, els) { if (els.length) { const p = ps[els[0].index]; if (fyPeriods.indexOf(p) !== -1) setPeriod(p); } },
          scales: { y: valueAxis(), x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } } } },
          plugins: { tooltip: Object.assign({}, tip, { displayColors: false, callbacks: { title: function (c) { return label(ps[c[0].dataIndex]); },
            label: function (c) { const x = vals[c.dataIndex], pv = memberVal(F, prevP(ps[c.dataIndex]) || ''); const ch = isLoaded(prevP(ps[c.dataIndex])) ? change(x, pv) : null; return fmt(x) + unitSuffix + (ch ? '  (' + changeText(ch) + ' vs previous)' : ''); } } }),
            datalabels: labels({ display: function (c) { return vals[c.dataIndex] !== null && (dst.allLabels || key.indexOf(c.dataIndex) !== -1); }, align: 'top', offset: 4,
              font: function (c) { return { size: dst.allLabels ? 9.5 : 11, weight: c.dataIndex === idxP ? 700 : 600 }; } }) },
        },
      });
    }
    function drawSplit() {
      const vals = allBranches.map(function (b) { return v(M.code, [P], [b], [F]); });
      const t = vals.reduce(function (a, x) { return a + (x || 0); }, 0);
      hbar('db-split', vals, colorOf(F), t, F);
    }

    /* ================= events ================= */
    function save() { remember(key, dst); }
    function setFocus(n, scroll) { dst.focus = n; save(); redraw(); if (scroll) { const d = document.getElementById('db-drill'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: RP.reduceMotion ? 'auto' : 'smooth', block: 'start' }); } }
    function setPeriod(p) { dst.period = p; save(); redraw(); }
    function setBranch(b) {
      if (dim !== 'item') { setFocus(b, true); return; }
      if (sel.branch) { RP.toast('Branch is set to ' + sel.branch + ' in the filters above.'); return; }
      dst.branch = dst.branch === b ? '' : b; save(); redraw();
    }
    function redraw() { const y = window.scrollY; destroyCharts(); const h = render(el, o); handle.destroy = h.destroy; window.scrollTo(0, y); }
    function bind() {
      const q = function (sel2) { return el.querySelector(sel2); };
      const ps = q('#db-period'); if (ps) ps.addEventListener('change', function (e) { setPeriod(e.target.value); });
      el.querySelectorAll('[data-step]').forEach(function (b) { b.addEventListener('click', function () {
        const i = fyPeriods.indexOf(dst.period) + Number(b.dataset.step); if (i >= 0 && i < fyPeriods.length) setPeriod(fyPeriods[i]); }); });
      const ms = q('#db-measure'); if (ms) ms.addEventListener('change', function (e) { dst.measure = e.target.value; dst.focus = ''; save(); redraw(); });
      const tn = q('#db-topn'); if (tn) tn.addEventListener('change', function (e) { dst.topN = Number(e.target.value); save(); redraw(); });
      el.querySelectorAll('[data-focus]').forEach(function (b) { b.addEventListener('click', function () { setFocus(b.dataset.focus, !b.closest('.db-pills')); }); });
      const ab = q('[data-act="all-branches"]'); if (ab) ab.addEventListener('click', function () { dst.branch = ''; save(); redraw(); });
      const al = q('#db-all-labels'); if (al) al.addEventListener('change', function (e) { dst.allLabels = e.target.checked; save(); redraw(); });
      el.querySelectorAll('[data-range]').forEach(function (b) { b.addEventListener('click', function () { dst.range = b.dataset.range; save(); redraw(); }); });
    }
    function destroyCharts() {
      charts.forEach(function (c) { const i = live.indexOf(c); if (i !== -1) live.splice(i, 1); c.destroy(); });
      charts = [];
    }
    function destroy() { destroyCharts(); }

    const handle = { destroy: destroy };
    draw();
    return handle;
  }

  window.RPDashboard = { render: render };
})();
