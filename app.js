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
      };
      pending.value.unshift(job);
      jobNote.value = '';
      // Notify any listening bridge in the page (mega-script will postMessage back if it's there).
      window.postMessage({ srkStudio: true, kind: 'jobShipped', job }, '*');
      tab.value = 'pending';
      alert(`Shipped job with ${items.length} item(s). Switch to your SRK tab — the mega-script should pick it up.`);
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
      pending, deleteJob, clearAllPending, copyJobJson,
      bridgeLive, pingBridge,
    };
  },
}).mount('#app');
