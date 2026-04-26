# SRK Rate Studio

Template-driven rate & package builder for [srk.rxhis.com](https://srk.rxhis.com). Hosted at:

**https://ral772.github.io/srk-rate-studio/**

This is the **front-end** half of a two-part system:

1. **Studio** (this repo, served via GitHub Pages) — define templates, upload CSVs, compute components, preview, ship jobs.
2. **Mega-script** (Tampermonkey, runs on the SRK portal) — receives shipped jobs and executes Add/Update/Delete on the portal.

The two communicate via `window.postMessage`. The mega-script is `@match`'d against this Pages URL too, so when you click **Ship**, the script (running in your browser via Tampermonkey) picks the job up and queues it. Switch to your SRK tab → it auto-runs.

## Tabs

- **Templates** — 9 surgery templates pre-loaded (Cataract Standard, TPA variants, Injections, Others). Edit, duplicate, delete, import/export. All edits persist in localStorage.
- **Build Job** — pick a template → download CSV with the right columns → fill in just the inputs (e.g., Package Name + Total + Lens for Cataract Standard) → upload → preview with full computed components → choose Add/Update/Delete → Ship.
- **Pending Jobs** — log of everything you've shipped from this Studio. The mega-script picks them up; you can also copy job JSON to clipboard for manual paste.

## Local development

Open `index.html` directly in a browser. No build step. Vue 3 loaded via CDN.

## Pushing changes

Edit files locally, then via GitHub Desktop or `git`:

```
git add -A && git commit -m "describe change" && git push
```

GitHub Pages redeploys automatically (~30s).

## Bridge protocol

Studio emits these `window.postMessage` events:

- `{ srkStudio: true, kind: 'ping' }` — every 3s, used to detect the mega-script.
- `{ srkStudio: true, kind: 'jobShipped', job: { id, items, action, ... } }` — when user clicks Ship.

Mega-script replies:

- `{ srkBridge: true, kind: 'pong' }` — sets the "Bridge: live" indicator.
- `{ srkBridge: true, kind: 'jobReceived', jobId }` — confirms acceptance.

## Repo structure

- `index.html` — app shell + Vue templates
- `app.js` — Vue 3 root component
- `templates.js` — 9 default templates + localStorage persistence
- `compute.js` — formula evaluator + CSV parser + job spec builder
- `styles.css` — dark theme
