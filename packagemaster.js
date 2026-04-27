// SRK Rate Studio — Package Master mirror.
// Storage:
//   srk_studio_pk_baseline_v1   — what we believe is on the portal.
//   srk_studio_pk_working_v1    — current edits.
//   srk_studio_pk_imported_v1   — bool; once snapshot has been imported.
//
// Each row represents one (package_name, rate_list_type) variant:
//   { ID, NAME, AMOUNT, RATE_LIST_TYPE, PACKAGE_TYPE, COMPONENTS: [{NAME, Rate}, ...] }

(function (global) {
  'use strict';

  const K = {
    baseline: 'srk_studio_pk_baseline_v1',
    working:  'srk_studio_pk_working_v1',
    imported: 'srk_studio_pk_imported_v1',
  };
  function loadJSON(k, def) {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : def; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function loadBaseline() { return loadJSON(K.baseline, { rows: [] }); }
  function loadWorking()  { return loadJSON(K.working,  { rows: [] }); }
  function isImported()   { return loadJSON(K.imported, false) === true; }

  function importSnapshot(snapshot) {
    const rows = (snapshot.rows || []).map(r => ({ ...r }));
    saveJSON(K.baseline, { rows: rows.map(r => ({ ...r, COMPONENTS: (r.COMPONENTS||[]).map(c => ({...c})) })), extractedAt: snapshot.extractedAt });
    saveJSON(K.working,  { rows, extractedAt: snapshot.extractedAt });
    saveJSON(K.imported, true);
  }
  async function fetchSnapshot(url = './package-master-snapshot.json') {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Snapshot fetch failed: HTTP ${r.status}`);
    return r.json();
  }

  // Diff: matches by (NAME, RATE_LIST_TYPE).
  // Currently only supports add/delete at variant level.
  // Component-level updates are emitted as full re-add of all components for a variant.
  function diff() {
    const base = loadBaseline().rows || [];
    const work = loadWorking().rows  || [];
    const keyOf = r => `${r.NAME}|${r.RATE_LIST_TYPE}`;
    const baseMap = new Map(base.map(r => [keyOf(r), r]));
    const workMap = new Map(work.map(r => [keyOf(r), r]));
    const adds = [], updates = [], deletes = [];
    for (const [k, w] of workMap) {
      const b = baseMap.get(k);
      if (!b) { adds.push(w); continue; }
      // Check if components changed (rough: compare JSON shape).
      const bc = JSON.stringify((b.COMPONENTS || []).map(c => [c.NAME, Number(c.Rate)]).sort());
      const wc = JSON.stringify((w.COMPONENTS || []).map(c => [c.NAME, Number(c.Rate)]).sort());
      if (bc !== wc) updates.push({ ...w, _was: b });
    }
    for (const [k, b] of baseMap) {
      if (!workMap.has(k)) deletes.push(b);
    }
    return { adds, updates, deletes };
  }

  function buildJobItems(diffResult) {
    const items = [];
    // Deletes first (least destructive last is actually deletes — but here we mirror rate list order).
    for (const r of diffResult.deletes) {
      items.push({
        master: 'package', action: 'delete',
        packageName: r.NAME,
        rateListType: r.RATE_LIST_TYPE,
      });
    }
    for (const r of diffResult.updates) {
      // For updates, emit one item per component (mega-script's package.update batcher
      // groups by packageName).
      for (const c of (r.COMPONENTS || [])) {
        items.push({
          master: 'package', action: 'update',
          packageName: r.NAME,
          packageType: r.PACKAGE_TYPE || 'IPD',
          rateListType: r.RATE_LIST_TYPE,
          component: c.NAME,
          rate: Number(c.Rate),
        });
      }
    }
    for (const r of diffResult.adds) {
      for (const c of (r.COMPONENTS || [])) {
        items.push({
          master: 'package', action: 'add',
          packageName: r.NAME,
          packageType: r.PACKAGE_TYPE || 'IPD',
          rateListType: r.RATE_LIST_TYPE,
          component: c.NAME,
          rate: Number(c.Rate),
        });
      }
    }
    return items;
  }

  function markSynced() {
    const work = loadWorking();
    saveJSON(K.baseline, {
      rows: (work.rows || []).map(r => ({ ...r, COMPONENTS: (r.COMPONENTS||[]).map(c => ({...c})) })),
      extractedAt: new Date().toISOString(),
    });
  }

  // Adds an externally-shipped variant (e.g., from Build Job templates) into BOTH baseline+working.
  // This makes it not show up as a pending diff next session.
  function injectVariant(v) {
    const variant = {
      NAME: v.packageName || v.NAME,
      AMOUNT: v.amount || v.AMOUNT || (v.components || []).reduce((s, c) => s + Number(c.Rate || c.rate || 0), 0),
      RATE_LIST_TYPE: v.rateListType || v.RATE_LIST_TYPE || 'HOSPITAL',
      PACKAGE_TYPE: v.packageType || v.PACKAGE_TYPE || 'IPD',
      COMPONENTS: (v.components || v.COMPONENTS || []).map(c => ({
        NAME: c.NAME || c.Component || c.name,
        Rate: Number(c.Rate || c.rate || 0),
      })),
    };
    if (!variant.NAME || !variant.RATE_LIST_TYPE) return false;
    const key = `${variant.NAME}|${variant.RATE_LIST_TYPE}`;
    const work = loadWorking();
    work.rows = work.rows || [];
    const wIdx = work.rows.findIndex(r => `${r.NAME}|${r.RATE_LIST_TYPE}` === key);
    if (wIdx >= 0) work.rows[wIdx] = variant; else work.rows.push(variant);
    saveJSON(K.working, work);
    const base = loadBaseline();
    base.rows = base.rows || [];
    const bIdx = base.rows.findIndex(r => `${r.NAME}|${r.RATE_LIST_TYPE}` === key);
    const baseCopy = { ...variant, COMPONENTS: variant.COMPONENTS.map(c => ({ ...c })) };
    if (bIdx >= 0) base.rows[bIdx] = baseCopy; else base.rows.push(baseCopy);
    saveJSON(K.baseline, base);
    return true;
  }

  function deleteRow(idx) {
    const w = loadWorking();
    if (w.rows && w.rows[idx]) { w.rows.splice(idx, 1); saveJSON(K.working, w); }
  }
  function updateComponent(rowIdx, compIdx, patch) {
    const w = loadWorking();
    if (!w.rows || !w.rows[rowIdx] || !w.rows[rowIdx].COMPONENTS) return;
    w.rows[rowIdx].COMPONENTS[compIdx] = { ...w.rows[rowIdx].COMPONENTS[compIdx], ...patch };
    saveJSON(K.working, w);
  }

  function rateListTypes() {
    const w = loadWorking();
    const set = new Set();
    for (const r of (w.rows || [])) if (r.RATE_LIST_TYPE) set.add(r.RATE_LIST_TYPE);
    return Array.from(set).sort();
  }

  global.SRKPackageMaster = {
    loadBaseline, loadWorking, isImported,
    importSnapshot, fetchSnapshot,
    diff, buildJobItems, markSynced, injectVariant,
    deleteRow, updateComponent, rateListTypes,
  };
})(window);
