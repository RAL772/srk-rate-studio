// SRK Rate Studio — main Vue 3 app.
const { createApp, reactive, computed, ref, onMounted, watch } = Vue;

// ---------- pending-jobs storage (localStorage; bridge will read this) ----------
const PENDING_KEY = 'srk_studio_pending_v1';
function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (_) { return []; }
}
function savePending(arr) { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); }

createApp({
  setup() {
    // ---------- state ----------
    const tab = ref('templates');
    const templates = ref(SRKTemplates.loadAll());
    const selectedId = ref(templates.value[0]?.id || null);
    const editingId = ref(null);
    const editingDraft = ref(null);
    const importText = ref('');
    const showImport = ref(false);

    const selected = computed(() => templates.value.find(t => t.id === selectedId.value) || null);

    // Build Job state
    const jobTemplateId = ref(templates.value[0]?.id || null);
    const csvText = ref('');
    const action = ref('add');
    const computedRows = ref([]);
    const jobNote = ref('');

    // Pending jobs
    const pending = ref(loadPending());

    // ---------- Rate List Master state ----------
    const rlImported = ref(SRKRateList.isImported());
    const rlWorking = ref(SRKRateList.loadWorking());
    const rlFilterType = ref('');     // rate list type filter
    const rlSearch = ref('');         // text search across CODE / NAME
    const rlPage = ref(0);            // pagination
    const rlPageSize = 100;
    const rlNewRow = ref(null);       // dialog state for adding a row
    const rlSyncBusy = ref(false);
    // Version counter — bump on any mutation so computed properties (rlDiff, rlPendingCount)
    // re-run. SRKRateList.diff() reads localStorage directly so Vue can't track it via deps.
    const rlVersion = ref(0);
    const bumpRl = () => { rlVersion.value++; };

    function reloadRl() {
      rlWorking.value = SRKRateList.loadWorking();
      bumpRl();
    }

    async function rlImportFromRepo() {
      if (rlImported.value && !confirm('Re-importing will discard any pending edits. Continue?')) return;
      try {
        const snap = await SRKRateList.fetchSnapshot();
        SRKRateList.importSnapshot(snap);
        rlImported.value = true;
        reloadRl();
        alert(`Imported ${snap.totalRows || (snap.rows || []).length} rates.`);
      } catch (e) { alert('Import failed: ' + e.message); }
    }

    function rlImportFromFile(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const snap = JSON.parse(r.result);
          SRKRateList.importSnapshot(snap);
          rlImported.value = true;
          reloadRl();
          alert(`Imported ${(snap.rows || []).length} rates.`);
        } catch (e) { alert('Bad JSON: ' + e.message); }
      };
      r.readAsText(f);
    }

    const rlTypes = computed(() => SRKRateList.rateListTypes());
    const rlAllRows = computed(() => rlWorking.value.rows || []);
    const rlFiltered = computed(() => {
      const s = rlSearch.value.trim().toLowerCase();
      const t = rlFilterType.value;
      return rlAllRows.value.filter(r => {
        if (t && r._RATE_LIST_TYPE !== t) return false;
        if (s && !((r.CODE || '').toLowerCase().includes(s) || (r.NAME || '').toLowerCase().includes(s))) return false;
        return true;
      });
    });
    const rlPageRows = computed(() => {
      const start = rlPage.value * rlPageSize;
      return rlFiltered.value.slice(start, start + rlPageSize);
    });
    const rlPageCount = computed(() => Math.max(1, Math.ceil(rlFiltered.value.length / rlPageSize)));

    function rlEditCell(row, field, value) {
      const all = rlWorking.value.rows;
      const idx = all.findIndex(r => r === row);
      if (idx < 0) return;
      const patch = { [field]: field === 'AMOUNT' ? Number(value) : value };
      SRKRateList.updateRow(idx, patch);
      Object.assign(all[idx], patch);
      bumpRl();
    }

    function rlDeleteRow(row) {
      if (!confirm(`Mark "${row.NAME || row.CODE}" for deletion?`)) return;
      const idx = rlWorking.value.rows.findIndex(r => r === row);
      if (idx < 0) return;
      SRKRateList.deleteRow(idx);
      reloadRl();
    }

    function rlBeginAdd() {
      rlNewRow.value = {
        CODE: '', CATEGORY: '', TYPE: '', DEPARTMENT: '',
        NAME: '', AMOUNT: 0, AS_FOR_HOSPITAL: '', SERIAL_NO: '',
        _RATE_LIST_TYPE: rlFilterType.value || '',
      };
    }
    function rlCancelAdd() { rlNewRow.value = null; }
    function rlConfirmAdd() {
      const r = rlNewRow.value;
      if (!r) return;
      if (!r.NAME || !r._RATE_LIST_TYPE) { alert('NAME and Rate List Type required.'); return; }
      SRKRateList.addRow(r);
      rlNewRow.value = null;
      reloadRl();
    }

    const rlDiff = computed(() => {
      void rlVersion.value;        // tracks mutations
      void rlWorking.value.rows;   // tracks ref reassignment
      return SRKRateList.diff();
    });
    const rlPendingCount = computed(() => {
      const d = rlDiff.value;
      return d.adds.length + d.updates.length + d.deletes.length;
    });

    function rlShipPending() {
      const d = rlDiff.value;
      const items = SRKRateList.buildJobItems(d);
      if (!items.length) { alert('No pending changes.'); return; }
      const job = {
        id: 'rljob_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        createdAt: new Date().toISOString(),
        templateName: 'Rate List Master sync',
        action: 'mixed',
        rowCount: items.length,
        itemCount: items.length,
        note: `${d.adds.length} add, ${d.updates.length} update, ${d.deletes.length} delete`,
        items,
      };
      pending.value.unshift(job);
      window.postMessage({ srkStudio: true, kind: 'jobShipped', job }, '*');
      tab.value = 'pending';
      alert(`Shipped Rate List sync: ${items.length} ops. After it completes, click "Mark synced" to promote to baseline.`);
    }

    function rlMarkSynced() {
      if (!confirm('Promote current edits to baseline (clears pending diff)?')) return;
      SRKRateList.markSynced();
      reloadRl();
    }

    // ---------- Package Master state ----------
    const pkImported = ref(SRKPackageMaster.isImported());
    const pkWorking  = ref(SRKPackageMaster.loadWorking());
    const pkFilterType = ref('');
    const pkSearch = ref('');
    const pkPage = ref(0);
    const pkPageSize = 50;
    const pkExpandedKey = ref(null);  // which row's components are shown
    const pkVersion = ref(0);
    const bumpPk = () => { pkVersion.value++; };
    function reloadPk() { pkWorking.value = SRKPackageMaster.loadWorking(); bumpPk(); }

    async function pkImportFromRepo() {
      if (pkImported.value && !confirm('Re-importing will discard pending edits. Continue?')) return;
      try {
        const snap = await SRKPackageMaster.fetchSnapshot();
        SRKPackageMaster.importSnapshot(snap);
        pkImported.value = true;
        reloadPk();
        alert(`Imported ${(snap.rows || []).length} package variants.`);
      } catch (e) { alert('Import failed: ' + e.message); }
    }
    function pkImportFromFile(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const snap = JSON.parse(r.result);
          SRKPackageMaster.importSnapshot(snap);
          pkImported.value = true;
          reloadPk();
          alert(`Imported ${(snap.rows || []).length} package variants.`);
        } catch (e) { alert('Bad JSON: ' + e.message); }
      };
      r.readAsText(f);
    }

    const pkTypes = computed(() => SRKPackageMaster.rateListTypes());
    const pkAllRows = computed(() => pkWorking.value.rows || []);
    const pkFiltered = computed(() => {
      const s = pkSearch.value.trim().toLowerCase();
      const t = pkFilterType.value;
      return pkAllRows.value.filter(r => {
        if (t && r.RATE_LIST_TYPE !== t) return false;
        if (s && !((r.NAME || '').toLowerCase().includes(s))) return false;
        return true;
      });
    });
    const pkPageRows = computed(() => {
      const start = pkPage.value * pkPageSize;
      return pkFiltered.value.slice(start, start + pkPageSize);
    });
    const pkPageCount = computed(() => Math.max(1, Math.ceil(pkFiltered.value.length / pkPageSize)));

    function pkToggleExpand(row) {
      const k = row.NAME + '|' + row.RATE_LIST_TYPE;
      pkExpandedKey.value = (pkExpandedKey.value === k) ? null : k;
    }
    function pkIsExpanded(row) {
      return pkExpandedKey.value === (row.NAME + '|' + row.RATE_LIST_TYPE);
    }
    function pkDeleteRow(row) {
      if (!confirm(`Mark "${row.NAME}" (${row.RATE_LIST_TYPE}) for deletion?`)) return;
      const idx = pkWorking.value.rows.findIndex(r => r === row);
      if (idx < 0) return;
      SRKPackageMaster.deleteRow(idx);
      reloadPk();
    }
    // Bulk-delete every variant currently visible in the filter (filterType + search).
    // The user's typical use case is wiping an entire rate list type.
    function pkDeleteAllFiltered() {
      const targets = pkFiltered.value.slice();  // snapshot before mutating
      if (!targets.length) { alert('No rows match the current filter.'); return; }
      const breakdown = {};
      for (const r of targets) breakdown[r.RATE_LIST_TYPE] = (breakdown[r.RATE_LIST_TYPE] || 0) + 1;
      const summary = Object.entries(breakdown).map(([k, v]) => `  • ${k}: ${v}`).join('\n');
      const filterDesc = (pkFilterType.value || 'ALL') + (pkSearch.value ? ` matching "${pkSearch.value}"` : '');
      if (!confirm(`Mark ALL ${targets.length} package variant${targets.length === 1 ? '' : 's'} (${filterDesc}) for deletion?\n\n${summary}\n\nThis only marks them in the Studio mirror. Click "▶ Ship to portal" to actually delete on srk.rxhis.com.`)) return;
      // Identify rows by reference, then delete from working set in reverse-index order so
      // the indices we resolve don't drift as we splice.
      const all = pkWorking.value.rows;
      const idxs = targets
        .map(r => all.indexOf(r))
        .filter(i => i >= 0)
        .sort((a, b) => b - a);
      for (const i of idxs) SRKPackageMaster.deleteRow(i);
      reloadPk();
      alert(`${idxs.length} variant${idxs.length === 1 ? '' : 's'} marked for deletion. Open the Pending changes panel below to review and Ship.`);
    }
    function pkEditComponent(row, comp, field, value) {
      const rowIdx = pkWorking.value.rows.findIndex(r => r === row);
      const compIdx = (row.COMPONENTS || []).findIndex(c => c === comp);
      if (rowIdx < 0 || compIdx < 0) return;
      const patch = { [field]: field === 'Rate' ? Number(value) : value };
      SRKPackageMaster.updateComponent(rowIdx, compIdx, patch);
      Object.assign(row.COMPONENTS[compIdx], patch);
      bumpPk();
    }
    const pkDiff = computed(() => {
      void pkVersion.value;
      void pkWorking.value.rows;
      return SRKPackageMaster.diff();
    });
    const pkPendingCount = computed(() => {
      const d = pkDiff.value;
      return d.adds.length + d.updates.length + d.deletes.length;
    });

    function pkShipPending() {
      const d = pkDiff.value;
      const items = SRKPackageMaster.buildJobItems(d);
      if (!items.length) { alert('No pending changes.'); return; }
      const job = {
        id: 'pkjob_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        createdAt: new Date().toISOString(),
        templateName: 'Package Master sync',
        action: 'mixed',
        rowCount: d.adds.length + d.updates.length + d.deletes.length,
        itemCount: items.length,
        note: `${d.adds.length} add, ${d.updates.length} update, ${d.deletes.length} delete`,
        items,
      };
      pending.value.unshift(job);
      window.postMessage({ srkStudio: true, kind: 'jobShipped', job }, '*');
      tab.value = 'pending';
      alert(`Shipped Package sync: ${items.length} items. After completion, click "Mark synced".`);
    }
    function pkMarkSynced() {
      if (!confirm('Promote current edits to baseline?')) return;
      SRKPackageMaster.markSynced();
      reloadPk();
    }

    // ---------- Lens Register state ----------
    const lensImported = ref(SRKLensRegister.isImported());
    const lensRows = ref(SRKLensRegister.loadRows());
    const lensVersion = ref(0);
    const bumpLens = () => { lensVersion.value++; };
    const lensSearch = ref('');
    const lensVendor = ref('');
    const lensYellowOnly = ref(false);
    const lensPage = ref(0);
    const lensPageSize = 50;

    async function lensImportFromFile(ev) {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const rows = await SRKLensRegister.importFromArrayBuffer(buf);
        SRKLensRegister.importRows(rows);
        lensRows.value = rows;
        lensImported.value = true;
        bumpLens();
        alert(`Imported ${rows.length} lenses (${rows.filter(r => r.yellow).length} yellow / not-yet-added).`);
      } catch (e) { alert('Import failed: ' + e.message); }
    }

    function lensEditCell(row, field, value) {
      const idx = lensRows.value.findIndex(r => r === row);
      if (idx < 0) return;
      const patch = { [field]: ['mrp','newMrp','lensHospital','lensOthers','cost','pkgHospital'].includes(field) ? Number(value) : value };
      SRKLensRegister.updateRow(idx, patch);
      Object.assign(row, patch);
      bumpLens();
    }

    const lensVendors = computed(() => {
      void lensVersion.value;
      const set = new Set();
      for (const r of lensRows.value) if (r.vendor) set.add(r.vendor);
      return Array.from(set).sort();
    });
    const lensFiltered = computed(() => {
      void lensVersion.value;
      const s = lensSearch.value.trim().toLowerCase();
      const v = lensVendor.value;
      return lensRows.value.filter(r => {
        if (v && r.vendor !== v) return false;
        if (lensYellowOnly.value && !r.yellow) return false;
        if (s && !((r.nameExcel || '').toLowerCase().includes(s) || (r.vendor || '').toLowerCase().includes(s))) return false;
        return true;
      });
    });
    const lensPageRows = computed(() => {
      const start = lensPage.value * lensPageSize;
      return lensFiltered.value.slice(start, start + lensPageSize);
    });
    const lensPageCount = computed(() => Math.max(1, Math.ceil(lensFiltered.value.length / lensPageSize)));
    const lensYellowCount = computed(() => {
      void lensVersion.value;
      return lensRows.value.filter(r => r.yellow).length;
    });
    const lensReadyCount = computed(() => {
      void lensVersion.value;
      return lensRows.value.filter(r => SRKLensRegister.readiness(r).ready).length;
    });

    function lensRowReadiness(row) {
      void lensVersion.value;
      return SRKLensRegister.readiness(row);
    }
    function lensRowPortalMatches(row) {
      void lensVersion.value;
      const map = SRKLensRegister.findPortalPackages(row);
      // Return summary like "HOSPITAL ✓, TPA(2) ✓, STAR TPA ✓, MISSING: PMJAY"
      return map;
    }

    // Bridge live status (set by the mega-script via window.postMessage handshake)
    const bridgeLive = ref(false);
    let bridgePingTimer = 0;

    // ---------- persistence helpers ----------
    function saveTemplates() {
      SRKTemplates.saveAll(templates.value);
    }
    watch(templates, saveTemplates, { deep: true });
    watch(pending,  (v) => savePending(v), { deep: true });

    // ---------- Templates tab actions ----------
    function selectTemplate(id) { selectedId.value = id; cancelEdit(); }
    function newTemplate() {
      const t = SRKTemplates.blankTemplate();
      templates.value.push(t);
      selectedId.value = t.id;
      startEdit();
    }
    function deleteTemplate(id) {
      if (!confirm('Delete this template?')) return;
      templates.value = templates.value.filter(t => t.id !== id);
      if (selectedId.value === id) selectedId.value = templates.value[0]?.id || null;
    }
    function duplicateTemplate(id) {
      const t = templates.value.find(x => x.id === id);
      if (!t) return;
      const copy = SRKTemplates.clone(t);
      copy.id = SRKTemplates.newId();
      copy.name = t.name + ' (copy)';
      templates.value.push(copy);
      selectedId.value = copy.id;
    }
    function resetDefaults() {
      if (!confirm('Reset to factory templates? Your custom edits to the built-ins will be lost.')) return;
      templates.value = SRKTemplates.resetToDefaults();
      selectedId.value = templates.value[0]?.id || null;
    }
    function exportAll() {
      const json = SRKTemplates.exportJson(templates.value);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'srk-templates.json'; a.click();
      URL.revokeObjectURL(url);
    }
    function doImport() {
      try {
        const arr = SRKTemplates.importJson(importText.value);
        // Merge by id; new ids appended.
        const existing = new Map(templates.value.map(t => [t.id, t]));
        for (const t of arr) existing.set(t.id || SRKTemplates.newId(), t);
        templates.value = Array.from(existing.values());
        importText.value = '';
        showImport.value = false;
        alert('Imported ' + arr.length + ' template(s).');
      } catch (e) { alert('Import failed: ' + e.message); }
    }

    // ---------- Editor ----------
    function startEdit() {
      if (!selected.value) return;
      editingId.value = selected.value.id;
      editingDraft.value = SRKTemplates.clone(selected.value);
    }
    function cancelEdit() { editingId.value = null; editingDraft.value = null; }
    function saveEdit() {
      if (!editingDraft.value) return;
      // Validate: name + id required, no duplicate keys.
      const d = editingDraft.value;
      if (!d.name || !d.name.trim()) { alert('Template name required.'); return; }
      const keys = new Set();
      for (const i of (d.inputs || [])) {
        if (!i.key) { alert('Every input needs a key.'); return; }
        if (keys.has(i.key)) { alert('Duplicate input key: ' + i.key); return; }
        keys.add(i.key);
      }
      const idx = templates.value.findIndex(t => t.id === d.id);
      if (idx >= 0) templates.value.splice(idx, 1, d);
      else templates.value.push(d);
      selectedId.value = d.id;
      cancelEdit();
    }
    function addInput() {
      editingDraft.value.inputs.push({ key: '', label: '', type: 'number', required: true });
    }
    function removeInput(i) { editingDraft.value.inputs.splice(i, 1); }
    function addFixed() { editingDraft.value.fixed.push({ component: '', rate: 0 }); }
    function removeFixed(i) { editingDraft.value.fixed.splice(i, 1); }
    function addFormula() { editingDraft.value.formulas.push({ component: '', expr: '' }); }
    function removeFormula(i) { editingDraft.value.formulas.splice(i, 1); }
    function addExtra() {
      if (!editingDraft.value.extras) editingDraft.value.extras = [];
      editingDraft.value.extras.push({ whenInputTruthy: '', componentInputKey: '', rateInputKey: '' });
    }
    function removeExtra(i) { editingDraft.value.extras.splice(i, 1); }
    function addDerived() {
      if (!editingDraft.value.derived) editingDraft.value.derived = [];
      editingDraft.value.derived.push({ key: '', label: '', expr: '' });
    }
    function removeDerived(i) { editingDraft.value.derived.splice(i, 1); }

    // ---------- Build Job tab ----------
    const jobTemplate = computed(() => templates.value.find(t => t.id === jobTemplateId.value) || null);
    function downloadCsvTemplate() {
      if (!jobTemplate.value) return;
      const header = SRKCompute.csvHeader(jobTemplate.value);
      const sample = jobTemplate.value.inputs.map(i => i.type === 'number' ? '0' : '').join(',');
      const blob = new Blob([header + '\n' + sample + '\n'], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `srk-${jobTemplate.value.id}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    function loadCsvFile(ev) {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => { csvText.value = r.result; computeAll(); };
      r.readAsText(file);
    }
    function computeAll() {
      if (!jobTemplate.value) { computedRows.value = []; return; }
      const rows = SRKCompute.parseCsv(csvText.value);
      const out = [];
      for (const csvRow of rows) {
        const inputRow = SRKCompute.mapCsvRowToInputs(jobTemplate.value, csvRow);
        const r = SRKCompute.computeRow(jobTemplate.value, inputRow);
        out.push({ ...r, inputRow });
      }
      computedRows.value = out;
    }
    watch(csvText, () => { /* manual via button or onchange */ });

    const okCount  = computed(() => computedRows.value.filter(r => r.ok).length);
    const errCount = computed(() => computedRows.value.filter(r => !r.ok).length);

    function ship() {
      if (!jobTemplate.value) return;
      const items = SRKCompute.buildJobItems(jobTemplate.value, computedRows.value, action.value);
      if (!items.length) { alert('Nothing to ship.'); return; }
      const job = {
        id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5),
        createdAt: new Date().toISOString(),
        templateId: jobTemplate.value.id,
        templateName: jobTemplate.value.name,
        action: action.value,
        rowCount: computedRows.value.filter(r=>r.ok).length,
        itemCount: items.length,
        note: jobNote.value,
        items,
        // Carry the per-package data so we can inject into the mirror later.
        _packages: action.value !== 'delete' ? buildShippedPackages() : null,
      };
      pending.value.unshift(job);
      jobNote.value = '';
      window.postMessage({ srkStudio: true, kind: 'jobShipped', job }, '*');
      tab.value = 'pending';
      alert(`Shipped job with ${items.length} item(s). Switch to your SRK tab — the mega-script should pick it up.\n\nOnce the job runs successfully on the portal, come back here and click "Sync to mirror" on the job to add these packages to the Package Master mirror.`);
    }

    // Build a structured per-package list from the current Build Job state, so it can be
    // injected into the Package Master mirror after a successful sync.
    function buildShippedPackages() {
      const tpl = jobTemplate.value;
      if (!tpl || tpl.master !== 'package') return null;
      const pkgs = [];
      for (const r of computedRows.value) {
        if (!r.ok) continue;
        const rateListType = (tpl.rateListType === '*' || !tpl.rateListType)
          ? (r.scope.rateListType || '')
          : tpl.rateListType;
        pkgs.push({
          packageName: r.scope.packageName,
          packageType: tpl.packageType || 'IPD',
          rateListType,
          components: r.components.map(c => ({ NAME: c.Component, Rate: c.Rate })),
          amount: r.components.reduce((s, c) => s + Number(c.Rate || 0), 0),
        });
      }
      return pkgs;
    }

    // Called from Pending Jobs panel — injects this job's packages into the Package mirror.
    function syncJobToMirror(job) {
      if (!job._packages || !job._packages.length) {
        alert('This job has no per-package data (delete jobs or Rate List jobs are not auto-injectable to the Package mirror).');
        return;
      }
      let injected = 0;
      for (const p of job._packages) {
        if (SRKPackageMaster.injectVariant(p)) injected++;
      }
      job._mirroredAt = new Date().toISOString();
      // Persist updated job back to pending storage.
      const idx = pending.value.findIndex(j => j.id === job.id);
      if (idx >= 0) pending.value[idx] = { ...job };
      reloadPk();
      alert(`Injected ${injected} package variant(s) into the Package Master mirror.`);
    }

    // ---------- Pending tab actions ----------
    function deleteJob(id) {
      if (!confirm('Delete this job?')) return;
      pending.value = pending.value.filter(j => j.id !== id);
    }
    function clearAllPending() {
      if (!confirm('Clear all pending jobs?')) return;
      pending.value = [];
    }
    function copyJobJson(j) {
      navigator.clipboard.writeText(JSON.stringify(j, null, 2)).then(() => {
        alert('Job JSON copied to clipboard.');
      });
    }

    // ---------- Bridge handshake ----------
    // The mega-script (when @match'd to this URL) listens on window.message and
    // replies with {srkBridge:true, kind:'pong'} when it sees a 'ping'.
    function pingBridge() {
      window.postMessage({ srkStudio: true, kind: 'ping' }, '*');
    }
    function onMessage(ev) {
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.srkBridge === true) {
        if (d.kind === 'pong')        bridgeLive.value = true;
        if (d.kind === 'jobReceived') console.log('[bridge] jobReceived', d.jobId);
      }
    }

    onMounted(() => {
      window.addEventListener('message', onMessage);
      pingBridge();
      bridgePingTimer = setInterval(() => {
        bridgeLive.value = false;
        pingBridge();
      }, 3000);
    });

    return {
      tab,
      templates, selected, selectedId, selectTemplate,
      editingId, editingDraft, startEdit, cancelEdit, saveEdit,
      addInput, removeInput, addFixed, removeFixed,
      addFormula, removeFormula, addExtra, removeExtra,
      addDerived, removeDerived,
      newTemplate, deleteTemplate, duplicateTemplate, resetDefaults,
      exportAll, importText, showImport, doImport,
      jobTemplateId, jobTemplate, csvText, action,
      computedRows, okCount, errCount, computeAll,
      downloadCsvTemplate, loadCsvFile, ship, jobNote,
      pending, deleteJob, clearAllPending, copyJobJson, syncJobToMirror,
      bridgeLive, pingBridge,
      // Rate List
      rlImported, rlWorking, rlFilterType, rlSearch, rlPage, rlPageSize,
      rlAllRows, rlFiltered, rlPageRows, rlPageCount, rlTypes,
      rlImportFromRepo, rlImportFromFile,
      rlEditCell, rlDeleteRow,
      rlNewRow, rlBeginAdd, rlCancelAdd, rlConfirmAdd,
      rlDiff, rlPendingCount, rlShipPending, rlMarkSynced, rlSyncBusy,
      // Package Master
      pkImported, pkWorking, pkFilterType, pkSearch, pkPage, pkPageSize,
      pkAllRows, pkFiltered, pkPageRows, pkPageCount, pkTypes,
      pkImportFromRepo, pkImportFromFile,
      pkToggleExpand, pkIsExpanded, pkDeleteRow, pkDeleteAllFiltered, pkEditComponent,
      pkDiff, pkPendingCount, pkShipPending, pkMarkSynced,
      // Lens Register
      lensImported, lensRows, lensSearch, lensVendor, lensYellowOnly, lensPage, lensPageSize,
      lensVendors, lensFiltered, lensPageRows, lensPageCount,
      lensYellowCount, lensReadyCount,
      lensImportFromFile, lensEditCell, lensRowReadiness, lensRowPortalMatches,
    };
  },
}).mount('#app');
