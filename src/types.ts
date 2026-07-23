// ─────────────────────────────────────────────────────────────────────────────
// Result-bundle contract (schema v1)
//
// This is the SINGLE interface between analysis engines and the explorer.
// Both the in-browser (webR/WASM) engine and the desktop (local R/DESeq2) engine
// emit exactly this shape; the explorer only ever reads it. Keep it stable.
//
// A bundle is a folder (or a .zip / a JSON manifest) containing:
//   meta.json                    ← BundleMeta (below)
//   samples.csv                  ← sample, condition, [covariate columns…]
//   normalized_counts.csv        ← gene_id, [gene_name,] <sample1>, <sample2>, …
//   deg_<contrastId>.csv         ← one per contrast (DEGRow columns)
//   enrichment_<contrastId>.csv  ← one per contrast, optional (EnrichmentRow columns)
// ─────────────────────────────────────────────────────────────────────────────

export interface Contrast {
  id: string            // e.g. "KO_vs_WT" — used to locate deg_/enrichment_ files
  numerator: string     // group on top of the log2 ratio (e.g. "KO")
  denominator: string   // reference / control group (e.g. "WT")
  label: string         // human label, e.g. "KO vs WT"
  deg_file: string
  enrichment_file?: string
  n_deg?: number
  padj_threshold?: number
  lfc_threshold?: number
}

export interface BundleMeta {
  schema: 1
  project: string
  species: string
  created: string                 // ISO date
  engine: 'desktop-R' | 'webr-wasm' | string
  control: string                 // reference condition
  conditions: string[]
  gene_id_type: 'ensembl' | 'symbol' | 'entrez' | string
  counts_unit: string             // e.g. "DESeq2 normalized (median-of-ratios)"
  contrasts: Contrast[]
  n_genes?: number
  n_samples?: number
}

export interface SampleRow {
  sample: string
  condition: string
  [covariate: string]: string
}

// One row of the DESeq2 results table.
export interface DEGRow {
  gene_id: string
  gene_name: string
  baseMean: number
  log2FoldChange: number
  lfcSE: number | null
  pvalue: number | null
  padj: number | null
}

// One row of an ORA or GSEA enrichment table (unified).
export interface EnrichmentRow {
  source: string          // "GO:BP" | "KEGG" | "Reactome" | "WikiPathways" | "GSEA:H" …
  method: 'ORA' | 'GSEA' | string
  id: string
  description: string
  direction: 'up' | 'down' | 'both' | string
  setSize: number
  count: number           // overlap size (ORA) or leading-edge size (GSEA)
  score: number | null    // NES for GSEA, fold-enrichment for ORA (nullable)
  pvalue: number | null
  padj: number | null
  geneID?: string         // "/"-separated member genes, if provided
}

// The parsed, in-memory bundle the explorer works with.
export interface Bundle {
  meta: BundleMeta
  samples: SampleRow[]
  counts: CountsMatrix
  degByContrast: Record<string, DEGRow[]>
  enrichmentByContrast: Record<string, EnrichmentRow[]>
}

// Column-oriented counts for fast per-gene lookup.
export interface CountsMatrix {
  geneIds: string[]
  geneNames: string[]                 // parallel to geneIds ("" if none)
  samples: string[]                   // column order
  values: Float64Array                // row-major: gene i, sample j → values[i*S + j]
  index: Map<string, number>          // gene_id AND upper(gene_name) → row i
}
