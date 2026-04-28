// SRK Rate Studio — Lens MRP Register
// Imports the IOL Excel, normalizes it into a working set, computes a sync plan
// against the Package Master + Rate List Master mirrors, and ships ops via the
// existing bridge.
//
// Phase 1 (this file): import + storage + simple view.
// Phase 2 (next session): rules engine + sync plan + ship.

(function (global) {
  'use strict';

  const K = {
    rows:     'srk_studio_lens_rows_v1',
    imported: 'srk_studio_lens_imported_v1',
  };

  function loadJSON(k, def) {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : def; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  function loadRows()    { return loadJSON(K.rows, []); }
  function saveRows(arr) { saveJSON(K.rows, arr); }
  function isImported()  { return loadJSON(K.imported, false) === true; }

  // Excel column indexes (0-based) after we strip header rows.
  const COL = {
    SR:           0,
    VENDOR:       1,
    NAME_RAJU:    2,
    NAME_EXCEL:   3,
    MRP:          4,
    NEW_MRP:      5,
    LENS_HOSPITAL: 6,
    LENS_OTHERS:   7,
    COST:         8,
    CHECK_PRIVATE: 9,
    CHECK_OTHERS:  10,
    PKG_HOSPITAL:  11,
  };

  // SheetJS doesn't preserve fill colors via the default reader, but cellStyles:true does.
  // Yellow detection: cell.s.fgColor.rgb starts with 'FFFFFF00' or similar.
  function isYellow(cell) {
    if (!cell || !cell.s) return false;
    const fg = cell.s.fgColor || (cell.s.fill && cell.s.fill.fgColor);
    if (!fg) return false;
    const rgb = (fg.rgb || '').toUpperCase();
    // yellow shades
    return rgb === 'FFFFFF00' || rgb === 'FFFF00' || (fg.theme === 7);
  }

  function asNum(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[,#NA]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function asStr(v) { return v == null ? '' : String(v).trim(); }

  // Returns array of normalized lens rows.
  // Requires SheetJS (window.XLSX) loaded.
  async function importFromArrayBuffer(buf) {
    if (!global.XLSX) throw new Error('SheetJS not loaded');
    const wb = global.XLSX.read(buf, { type: 'array', cellStyles: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const range = global.XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    // Find header row — look for "Lens Name as per Excel" in any row.
    let headerRow = -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[global.XLSX.utils.encode_cell({ r, c })];
        if (cell && /Lens Name as per Excel/i.test(String(cell.v || ''))) {
          headerRow = r; break;
        }
      }
      if (headerRow >= 0) break;
    }
    if (headerRow < 0) throw new Error('Header row not found (looking for "Lens Name as per Excel")');

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const get = (offset) => ws[global.XLSX.utils.encode_cell({ r, c: range.s.c + offset })];
      const nameCell = get(COL.NAME_EXCEL);
      const name = asStr(nameCell?.v);
      if (!name || name.startsWith('=') || name === '#N/A') continue;
      rows.push({
        sr:           asNum(get(COL.SR)?.v),
        vendor:       asStr(get(COL.VENDOR)?.v),
        nameRaju:     asStr(get(COL.NAME_RAJU)?.v),
        nameExcel:    name,
        mrp:          asNum(get(COL.MRP)?.v),
        newMrp:       asNum(get(COL.NEW_MRP)?.v),
        lensHospital: asNum(get(COL.LENS_HOSPITAL)?.v),
        lensOthers:   asNum(get(COL.LENS_OTHERS)?.v),
        cost:         asNum(get(COL.COST)?.v),
        checkPrivate: asStr(get(COL.CHECK_PRIVATE)?.v),
        checkOthers:  asStr(get(COL.CHECK_OTHERS)?.v),
        pkgHospital:  asNum(get(COL.PKG_HOSPITAL)?.v),
        yellow:       isYellow(nameCell),
        notes:        '',
      });
    }
    return rows;
  }

  function importRows(rows) {
    saveRows(rows);
    saveJSON(K.imported, true);
  }

  function updateRow(idx, patch) {
    const arr = loadRows();
    if (arr[idx]) { arr[idx] = { ...arr[idx], ...patch }; saveRows(arr); }
  }

  // Phase 1: simple readiness check — does this row have enough data to sync?
  // Returns { ready: bool, reasons: [str] }
  function readiness(row) {
    const reasons = [];
    if (!row.nameExcel) reasons.push('lens name missing');
    if (!row.lensHospital && !row.yellow) reasons.push('Lens Charge HOSPITAL missing');
    if (!row.lensOthers   && !row.yellow) reasons.push('Lens Charge Others missing');
    if (!row.pkgHospital  && !row.yellow) reasons.push('Package amount HOSPITAL missing');
    if (row.yellow && (!row.lensHospital || !row.pkgHospital)) {
      reasons.push('yellow row needs values filled before sync');
    }
    return { ready: reasons.length === 0, reasons };
  }

  // Common vendor prefix tokens to strip when comparing names.
  // Order matters — multi-word prefixes first.
  const VENDOR_PREFIXES = [
    'j & j tecnis', 'j&j tecnis', 'jj tecnis', 'tecnis',
    'b & l', 'b&l', 'bvi', 'iocare', 'biotech', 'alcon', 'acrysof',
    'zeiss', 'carl zeiss', 'hoya', 'rayner', 'rayone',
    'appasamy', 'appaswamy', 'oculentis', 'lentis',
    'staar', 'naspro', 'eyecryl', 'envista', 'isopure',
    'micropure', 'miniwell', 'luxsmart', 'optiflex',
  ];

  // Build a normalized key for fuzzy lens-name matching.
  function normalizeName(name) {
    if (!name) return '';
    let s = String(name).toLowerCase().trim();
    // Strip parenthetical suffixes "(GB,MK,MU)", "(Toric)", "(old)", etc.
    s = s.replace(/\s*\([^)]+\)\s*$/g, '').trim();
    // Collapse whitespace and unify punctuation.
    s = s.replace(/[.,]/g, ' ').replace(/&/g, ' & ').replace(/\s+/g, ' ').trim();
    return s;
  }
  function stripVendorPrefix(name) {
    const norm = normalizeName(name);
    for (const p of VENDOR_PREFIXES) {
      if (norm.startsWith(p + ' ')) return norm.slice(p.length + 1).trim();
      if (norm === p) return '';
    }
    // Also try stripping just the first word (catches uncommon vendor prefixes).
    const first = norm.split(' ')[0];
    if (first && first.length >= 4) {
      // Only strip if the rest still has meaningful content (>1 word OR >3 chars).
      const rest = norm.slice(first.length).trim();
      if (rest && (rest.includes(' ') || rest.length > 3)) return rest;
    }
    return norm;
  }

  // Generate candidate keys for matching — original normalized + vendor-stripped.
  function nameKeys(name) {
    const a = normalizeName(name);
    const b = stripVendorPrefix(a);
    const set = new Set([a]);
    if (b && b !== a) set.add(b);
    return Array.from(set);
  }

  // Find existing portal packages that correspond to this lens.
  // Returns an object keyed by rate list type with the matching package rows from the mirror.
  function findPortalPackages(row) {
    if (!global.SRKPackageMaster) return {};
    const all = (global.SRKPackageMaster.loadWorking().rows || []);
    const lensKeys = nameKeys(row.nameExcel);
    const out = {};
    for (const p of all) {
      const portalKeys = nameKeys(p.NAME);
      // Match if any lens key equals any portal key.
      const hit = lensKeys.some(lk => portalKeys.some(pk => lk === pk));
      if (hit) {
        if (!out[p.RATE_LIST_TYPE]) out[p.RATE_LIST_TYPE] = [];
        out[p.RATE_LIST_TYPE].push(p);
      }
    }
    return out;
  }

  global.SRKLensRegister = {
    loadRows, saveRows, isImported, importRows, importFromArrayBuffer,
    updateRow, readiness, findPortalPackages,
  };
})(window);
