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
- **Only Ensembl IDs?** A bundle keyed by accessions is converted to gene symbols on open —
  species auto-detected from the accessions themselves (ENSG / ENSMUSG), human and mouse. It is
  not cosmetic: MSigDB is written in symbols, so before the conversion an accession-keyed bundle
  had an annotated background of **zero** and enrichment returned an empty page rather than an
  error. Nothing is merged where two accessions share a symbol, every table keeps the accession
  beside the symbol, and the banner says how many mapped.
- **Overlap (Venn)** — intersect the DEG lists of two or more comparisons: a proportional Venn
  for up to four, an UpSet matrix beyond that, up to six in all. Every wedge is *exclusive* and
  clickable — the genes in exactly those comparisons and no others — with each gene's log2FC and
  padj side by side per comparison, so on a 2×2 you can read off what a treatment does in both
  backgrounds, what is unique to one, and (with **same direction only**) which "shared" genes are
  actually moving opposite ways. Exports to PNG, SVG and CSV. Any wedge converts into a gene set:
  **Test for enrichment** runs ORA on it against MSigDB (with the genes those comparisons tested
  as the background), and **Save as gene set** adds it to the library, where it is scored per
  sample and tested exactly like a pasted one.
- **Enrichment — two tests over the same library.** **ORA** is live and tunable: set your padj /
  log2FC / direction and watch enriched pathways update. **GSEA** (pre-ranked, Subramanian 2005)
  ranks *every* tested gene — by DESeq2's Wald statistic, the combined score, signed −log10 p or
  log2FC — and asks where each set sits in that ranking, so no cutoff is applied and a
  coordinated shift too small to make any DEG list is still found. Signed NES, permutation
  p-values with BH correction, the classic running-score figure and the leading-edge genes.
  Both run against **the whole of MSigDB**, human and mouse, fetched a collection at a time;
  both drill into a term's genes and export every set to CSV.
- **Gene sets** — search the same library and score any set per sample, *or* define your own;
  get their DEG overlap, an ORA activity readout, and a per-sample module score (rank
  running-sum, mean rank, or mean z-score).
- **Your own signatures** — paste them in whatever you have them in: a Python or R dict, JSON,
  a GMT, `Name: gene, gene` lines, or a bare gene list. The editor shows what it understood and
  which genes your data does not carry *before* anything is added, and your sets are then tested
  and corrected exactly as MSigDB's are.
- **Any comparison** — pick the control and the arms to compare. If your bundle did not export
  that pair, Studio runs **DESeq2 itself** (R compiled to WebAssembly), so every number in the
  app comes from DESeq2 — never a lighter substitute. Needs `raw_counts.csv`.
- **Methods** — a draft Methods paragraph for your manuscript, written from the cutoffs you
  actually set on the other tabs. Change a threshold and the text follows; copy or download it.
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
| `raw_counts.csv` *(optional)* | same shape, un-normalized — lets Studio run DESeq2 on pairs you did not export |
| `deg_<contrast>.csv` | `gene_id, gene_name, baseMean, log2FoldChange, lfcSE, pvalue, padj` |
| `genesets.csv` *(optional)* | `source, set_id, set_name, genes` — offered as one more collection beside MSigDB |

One `deg_<contrast>.csv` per contrast (named in `meta.json`); missing values may be `NA`. The
full typed spec is in [`src/types.ts`](src/types.ts).

## Producing bundles → the analysis app

RNA-seq Studio is only the **viewer**. Bundles are produced by a separate analysis app that runs
the DESeq2 pipeline (counts → differential expression → enrichment) and writes the files above.

> **📦 Analysis app — [RNA-seq Lab](https://jiaenlin.github.io/rnaseq-lab/)**
> ([source](https://github.com/JiaenLin/rnaseq-lab)): run **limma-voom** or **DESeq2** on your
> counts entirely in the browser (via webR) and get a bundle to open here.

> **🧫 Only have raw FASTQ files? — [RNA-seq Service](https://jiaenlin.github.io/rnaseq-service/)**
> ([source](https://github.com/JiaenLin/rnaseq-service)): scan your sequencing folder, name your
> samples, and generate an analysis request.

_(An interim reference exporter for the existing R pipeline also lives in `scripts/export-bundle.R`.)_

---

## How to cite

If RNA-seq Studio is useful in your work, please cite it (see [`CITATION.cff`](CITATION.cff)).
A citable DOI is minted per release via Zenodo; a software paper is in `paper/`.

## Develop

```bash
npm install
node scripts/gen-sample.mjs   # regenerate the demo bundle in public/sample/
npm test                      # bundle parsing, the ORA and GSEA maths, the gene-set library, the Venn geometry
npm run dev                   # http://localhost:5173
npm run build && npm run preview
```

### Gene symbols

`public/symbols/` holds Ensembl gene id → symbol for human and mouse (~0.8 MB gzipped, fetched
only when a bundle needs it), built from Ensembl BioMart and committed for the same reason the
gene sets are — CI and the deploy need no network. Rebuild after an Ensembl release:

```bash
node scripts/fetch-symbols.mjs
```

### The gene-set library

`public/genesets/` holds MSigDB packed into a compact indexed format, one file per collection
per species, plus a manifest the app reads before downloading anything. The assets are
committed, so CI and the deploy need no network and no R. To rebuild them after an MSigDB
release:

```bash
Rscript scripts/export-genesets.R scratch-msigdb/gmt   # needs R + msigdbr
node scripts/fetch-genesets.mjs                        # pack + write the manifest
```

**Tumour phenotype** is MSigDB's mouse `M5:MPT`, and it is named for what it holds. The Broad
calls it the *Tumor* Phenotype Ontology — 92 sets, every one a neoplasia term mined out of the
Mammalian Phenotype Ontology — so offering it as "Mouse phenotype" directly under human's "Human
phenotype" (the HPO: 5,793 sets, every phenotype there is) invited the reading that they are a
species pair. They are not.

**Metabolic** is a collection assembled here rather than published by the Broad: MSigDB has no
metabolic collection, so `scripts/derive-metabolic.mjs` selects the metabolic pathways and
ontology terms out of KEGG, Reactome, WikiPathways, Hallmark, PID, BioCarta and GO by a
hand-curated list of terms (`scripts/metabolic-terms.tsv`, one line per term, arguable in a
diff). Its sets carry their own `METABOLIC_` ids so enabling it always adds them — which means
a pathway also present in an enabled parent is tested twice, and the app says so on the card.

Stack: React + TypeScript + Vite + Tailwind + Plotly; zip via `fflate`. No backend.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub
Pages automatically. The app uses a relative base path, so it works under
`https://<user>.github.io/<repo>/` with no extra config.
