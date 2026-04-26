// SRK Rate Studio — Rate List Master mirror.
// Loads snapshot, tracks edits as pending ops, exports diff for sync.
//
// Storage in localStorage (separate keys):
//   srk_studio_rl_baseline_v1   — what we believe is on the portal (read-only after load).
//   srk_studio_rl_working_v1    — current edits.
//   srk_studio_rl_imported_v1   — bool; true once snapshot has been imported once.
//
// Each row: { ID, RLT_ID, CODE, CATEGORY, TYPE, DEPARTMENT, NAME, AS_FOR_HOSPITAL, SERIAL_NO, AMOUNT, _RATE_LIST_TYPE }

(function (global) {
  'use strict';

  const K = {
    baseline: 'srk_studio_rl_baseline_v1',
    working:  'srk_studio_rl_working_v1',
    imported: 'srk_studio_rl_imported_v1',
  };

  function loadJSON(k, def) {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : def; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  function loadBaseline() { return loadJSON(K.baseline, { rows: [] }); }
  function loadWorking()  { return loadJSON(K.working,  { rows: [] }); }
  function isImported()   { return loadJSON(K.imported, false) === true; }

  function saveBaseline(snap) { saveJSON(K.baseline, snap); }
  function saveWorking(snap)  { saveJSON(K.working,  snap); }

  // Import a new snapshot — sets BOTH baseline and working to the same data.
  // Wipes any pending edits.
  function importSnapshot(snapshot) {
    const rows = (snapshot.rows || []).map(r => ({ ...r }));
    saveBaseline({ rows: rows.map(r => ({ ...r })), extractedAt: snapshot.extractedAt });
    saveWorking({  rows, extractedAt: snapshot.extractedAt });
    saveJSON(K.imported, true);
  }

  // Fetch snapshot JSON from the repo (relative URL works on GitHub Pages).
  async function fetchSnapshot(url = './rate-list-snapshot.json') {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Snapshot fetch failed: HTTP ${r.status}`);
    return r.json();
  }

  // Diff working vs baseline.
  // Returns { adds: [...], updates: [...], deletes: [...] }
  // - adds: rows in working but not baseline (matched by CODE if available, else NAME+RLT)
  // - updates: rows in both with at least one editable field (NAME, AMOUNT) different
  // - deletes: rows in baseline but not working
  function diff() {
    const base = loadBaseline().rows || [];
    const work = loadWorking().rows  || [];
    const keyOf = r => r._key || `${r._RATE_LIST_TYPE || ''}|${r.CODE || ''}|${r.NAME || ''}`;
    const baseMap = new Map(base.map(r => [keyOf(r), r]));
    const workMap = new Map(work.map(r => [keyOf(r), r]));
    const adds = [], updates = [], deletes = [];
    for (const [k, w] of workMap) {
      const b = baseMap.get(k);
      if (!b) { adds.push(w); continue; }
      // Compare editable fields.
      const nameChanged = String(b.NAME || '').trim() !== String(w.NAME || '').trim();
      const amtChanged  = Number(b.AMOUNT || 0) !== Number(w.AMOUNT || 0);
      if (nameChanged || amtChanged) {
        updates.push({ ...w, _was: { NAME: b.NAME, AMOUNT: b.AMOUNT } });
      }
    }
    for (const [k, b] of baseMap) {
      if (!workMap.has(k)) deletes.push(b);
    }
    return { adds, updates, deletes };
  }

  // Generate the job-spec items the mega-script consumes.
  function buildJobItems(diffResult) {
    const items = [];
    for (const r of diffResult.deletes) {
      items.push({
        master: 'rateList', action: 'delete',
        code: r.CODE, name: r.NAME,
        rateListType: r._RATE_LIST_TYPE,
      });
    }
    for (const r of diffResult.updates) {
      items.push({
        master: 'rateList', action: 'update',
        code: r.CODE, name: r.NAME,
        rateListType: r._RATE_LIST_TYPE,
        newName:   (r._was && String(r._was.NAME) !== String(r.NAME)) ? r.NAME : '',
        newAmount: (r._was && Number(r._was.AMOUNT) !== Number(r.AMOUNT)) ? r.AMOUNT : '',
      });
    }
    for (const r of diffResult.adds) {
      items.push({
        master: 'rateList', action: 'add',
        code: r.CODE,
        category: r.CATEGORY,
        type: r.TYPE,
        department: r.DEPARTMENT,
        name: r.NAME,
        amount: r.AMOUNT,
        rateListType: r._RATE_LIST_TYPE,
      });
    }
    return items;
  }

  // Mark a successful sync — promote working into baseline.
  function markSynced() {
    const work = loadWorking();
    saveBaseline({ rows: (work.rows || []).map(r => ({ ...r })), extractedAt: new Date().toISOString() });
  }

  // CRUD on working set.
  function addRow(row) {
    const w = loadWorking();
    w.rows = w.rows || [];
    // Generate a temp ID if missing.
    if (!row._key) row._key = `new_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    w.rows.push(row);
    saveWorking(w);
  }
  function updateRow(idx, patch) {
    const w = loadWorking();
    if (w.rows && w.rows[idx]) {
      w.rows[idx] = { ...w.rows[idx], ...patch };
      saveWorking(w);
    }
  }
  function deleteRow(idx) {
    const w = loadWorking();
    if (w.rows && w.rows[idx]) {
      w.rows.splice(idx, 1);
      saveWorking(w);
    }
  }

  // Distinct rate list types from working set (for filter dropdown).
  function rateListTypes() {
    const w = loadWorking();
    const set = new Set();
    for (const r of (w.rows || [])) if (r._RATE_LIST_TYPE) set.add(r._RATE_LIST_TYPE);
    return Array.from(set).sort();
  }

  global.SRKRateList = {
    loadBaseline, loadWorking, isImported,
    importSnapshot, fetchSnapshot,
    diff, buildJobItems, markSynced,
    addRow, updateRow, deleteRow, rateListTypes,
  };
})(window);
