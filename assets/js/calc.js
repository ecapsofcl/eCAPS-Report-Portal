/* Report Portal - formulas, periods and calculations shared by the entry and report screens.
 *
 * A Dataset holds one report's definition and records. A Ctx (context) is a
 * slice of it: a set of periods, branches and (optionally) items. Every value
 * shown anywhere, from a single cell to a yearly total, is "field X in context Y",
 * so totals are always recalculated from the underlying data, never added up. */
window.RPCalc = (function () {
  'use strict';

  const FUNCTIONS = { PCT: 2, GROWTH: 2, PREV: 1, LY: 1, YTD: 1, MIN: -1, MAX: -1, ROUND: 2, IF: 3, LINK: 2, ABS: 1 };
  const NUMERIC = ['amount', 'number', 'quantity', 'percent'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------- formula parser ---------------- */

  function FormulaError(msg) { const e = new Error(msg); e.formula = true; return e; }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < src.length && /[0-9.]/.test(src[j])) j++;
        const v = Number(src.slice(i, j));
        if (!isFinite(v)) throw FormulaError('"' + src.slice(i, j) + '" is not a number.');
        toks.push({ t: 'num', v: v });
        i = j;
        continue;
      }
      if (c === '"') {
        const j = src.indexOf('"', i + 1);
        if (j < 0) throw FormulaError('A text value is missing its closing quote.');
        toks.push({ t: 'str', v: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j) });
        i = j;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '<>') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/(),<>='.indexOf(c) !== -1) { toks.push({ t: 'op', v: c }); i++; continue; }
      throw FormulaError('"' + c + '" cannot be used in a formula.');
    }
    return toks;
  }

  function parse(src) {
    const toks = tokenize(String(src || ''));
    if (!toks.length) throw FormulaError('The formula is empty.');
    let pos = 0;
    const peek = function () { return toks[pos]; };
    const isOp = function (v) { return toks[pos] && toks[pos].t === 'op' && toks[pos].v === v; };
    function expect(v) {
      if (!isOp(v)) throw FormulaError('Expected "' + v + '"' + (toks[pos] ? ' before "' + (toks[pos].v) + '".' : ' at the end.'));
      pos++;
    }
    function comparison() {
      let a = additive();
      if (peek() && peek().t === 'op' && ['>', '<', '>=', '<=', '=', '<>'].indexOf(peek().v) !== -1) {
        const op = toks[pos++].v;
        a = { t: 'bin', op: op, a: a, b: additive() };
      }
      return a;
    }
    function additive() {
      let a = term();
      while (isOp('+') || isOp('-')) { const op = toks[pos++].v; a = { t: 'bin', op: op, a: a, b: term() }; }
      return a;
    }
    function term() {
      let a = unary();
      while (isOp('*') || isOp('/')) { const op = toks[pos++].v; a = { t: 'bin', op: op, a: a, b: unary() }; }
      return a;
    }
    function unary() {
      if (isOp('-')) { pos++; return { t: 'neg', a: unary() }; }
      if (isOp('+')) { pos++; return unary(); }
      return primary();
    }
    function primary() {
      const tk = toks[pos];
      if (!tk) throw FormulaError('The formula ends too early.');
      if (tk.t === 'num') { pos++; return { t: 'num', v: tk.v }; }
      if (tk.t === 'str') { pos++; return { t: 'str', v: tk.v }; }
      if (tk.t === 'id') {
        pos++;
        if (isOp('(')) {
          pos++;
          const name = tk.v.toUpperCase();
          if (!(name in FUNCTIONS)) throw FormulaError(tk.v + ' is not a known function.');
          const args = [];
          if (!isOp(')')) {
            args.push(comparison());
            while (isOp(',')) { pos++; args.push(comparison()); }
          }
          expect(')');
          const n = FUNCTIONS[name];
          if (n > 0 && args.length !== n) throw FormulaError(name + ' needs ' + n + ' value' + (n > 1 ? 's' : '') + '.');
          if (n < 0 && args.length < 1) throw FormulaError(name + ' needs at least one value.');
          if (name === 'LINK' && (args[0].t !== 'str' || args[1].t !== 'ref')) {
            throw FormulaError('Write LINK as LINK("Report name", FIELD_CODE).');
          }
          return { t: 'fn', name: name, args: args };
        }
        return { t: 'ref', v: tk.v };
      }
      if (isOp('(')) { pos++; const e = comparison(); expect(')'); return e; }
      throw FormulaError('"' + tk.v + '" is in the wrong place.');
    }
    const ast = comparison();
    if (pos < toks.length) throw FormulaError('"' + toks[pos].v + '" is in the wrong place.');
    return ast;
  }

  // Checks a formula against the report's codes. reportCodes(name) returns the
  // codes of another report for LINK, or null when no such report exists.
  function check(formula, codes, reportCodes) {
    const ast = parse(formula);
    const refs = [];
    (function walk(n, inLink) {
      if (!n) return;
      if (n.t === 'ref' && !inLink) {
        if (codes.indexOf(n.v) === -1) throw FormulaError(n.v + ' is not a field code in this report.');
        refs.push(n.v);
      }
      if (n.t === 'fn' && n.name === 'LINK') {
        const other = reportCodes ? reportCodes(n.args[0].v) : null;
        if (!other) throw FormulaError('There is no report named "' + n.args[0].v + '".');
        if (other.indexOf(n.args[1].v) === -1) throw FormulaError('The report "' + n.args[0].v + '" has no field ' + n.args[1].v + '.');
        return;
      }
      if (n.a) walk(n.a, inLink);
      if (n.b) walk(n.b, inLink);
      if (n.args) n.args.forEach(function (x) { walk(x, inLink); });
    })(ast, false);
    return refs;
  }

  /* ---------------- evaluation ---------------- */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function evaluate(n, ctx) {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'ref': return ctx.get(n.v);
      case 'neg': { const a = toNum(evaluate(n.a, ctx)); return a === null ? null : -a; }
      case 'bin': {
        const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
        if (['>', '<', '>=', '<=', '=', '<>'].indexOf(n.op) !== -1) {
          if (a === null || b === null) return n.op === '<>' ? a !== b : false;
          const x = isNum(a) && isNum(b) ? a : String(a), y = isNum(a) && isNum(b) ? b : String(b);
          switch (n.op) {
            case '>': return x > y; case '<': return x < y; case '>=': return x >= y;
            case '<=': return x <= y; case '=': return x === y; default: return x !== y;
          }
        }
        const x = toNum(a), y = toNum(b);
        if (n.op === '+' || n.op === '-') {
          if (x === null && y === null) return null;
          return n.op === '+' ? (x || 0) + (y || 0) : (x || 0) - (y || 0);
        }
        if (x === null || y === null) return null;
        if (n.op === '*') return x * y;
        return y === 0 ? null : x / y;
      }
      case 'fn': {
        const A = n.args;
        switch (n.name) {
          case 'PCT': { const a = toNum(evaluate(A[0], ctx)), b = toNum(evaluate(A[1], ctx)); return a === null || !b ? null : a / b * 100; }
          case 'GROWTH': { const a = toNum(evaluate(A[0], ctx)), b = toNum(evaluate(A[1], ctx)); return a === null || !b ? null : (a - b) / Math.abs(b) * 100; }
          case 'PREV': { const c = ctx.prev(); return c ? evaluate(A[0], c) : null; }
          case 'LY': { const c = ctx.lastYear(); return c ? evaluate(A[0], c) : null; }
          case 'YTD': { const c = ctx.ytd(); return c ? evaluate(A[0], c) : null; }
          case 'MIN': case 'MAX': {
            const vals = A.map(function (x) { return toNum(evaluate(x, ctx)); }).filter(function (v) { return v !== null; });
            return vals.length ? Math[n.name.toLowerCase()].apply(null, vals) : null;
          }
          case 'ROUND': { const a = toNum(evaluate(A[0], ctx)), d = toNum(evaluate(A[1], ctx)) || 0; if (a === null) return null; const f = Math.pow(10, d); return Math.round(a * f) / f; }
          case 'ABS': { const a = toNum(evaluate(A[0], ctx)); return a === null ? null : Math.abs(a); }
          case 'IF': { const c = evaluate(A[0], ctx); return (c === true || (isNum(c) && c !== 0)) ? evaluate(A[1], ctx) : evaluate(A[2], ctx); }
          case 'LINK': return ctx.link(A[0].v, A[1].v);
        }
      }
    }
    return null;
  }

  /* ---------------- periods ---------------- */

  function monthAdd(ym, n) {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return yy + '-' + String(mm + 1).padStart(2, '0');
  }
  function fyStartYear(period, yearStart) {
    const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
    return m >= yearStart ? y : y - 1;
  }
  function fyStartMonth(startYear, yearStart) { return startYear + '-' + String(yearStart).padStart(2, '0'); }
  function fyMonths(startYear, yearStart) {
    const first = fyStartMonth(startYear, yearStart);
    const out = [];
    for (let i = 0; i < 12; i++) out.push(monthAdd(first, i));
    return out;
  }
  function fyLabel(startYear, yearStart) {
    if (yearStart === 1) return String(startYear);
    return startYear + '-' + String(startYear + 1).slice(2);
  }
  function monthLabel(ym) { return MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
  function dateLabel(d) { return Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }
  function periodLabel(p) { return p.length > 7 ? dateLabel(p) : monthLabel(p); }

  // Which bucket a period belongs to at a view level.
  function bucketOf(period, level, yearStart) {
    if (level === 'date') return period;
    const ym = period.slice(0, 7);
    if (level === 'month') return ym;
    const start = fyStartYear(ym, yearStart);
    const idx = (Number(ym.slice(5, 7)) - yearStart + 12) % 12;
    if (level === 'quarter') return start + '-Q' + (Math.floor(idx / 3) + 1);
    if (level === 'half') return start + '-H' + (Math.floor(idx / 6) + 1);
    return start + '-Y';
  }
  function bucketLabel(bucket, level, yearStart) {
    if (level === 'date') return dateLabel(bucket);
    if (level === 'month') return monthLabel(bucket);
    const start = Number(bucket.slice(0, 4)), tag = bucket.slice(5);
    const first = fyStartMonth(start, yearStart);
    if (tag === 'Y') return 'FY ' + fyLabel(start, yearStart);
    const n = Number(tag.slice(1));
    const size = tag[0] === 'Q' ? 3 : 6;
    const a = monthAdd(first, (n - 1) * size), b = monthAdd(first, n * size - 1);
    return tag + ' (' + MONTHS[Number(a.slice(5)) - 1] + '–' + MONTHS[Number(b.slice(5)) - 1] + ')';
  }

  /* ---------------- datasets ---------------- */

  function Dataset(report, records, lists, linked) {
    this.report = report;
    this.settings = report.settings || {};
    this.yearStart = Number(this.settings.yearStart) || 4;
    this.isDate = this.settings.periodType === 'date';
    this.fields = {};
    (report.fields || []).forEach(function (f) { this.fields[f.code] = f; }, this);
    this.calcs = {};
    this.asts = {};
    (report.calcs || []).forEach(function (c) {
      this.calcs[c.code] = c;
      try { this.asts[c.code] = parse(c.formula); } catch (e) { this.asts[c.code] = null; }
    }, this);
    const list = this.settings.itemList && lists ? lists.find(function (l) { return l.id === this.settings.itemList; }, this) : null;
    this.hasItems = !!this.settings.itemList;
    this.items = list ? list.items : [];
    this.itemNames = this.items.map(function (i) { return i.name; });
    this.branches = report.branches || this.settings.branches || [];
    this.linked = {};
    this.linkedByName = {};
    (linked || []).forEach(function (l) {
      const ds = new Dataset(l.report, l.records, lists, null);
      this.linked[l.report.id] = ds;
      this.linkedByName[l.report.name.toLowerCase()] = ds;
    }, this);
    this.setRecords(records || []);
  }

  Dataset.prototype.setRecords = function (records) {
    this.records = records;
    this.index = {};
    const periods = {};
    records.forEach(function (r) { this._put(r); periods[r.p] = true; }, this);
    this.periods = Object.keys(periods).sort();
    this.cache = {};
  };
  Dataset.prototype._put = function (r) {
    const p = this.index[r.p] || (this.index[r.p] = {});
    const b = p[r.b] || (p[r.b] = {});
    b[r.i || ''] = r;
  };
  // Apply saved or deleted records returned by the server (or grid edits for previews).
  Dataset.prototype.upsert = function (recs) {
    const map = {};
    this.records.forEach(function (r) { map[r.p + '|' + r.b + '|' + (r.i || '')] = r; });
    recs.forEach(function (r) {
      const k = r.p + '|' + r.b + '|' + (r.i || '');
      if (r.deleted) delete map[k]; else map[k] = r;
    });
    this.setRecords(Object.keys(map).map(function (k) { return map[k]; }));
  };
  Dataset.prototype.raw = function (p, b, i, code) {
    const x = this.index[p] && this.index[p][b] && this.index[p][b][i || ''];
    if (!x || !(code in x.v)) return null;
    return x.v[code];
  };
  Dataset.prototype.hasAny = function (p, b) {
    const x = this.index[p] && this.index[p][b];
    return !!x && Object.keys(x).length > 0;
  };
  Dataset.prototype.linkFor = function (field, item) {
    return (field.links || []).find(function (l) { return l.item === item; }) || null;
  };
  // A typed value, or the figure from the linked report when that report has data for the month and branch.
  Dataset.prototype.effective = function (field, p, b, item) {
    const link = this.linkFor(field, item);
    if (link) {
      const src = this.linked[link.reportId];
      if (src && src.hasAny(p, b) && src.fields[link.field]) {
        const items = src.hasItems && src.itemNames.indexOf(item) !== -1 ? [item] : null;
        return src.value(link.field, src.ctx([p], [b], items));
      }
    }
    return this.raw(p, b, item, field.code);
  };
  Dataset.prototype.ctx = function (periods, branches, items) { return new Ctx(this, periods, branches, items); };

  Dataset.prototype.value = function (code, ctx) {
    const key = code + '#' + ctx.key;
    if (key in this.cache) return this.cache[key];
    let v = null;
    if (this.fields[code]) v = this._field(this.fields[code], ctx);
    else if (this.calcs[code]) {
      this.cache[key] = null; // guards against loops
      const ast = this.asts[code];
      v = ast ? evaluate(ast, ctx) : null;
      if (typeof v === 'number' && !isFinite(v)) v = null;
      if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
    }
    this.cache[key] = v;
    return v;
  };

  Dataset.prototype._field = function (f, ctx) {
    const numeric = NUMERIC.indexOf(f.type) !== -1;
    const perPeriod = [];
    ctx.periods.forEach(function (p) {
      let total = null, text = [];
      ctx.branches.forEach(function (b) {
        let itemList;
        if (!this.hasItems || f.level === 'branch') itemList = [''];
        else if (ctx.items) itemList = ctx.items;
        else {
          const present = this.index[p] && this.index[p][b] ? Object.keys(this.index[p][b]).filter(function (i) { return i; }) : [];
          (f.links || []).forEach(function (l) { if (present.indexOf(l.item) === -1) present.push(l.item); });
          itemList = present;
        }
        itemList.forEach(function (i) {
          const v = this.effective(f, p, b, i);
          if (v === null || v === undefined || v === '') return;
          if (numeric) total = (total || 0) + Number(v);
          else text.push(v);
        }, this);
      }, this);
      perPeriod.push(numeric ? total : (text.length === 1 ? text[0] : null));
    }, this);
    if (!numeric) return perPeriod.length === 1 ? perPeriod[0] : null;
    const vals = perPeriod.filter(function (v) { return v !== null; });
    if (!vals.length) return null;
    if (f.rollup === 'avg') return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    if (f.rollup === 'last') {
      for (let k = perPeriod.length - 1; k >= 0; k--) if (perPeriod[k] !== null) return perPeriod[k];
    }
    return vals.reduce(function (a, b) { return a + b; }, 0);
  };

  // Periods with a value for a field in a context (used for "average per month").
  Dataset.prototype.periodsWithData = function (code, ctx) {
    return ctx.periods.filter(function (p) { return this.value(code, this.ctx([p], ctx.branches, ctx.items)) !== null; }, this);
  };

  Dataset.prototype.prevPeriod = function (p) {
    if (!this.isDate) return monthAdd(p, -1);
    const i = this.periods.indexOf(p);
    if (i > 0) return this.periods[i - 1];
    const earlier = this.periods.filter(function (x) { return x < p; });
    return earlier.length ? earlier[earlier.length - 1] : null;
  };
  Dataset.prototype.ytdPeriods = function (p) {
    const start = fyStartMonth(fyStartYear(p.slice(0, 7), this.yearStart), this.yearStart);
    if (!this.isDate) {
      const out = [];
      let m = start;
      while (m <= p) { out.push(m); m = monthAdd(m, 1); }
      return out;
    }
    return this.periods.filter(function (x) { return x >= start && x <= p; });
  };

  function Ctx(ds, periods, branches, items) {
    this.ds = ds;
    this.periods = periods;
    this.branches = branches;
    this.items = items || null;
    this.key = periods.join(',') + '|' + branches.join(',') + '|' + (this.items ? this.items.join(',') : '*');
  }
  Ctx.prototype.get = function (code) { return this.ds.value(code, this); };
  Ctx.prototype.prev = function () {
    const ps = this.periods.map(this.ds.prevPeriod, this.ds).filter(Boolean);
    return ps.length ? this.ds.ctx(ps, this.branches, this.items) : null;
  };
  Ctx.prototype.lastYear = function () {
    const ps = this.periods.map(function (p) { return this.ds.isDate ? (Number(p.slice(0, 4)) - 1) + p.slice(4) : monthAdd(p, -12); }, this);
    return this.ds.ctx(ps, this.branches, this.items);
  };
  Ctx.prototype.ytd = function () {
    if (!this.periods.length) return null;
    const last = this.periods.slice().sort().pop();
    return this.ds.ctx(this.ds.ytdPeriods(last), this.branches, this.items);
  };
  Ctx.prototype.link = function (name, code) {
    const src = this.ds.linkedByName[String(name).toLowerCase()];
    if (!src || !src.fields[code]) return null;
    const items = this.items && src.hasItems && this.items.every(function (i) { return src.itemNames.indexOf(i) !== -1; }) ? this.items : null;
    const branches = this.branches.filter(function (b) { return src.branches.indexOf(b) !== -1; });
    return src.value(code, src.ctx(this.periods, branches, items));
  };

  /* ---------------- formatting ---------------- */

  const UNIT = { rupees: 1, lakhs: 1e5, crores: 1e7 };
  const UNIT_LABEL = { rupees: '₹', lakhs: '₹ lakhs', crores: '₹ crores' };

  function formatValue(v, type, settings) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return String(v);
    const dec = settings && settings.decimals !== undefined ? Number(settings.decimals) : 2;
    const loc = (window.CONFIG && CONFIG.LOCALE) || 'en-IN';
    switch (type) {
      case 'amount': {
        const f = UNIT[(settings && settings.unit) || 'rupees'] || 1;
        return (v / f).toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
      }
      case 'quantity': return Math.round(v).toLocaleString(loc);
      case 'percent': return v.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
      default: return v.toLocaleString(loc, { maximumFractionDigits: 2 });
    }
  }
  function exportValue(v, type, settings) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return String(v);
    if (type === 'amount') {
      const f = UNIT[(settings && settings.unit) || 'rupees'] || 1;
      const dec = settings && settings.decimals !== undefined ? Number(settings.decimals) : 2;
      return Math.round(v / f * Math.pow(10, dec)) / Math.pow(10, dec);
    }
    if (type === 'percent') return Math.round(v * 10) / 10;
    return v;
  }
  function unitLabel(settings) { return UNIT_LABEL[(settings && settings.unit) || 'rupees']; }

  return {
    FUNCTIONS: FUNCTIONS, NUMERIC: NUMERIC, MONTHS: MONTHS,
    parse: parse, check: check, evaluate: evaluate, Dataset: Dataset,
    monthAdd: monthAdd, fyStartYear: fyStartYear, fyMonths: fyMonths, fyLabel: fyLabel, fyStartMonth: fyStartMonth,
    monthLabel: monthLabel, dateLabel: dateLabel, periodLabel: periodLabel, bucketOf: bucketOf, bucketLabel: bucketLabel,
    formatValue: formatValue, exportValue: exportValue, unitLabel: unitLabel,
  };
})();
