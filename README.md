# RNA-seq Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live app](https://img.shields.io/badge/demo-live-brightgreen)](https://jiaenlin.github.io/rnaseq-studio/)
[![DOI](https://zenodo.org/badge/1310113114.svg)](https://zenodo.org/badge/latestdoi/1310113114)

**An interactive explorer for bulk RNA-seq results — right in your browser.**

👉 **[Open the live app](https://jiaenlin.github.io/rnaseq-studio/)**

Load a result bundle and explore differential expression and pathway activity: search any
gene, scan volcano plots, sort DEG tables, run tunable enrichment, and score your own gene
sets. Everything runs client-side — **your data never leaves your device** (nothing is uploaded).

---

## What you can do

- **Gene expression** — search a single gene *or* a whole list; see per-group expression,
  group means, a per-gene DEG bar plot, an expression heatmap, and a set module score.
- **Volcano** — interactive, with tunable −log10(padj) and |log2FC| cutoffs; click a point to
  jump to that gene.
- **DEG table** — sortable/filterable, with a combined score (−log10 p × log2FC) and CSV export.
- **Enrichment** — live, tunable over-representation analysis (ORA): set your padj / log2FC /
  direction and watch enriched pathways update; drill into a term's genes and their stats.
- **Gene sets** — define your own sets and get their DEG overlap, an ORA activity readout, and
  a per-sample module score (rank running-sum, mean rank, or mean z-score).
- Every chart exports to **PNG**.

## Using it

1. Open **[the live app](https://jiaenlin.github.io/rnaseq-studio/)** (it starts on a demo dataset).
2. Click **⭱ Open bundle (.zip)** — or just **drop a `.zip` anywhere** on the page. An unzipped
   folder works too (**folder…**).
3. Explore. To load a different dataset, open another bundle.

---

## The bundle format (brief)

A **bundle** is the small set of files the explorer reads — any pipeline that emits this format
works. Zip the folder (or drop the folder itself):

| File | Contents |
|------|----------|
| `meta.json` | project, species, control group, and the list of contrasts |
| `samples.csv` | `sample, condition, [covariates…]` |
| `normalized_counts.csv` | `gene_id, [gene_name,] <sample1>, <sample2>, …` |
| `deg_<contrast>.csv` | `gene_id, gene_name, baseMean, log2FoldChange, lfcSE, pvalue, padj` |
| `genesets.csv` *(optional)* | `source, set_id, set_name, genes` — enables live ORA |

One `deg_<contrast>.csv` per contrast (named in `meta.json`); missing values may be `NA`. The
full typed spec is in [`src/types.ts`](src/types.ts).

## Producing bundles → the analysis app

RNA-seq Studio is only the **viewer**. Bundles are produced by a separate analysis app that runs
the DESeq2 pipeline (counts → differential expression → enrichment) and writes the files above.

> **📦 Analysis app:** _coming soon_ — repository link will go here.

_(An interim reference exporter for the existing R pipeline lives in `scripts/export-bundle.R`.)_

---

## How to cite

If RNA-seq Studio is useful in your work, please cite it (see [`CITATION.cff`](CITATION.cff)).
A citable DOI is minted per release via Zenodo; a software paper is in `paper/`.

## Develop

```bash
npm install
node scripts/gen-sample.mjs   # regenerate the demo bundle in public/sample/
npm run dev                   # http://localhost:5173
npm run build && npm run preview
```

Stack: React + TypeScript + Vite + Tailwind + Plotly; zip via `fflate`. No backend.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub
Pages automatically. The app uses a relative base path, so it works under
`https://<user>.github.io/<repo>/` with no extra config.
