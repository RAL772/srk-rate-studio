// SRK Rate Studio — formula evaluator + CSV parser.
// Inputs are evaluated as a JS expression with restricted scope (only declared input keys + Math).

(function (global) {
  'use strict';

  // ---------- safe-ish expression evaluator ----------
  // Compiles the expression into a Function once, then invokes with provided scope.
  // Allowed identifiers in expr: declared input keys + Math.
  // No external references; if you write something undefined, you'll get a ReferenceError caught here.
  const exprCache = new Map();
  function compile(expr) {
    if (exprCache.has(expr)) return exprCache.get(expr);
    // Block obviously dangerous tokens.
    if (/\b(window|document|globalThis|process|require|fetch|XMLHttpRequest|eval|Function|import)\b/.test(expr)) {
      throw new Error('Expression contains disallowed identifier');
    }
    // Wrap in a function that destructures inputs from scope.
    const fn = new Function('scope', `with (scope) { return (${expr}); }`);
    exprCache.set(expr, fn);
    return fn;
  }
  function evalExpr(expr, scope) {
    try {
      const fn = compile(expr);
      const v = fn({ ...scope, Math });
      return v;
    } catch (e) {
      throw new Error(`Formula error in "${expr}": ${e.message}`);
    }
  }

  // ---------- per-row computation ----------
  // Given a template + a row of input values (object with keys matching template.inputs),
  // returns { ok, error?, components: [{Component, Rate}], derived: {key: value} }.
  function computeRow(template, inputRow) {
    const scope = {};
    // Coerce numeric inputs.
    for (const inp of template.inputs) {
      const raw = inputRow[inp.key];
      if (inp.type === 'number') {
        if (raw === '' || raw == null) {
          if (inp.required) return fail(`Missing required input "${inp.label}"`);
          scope[inp.key] = 0;
        } else {
          const n = Number(raw);
          if (!isFinite(n)) return fail(`Input "${inp.label}" is not a number: "${raw}"`);
          scope[inp.key] = n;
        }
      } else if (inp.type === 'select') {
        if (raw === '' || raw == null) {
          if (inp.required) return fail(`Missing required input "${inp.label}"`);
          scope[inp.key] = inp.options && inp.options[0] != null ? inp.options[0] : '';
        } else {
          // Try numeric coercion first (select options here are numeric).
          const n = Number(raw);
          scope[inp.key] = isFinite(n) ? n : raw;
        }
      } else { // text
        if ((raw == null || raw === '') && inp.required) return fail(`Missing required input "${inp.label}"`);
        scope[inp.key] = raw == null ? '' : String(raw);
      }
    }

    // Validation expression.
    if (template.validate) {
      let v;
      try { v = evalExpr(template.validate, scope); }
      catch (e) { return fail(e.message); }
      if (!v) return fail(template.validateMsg || 'Validation failed');
    }

    // Build component list: fixed first, then formulas, then extras.
    const components = [];
    for (const f of (template.fixed || [])) {
      components.push({ Component: f.component, Rate: round(f.rate) });
    }
    for (const f of (template.formulas || [])) {
      let v;
      try { v = evalExpr(f.expr, scope); }
      catch (e) { return fail(e.message); }
      if (typeof v === 'number' && !isFinite(v)) return fail(`Formula "${f.component}" produced non-finite value`);
      const compName = (f.component === '__PACKAGE_NAME__') ? scope.packageName : f.component;
      components.push({ Component: compName, Rate: round(v) });
    }
    // Optional "extras" — appear only when a flag input is truthy.
    for (const ex of (template.extras || [])) {
      const flag = scope[ex.whenInputTruthy];
      if (flag == null || flag === '' || flag === 0) continue;
      const compName = scope[ex.componentInputKey];
      const rate = scope[ex.rateInputKey];
      if (!compName) continue;
      components.push({ Component: String(compName), Rate: round(Number(rate) || 0) });
    }

    // Derived (display-only).
    const derived = {};
    for (const d of (template.derived || [])) {
      try { derived[d.key] = round(evalExpr(d.expr, scope)); }
      catch (_) { derived[d.key] = null; }
    }

    return { ok: true, components, derived, scope };

    function fail(msg) { return { ok: false, error: msg, components: [], derived: {} }; }
  }
  function round(n) {
    const v = Number(n);
    if (!isFinite(v)) return 0;
    return Math.round(v);
  }

  // ---------- CSV parser (RFC 4180-ish) ----------
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i+1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (c === '\r') {/*skip*/}
        else cell += c;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1)
      .filter(r => r.some(v => String(v||'').trim().length))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  }

  // Map CSV row (with arbitrary column header casing) to inputs by template input key OR label.
  function mapCsvRowToInputs(template, csvRow) {
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const lookup = {};
    for (const k of Object.keys(csvRow)) lookup[norm(k)] = csvRow[k];
    const inputRow = {};
    for (const inp of template.inputs) {
      const candidates = [inp.key, inp.label].map(norm);
      let v = '';
      for (const c of candidates) if (lookup[c] != null && lookup[c] !== '') { v = lookup[c]; break; }
      inputRow[inp.key] = v;
    }
    return inputRow;
  }

  // Generate a CSV header line matching template inputs (label form, friendlier for users).
  function csvHeader(template) {
    return template.inputs.map(i => csvSafe(i.label)).join(',');
  }
  function csvSafe(s) {
    s = String(s ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ---------- job spec builder ----------
  // Given a template, an array of computed-row objects (from computeRow), and an action,
  // produce the per-master flat-row payload that the mega-script expects.
  function buildJobItems(template, computedRows, action) {
    const items = [];
    for (const r of computedRows) {
      if (!r.ok) continue;
      // Effective rate list type: template's, OR scope override (template 9 lets user pick per row).
      const rlt = (template.rateListType === '*' || !template.rateListType)
        ? (r.scope.rateListType || '')
        : template.rateListType;
      const pkgName = r.scope.packageName;
      const pkgType = template.packageType || 'IPD';

      if (action === 'delete') {
        items.push({ master: 'package', action: 'delete', packageName: pkgName });
        continue;
      }
      // Add or Update — emit one item per component (mega-script groups by name).
      for (const c of r.components) {
        items.push({
          master: 'package',
          action,
          packageName: pkgName,
          packageType: pkgType,
          rateListType: rlt,
          component: c.Component,
          rate: c.Rate,
        });
      }
    }
    return items;
  }

  global.SRKCompute = {
    computeRow, parseCsv, mapCsvRowToInputs, csvHeader, csvSafe, buildJobItems, evalExpr,
  };
})(window);
