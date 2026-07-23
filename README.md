# RNA-seq Studio

Interactive bulk RNA-seq **differential-expression & enrichment explorer** — search any
gene's expression across conditions, browse volcano plots and DEG tables, and inspect
pathway enrichment. Runs entirely in your browser; **your data never leaves your device.**

This is the front-end + shared contract for a dual-target tool extracted from a local
DESeq2 pipeline. See **Architecture** below.

---

## Architecture

One React + Plotly UI, fed by a fixed **result-bundle** format, with two interchangeable
analysis engines behind it:

```
                 ┌─────────────────────────────┐
   small data →  │  in-browser engine (webR)   │ ─┐
                 └─────────────────────────────┘  │   result bundle
                 ┌─────────────────────────────┐  ├──► (meta.json + CSVs) ──► Explorer (this app)
   large data →  │  desktop engine (local R)   │ ─┘
                 └─────────────────────────────┘
```

- **GitHub Pages build** (this repo): the explorer + an in-browser WASM engine for small
  datasets. Zero install, shareable URL.
- **Desktop app** (Electron, planned): the same UI wrapping the full local R/DESeq2
  pipeline for large datasets, using all CPU cores.

Because both engines emit the **same bundle**, the explorer is engine-agnostic — it only
ever reads files. That is what lets the UI ship before either engine is finished.

### The result-bundle contract (schema v1)

A bundle is a folder (uploaded via **Open analysis folder**, or served under `/sample/`):

| File | Contents |
|------|----------|
| `meta.json` | project, species, control group, contrasts (see `src/types.ts` → `BundleMeta`) |
| `samples.csv` | `sample, condition, [covariates…]` |
| `normalized_counts.csv` | `gene_id, [gene_name,] <sample1>, <sample2>, …` (DESeq2-normalized) |
| `deg_<contrastId>.csv` | `gene_id, gene_name, baseMean, log2FoldChange, lfcSE, pvalue, padj` |
| `enrichment_<contrastId>.csv` | `source, method, id, description, direction, setSize, count, score, pvalue, padj` (optional) |

The full typed contract lives in [`src/types.ts`](src/types.ts).

---

## Develop

```bash
npm install
node scripts/gen-sample.mjs   # writes the demo bundle to public/sample/
npm run dev                   # http://localhost:5173
npm run build && npm run preview
```

## Load your own analyses (bridge exporter)

Convert a finished bulk RNA-seq analysis (a `~/RNAseq_Analyses/<project>` folder from the
DESeq2 pipeline) into a Studio bundle, then open it with **Open analysis folder**:

```bash
Rscript scripts/export-bundle.R  <path-to-analysis-dir>  [out-dir]
# → writes <analysis-dir>/studio_bundle/  (or per-cell-type subfolders)
```

It reads the DESeq2 object from the analysis's `.RData` (normalized counts), the
`*_DEG_full.csv` tables, and the per-direction / GSEA enrichment CSVs, and emits the
`meta.json` + CSV bundle. Requires R with DESeq2. **Keep bundles of sensitive/patient data
local — do not commit them or deploy them to Pages.**

## Deploy to GitHub Pages

Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes to
Pages automatically. In the repo settings, set **Pages → Source → GitHub Actions** once.
The app uses a relative base path, so it works under `https://<user>.github.io/<repo>/`
with no config.

---

## Roadmap

- [x] **Phase 1** — Explorer (gene expression, volcano, DEG table, enrichment) + bundle
      contract + Pages deploy. *(this)*
- [x] **Bridge exporter** — `scripts/export-bundle.R` converts existing DESeq2 pipeline
      outputs into Studio bundles.
- [ ] **Phase 2** — In-browser small-data engine: webR (DESeq2 WASM) + JS-side enrichment
      (bundled GMT gene sets, hypergeometric ORA / fgsea-style GSEA).
- [ ] **Phase 3** — Desktop app: Electron shell around the local R/DESeq2 engine for
      large datasets.
