// SRK Rate Studio — built-in template definitions and storage helpers.
// Templates produce per-component rows for the Package Master.
// A template has:
//   - id, name, master, rateListType
//   - inputs:  array of { key, label, type ('number'|'text'|'select'), required, options? }
//   - fixed:   array of { component, rate }
//   - formulas: array of { component, expr }   (expr is JS using input keys + 'fixed.<component>' refs)
//   - validate: optional JS expression that must return true (else its message is shown)
//   - validateMsg: optional message
//   - includeOptional: array of conditions (e.g., other-component if user filled)
//   - extras: array of { whenInputTruthy: 'inputKey', component: 'name' or 'inputKey', rate: 'inputKey' }
//
// All numeric outputs are rounded to integers when computed.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'srk_studio_templates_v1';

  const DEFAULT_TEMPLATES = [
    {
      id: 'cataract-std-hosp',
      name: 'Cataract Standard (Hospital)',
      master: 'package',
      rateListType: 'HOSPITAL',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'total',       label: 'Total Amount', type: 'number', required: true },
        { key: 'lens',        label: 'Lens Amount',  type: 'number', required: true },
      ],
      fixed: [
        { component: 'Phaco Charges', rate: 4500 },
        { component: 'Anesthetist',   rate: 600 },
      ],
      formulas: [
        { component: 'Lens Charges',    expr: 'lens' },
        { component: 'Surgeon Charges', expr: '(total - lens - 5100) * 0.7' },
        { component: 'OT Charges',      expr: '(total - lens - 5100) * 0.3' },
      ],
      validate: 'total > lens + 5100',
      validateMsg: 'Total must be greater than Lens + 5100 (Phaco 4500 + Anesthetist 600).',
    },

    {
      id: 'cataract-gbmkmu-tpa',
      name: 'Cataract GB/MK/MU (TPA)',
      master: 'package',
      rateListType: 'TPA',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'lens',        label: 'Lens Amount',  type: 'number', required: true },
      ],
      fixed: [
        { component: 'Cashless Charges', rate: 20700 },
      ],
      formulas: [
        { component: 'Lens Charges', expr: 'lens' },
      ],
      validate: 'lens > 0',
      validateMsg: 'Lens Amount must be greater than 0.',
      derived: [
        // Derived display fields, not sent to portal — shown in preview as sanity check.
        { key: 'total', label: 'Total (computed)', expr: 'lens + 20700' },
      ],
    },

    {
      id: 'cataract-vaswch-tpa',
      name: 'Cataract VA/SW/CH (TPA)',
      master: 'package',
      rateListType: 'TPA',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'lens',        label: 'Lens Amount',  type: 'number', required: true },
      ],
      fixed: [
        { component: 'Cashless Charges', rate: 22000 },
      ],
      formulas: [
        { component: 'Lens Charges', expr: 'lens' },
      ],
      validate: 'lens > 0',
      validateMsg: 'Lens Amount must be greater than 0.',
      derived: [
        { key: 'total', label: 'Total (computed)', expr: 'lens + 22000' },
      ],
    },

    {
      id: 'cataract-std-startpa',
      name: 'Cataract Standard (Star TPA)',
      master: 'package',
      rateListType: 'STAR TPA',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'lens',        label: 'Lens Amount',  type: 'number', required: true },
      ],
      fixed: [
        { component: 'Cashless Charges', rate: 22000 },
      ],
      formulas: [
        { component: 'Lens Charges', expr: 'lens' },
      ],
      validate: 'lens > 0',
      validateMsg: 'Lens Amount must be greater than 0.',
      derived: [
        { key: 'total', label: 'Total (computed)', expr: 'lens + 22000' },
      ],
    },

    {
      id: 'cataract-std-newtpa',
      name: 'Cataract Standard (New TPA)',
      master: 'package',
      rateListType: 'New TPA',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'lens',        label: 'Lens Amount',  type: 'number', required: true },
      ],
      fixed: [
        { component: 'Cashless Charges', rate: 25000 },
      ],
      formulas: [
        { component: 'Lens Charges', expr: 'lens' },
      ],
      validate: 'lens > 0',
      validateMsg: 'Lens Amount must be greater than 0.',
      derived: [
        { key: 'total', label: 'Total (computed)', expr: 'lens + 25000' },
      ],
    },

    {
      id: 'injections-hosp',
      name: 'Injections (HOSPITAL)',
      master: 'package',
      rateListType: 'HOSPITAL',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName',  label: 'Package Name',     type: 'text',   required: true },
        { key: 'injectionAmt', label: 'Injection Amount', type: 'number', required: true },
        { key: 'total',        label: 'Total Amount',     type: 'number', required: true },
      ],
      fixed: [],
      formulas: [
        { component: 'Injection Charges', expr: 'injectionAmt' },
        { component: 'Surgeon Charges',   expr: 'total - injectionAmt' },
      ],
      validate: 'total > injectionAmt',
      validateMsg: 'Total must be greater than Injection Amount (Surgeon Charges would be ≤ 0).',
    },

    {
      id: 'others-hosp',
      name: 'Others (HOSPITAL)',
      master: 'package',
      rateListType: 'HOSPITAL',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName',     label: 'Package Name',                 type: 'text',   required: true },
        { key: 'total',           label: 'Total Amount',                 type: 'number', required: true },
        { key: 'otherComp',       label: 'Other Component (optional)',   type: 'text',   required: false },
        { key: 'otherRate',       label: 'Other Rate (optional)',        type: 'number', required: false },
        { key: 'anesthetist',     label: 'Anesthetist Charges',          type: 'select', required: true,
          options: [1000, 2000, 3000] },
      ],
      fixed: [],
      formulas: [
        { component: 'OT Charges',      expr: 'total * 0.3' },
        { component: 'Anesthetist',     expr: 'anesthetist' },
        { component: 'Surgeon Charges', expr: 'total - (total * 0.3) - anesthetist - (otherRate || 0)' },
      ],
      // Optional component appears only if both name + rate provided.
      extras: [
        { whenInputTruthy: 'otherComp', componentInputKey: 'otherComp', rateInputKey: 'otherRate' },
      ],
      validate: '(total - (total * 0.3) - anesthetist - (otherRate || 0)) >= 0',
      validateMsg: 'Surgeon Charges would be negative — Total too low for the given OT/Anesthetist/Other.',
    },

    {
      id: 'others-hosp-no-anes',
      name: 'Others w/o Anesthesia (HOSPITAL)',
      master: 'package',
      rateListType: 'HOSPITAL',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name',               type: 'text',   required: true },
        { key: 'total',       label: 'Total Amount',               type: 'number', required: true },
        { key: 'otherComp',   label: 'Other Component (optional)', type: 'text',   required: false },
        { key: 'otherRate',   label: 'Other Rate (optional)',      type: 'number', required: false },
      ],
      fixed: [],
      formulas: [
        { component: 'OT Charges',      expr: 'total * 0.3' },
        { component: 'Surgeon Charges', expr: 'total - (total * 0.3) - (otherRate || 0)' },
      ],
      extras: [
        { whenInputTruthy: 'otherComp', componentInputKey: 'otherComp', rateInputKey: 'otherRate' },
      ],
      validate: '(total - (total * 0.3) - (otherRate || 0)) >= 0',
      validateMsg: 'Surgeon Charges would be negative — Total too low for the given OT/Other.',
    },

    {
      id: 'others-non-hosp',
      name: 'Others (All except HOSPITAL)',
      master: 'package',
      // Empty rateListType means "any non-HOSPITAL" — user picks at job time.
      rateListType: '*',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text',   required: true },
        { key: 'total',       label: 'Total Amount', type: 'number', required: true },
        { key: 'rateListType', label: 'Rate List Type (e.g. TPA / DVA)', type: 'text', required: true },
      ],
      fixed: [],
      formulas: [
        // Single component named after the package, amount = total.
        { component: '__PACKAGE_NAME__', expr: 'total' },
      ],
      validate: 'total > 0',
      validateMsg: 'Total must be greater than 0.',
    },

    // ===== RATE LIST MASTER — single predefined template =====
    // One fixed template with all SRK form fields as inputs. No formulas — every
    // field comes straight from the CSV. The mega-script's rate-list-add handler
    // fills the form's popups (Category, Type, Department) and the Name + Amount
    // text fields per row.
    {
      id: 'rl-add',
      name: 'Rate List Master Add',
      master: 'rateList',
      rateListType: '*',
      inputs: [
        { key: 'rateListType', label: 'Rate List Type', type: 'text', required: true },
        { key: 'category',     label: 'Category',       type: 'text', required: true },
        { key: 'department',   label: 'Department',     type: 'text', required: true },
        { key: 'name',         label: 'Name',           type: 'text', required: true },
        { key: 'amount',       label: 'Amount',         type: 'number', required: true },
      ],
      fixed: [],
      formulas: [],
      validate: 'amount >= 0',
      validateMsg: 'Amount must be non-negative.',
    },

    {
      id: 'rl-delete',
      name: 'Rate List Master Delete (use with Action=Delete)',
      master: 'rateList',
      rateListType: '*',
      inputs: [
        { key: 'rateListType', label: 'Rate List Type', type: 'select', required: true,
          options: ['HOSPITAL', 'TPA', 'DVA', 'STAR TPA',
                    'CGHS GENERAL', 'CGHS PRIVATE', 'CGHS SEMI PRIVATE',
                    'PMJAY', 'PMJAY CHARITY'] },
        { key: 'code',         label: 'CODE',           type: 'text',   required: true },
      ],
      fixed: [],
      formulas: [
        // Maps the input CODE into the field map buildJobItems reads from for delete actions.
        { component: 'code', expr: 'code' },
      ],
      validate: 'code != ""',
      validateMsg: 'CODE is required.',
    },
  ];

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_TEMPLATES);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return clone(DEFAULT_TEMPLATES);
      return migrate(parsed);
    } catch (_) {
      return clone(DEFAULT_TEMPLATES);
    }
  }
  // Strip deprecated rate-list templates and ensure the standard rate-list ones exist.
  // Preserves any user-authored templates.
  function migrate(arr) {
    const deprecated = new Set(['lens-cghs-rl', 'rl-generic', 'rl-consultation']);
    let filtered = arr.filter(t => !deprecated.has(t.id));
    let changed = filtered.length !== arr.length;
    for (const id of ['rl-add', 'rl-delete']) {
      if (!filtered.some(t => t.id === id)) {
        const def = DEFAULT_TEMPLATES.find(t => t.id === id);
        if (def) { filtered.push(clone(def)); changed = true; }
      }
    }
    if (changed) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered)); } catch (_) {}
    }
    return filtered;
  }
  function saveAll(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }
  function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
    return clone(DEFAULT_TEMPLATES);
  }
  function exportJson(arr) {
    return JSON.stringify(arr, null, 2);
  }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Imported JSON must be an array of templates.');
    return parsed;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId() { return 't_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  function blankTemplate() {
    return {
      id: newId(),
      name: 'New Template',
      master: 'package',
      rateListType: 'HOSPITAL',
      packageType: 'IPD',
      inputs: [
        { key: 'packageName', label: 'Package Name', type: 'text', required: true },
        { key: 'total',       label: 'Total Amount', type: 'number', required: true },
      ],
      fixed: [],
      formulas: [],
      validate: 'total > 0',
      validateMsg: 'Total must be greater than 0.',
    };
  }

  global.SRKTemplates = {
    DEFAULTS: DEFAULT_TEMPLATES,
    loadAll, saveAll, resetToDefaults,
    exportJson, importJson, blankTemplate, newId, clone,
  };
})(window);
