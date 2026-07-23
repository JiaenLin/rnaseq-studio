---
title: 'RNA-seq Studio: a privacy-preserving, client-side interactive explorer for bulk RNA-seq results'
tags:
  - RNA-seq
  - differential expression
  - gene set enrichment
  - over-representation analysis
  - data visualization
  - JavaScript
authors:
  - name: Jiaen Lin
    orcid: 0000-0000-0000-0000
    affiliation: 1
affiliations:
  - name: "Affiliation to be completed"
    index: 1
date: 24 July 2026
bibliography: paper.bib
---

# Summary

`RNA-seq Studio` is a web application for interactively exploring the results of a
bulk RNA-seq differential-expression analysis. Given a small, self-describing
**bundle** of files — normalized counts, a sample sheet, one differential-expression
table per contrast, and optional gene-set definitions — it renders per-gene and
per-list expression views, interactive volcano plots, sortable differential-expression
(DEG) tables, tunable over-representation analysis (ORA), and per-sample gene-set
activity scores. Every computation and chart runs **entirely in the user's browser**;
no server is involved and no data is uploaded, so the tool can be served as static
files from any host and used with sensitive or clinical data that must not leave the
analyst's machine.

# Statement of need

Interactive exploration is essential for interpreting bulk RNA-seq experiments, but
most existing explorers are server-hosted Shiny or web applications — for example iDEP
[@ge2018idep], DEBrowser [@kucukural2019debrowser], Degust [@powell2019degust], and
ShinyGO [@ge2020shinygo] — which require the user to **upload their data** to a remote
server. This is a barrier for clinical and other confidential datasets, where data
governance often forbids transfer to third-party servers. Tools that keep data local,
such as `iSEE` [@rueangbroeck2018isee], instead require a running R/Bioconductor
session and bind the input to Bioconductor `SummarizedExperiment` objects, which
raises the barrier for non-R users and couples exploration to a specific analysis
stack.

`RNA-seq Studio` addresses both problems. It is (i) **fully client-side**: it needs no
server, no installation, and no upload, so confidential data never leaves the device
and the app can be deployed to any static host (e.g. GitHub Pages) at zero cost; and
(ii) **pipeline-agnostic**: it reads a simple documented bundle format rather than a
specific tool's objects, so any analysis pipeline can produce inputs it can display.
This decoupling of analysis from visualization lets a laboratory or core facility run
whatever differential-expression pipeline it prefers and hand collaborators an
interactive, self-contained result they can open in a browser.

# Features

- **Gene expression**: search a single gene or a gene list; per-group expression with
  group means, a per-gene DEG bar plot, a z-scored expression heatmap, and a gene-set
  module score.
- **Volcano plot**: interactive, with tunable −log10(padj) and |log2FC| thresholds and
  click-through to a gene.
- **DEG table**: sortable and filterable, with a combined score (−log10 p × log2FC) and
  CSV export.
- **Enrichment**: real-time over-representation analysis (hypergeometric test with
  Benjamini–Hochberg correction) computed in the browser against a bundled gene-set
  library, with user-adjustable significance and fold-change thresholds and per-term
  gene drill-down.
- **Gene sets**: user-defined sets with DEG-overlap statistics, an ORA activity
  read-out, and per-sample activity scores (a weighted rank running-sum, a mean-rank
  score, or a mean z-score).
- All charts export to PNG; the entire session runs offline after first load.

`RNA-seq Studio` is implemented in TypeScript with React and Plotly, and reads and
writes standard CSV/JSON, so its bundle format is easy to target from R, Python, or any
workflow. The differential-expression conventions follow standard practice
[@love2014deseq2].

# Comparison with existing tools

| | Runs in | Data uploaded | Needs R / install | Input |
|---|---|---|---|---|
| **RNA-seq Studio** | browser (static) | **no** | **no** | pipeline-agnostic bundle |
| iDEP | server | yes | no | counts |
| DEBrowser | server (Shiny) | yes | optional R | counts |
| Degust | server | yes | no | counts |
| ShinyGO | server | yes | no | gene list |
| iSEE | local R/Shiny | no | yes (R) | SummarizedExperiment |

# Acknowledgements

The author thanks colleagues who tested the tool on real datasets.

# References
