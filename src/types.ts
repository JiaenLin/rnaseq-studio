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
//   raw_counts.csv               ← same shape, un-normalized; optional, enables
//                                  running DESeq2 here for un-exported pairs
//   deg_<contrastId>.csv         ← one per contrast (DEGRow columns)
//   enrichment_<contrastId>.csv  ← one per contrast, optional (EnrichmentRow columns)
// ─────────────────────────────────────────────────────────────────────────────

export interface Contrast {
  id: string            // e.g. "KO_vs_WT" — used to locate deg_/enrichment_ files
  numerator: string     // group on top of the log2 ratio (e.g. "KO")
  denominator: string   // reference / control group (e.g. "WT")
  /**
   * What kind of question this contrast asks. Absent in schema v1 bundles,
   * where every contrast is pairwise.
   *
   * 'interaction' is not a comparison between two groups at all — it is a model
   * coefficient asking whether one factor's effect DEPENDS on another, and its
   * `numerator` is the coefficient's name ("KO:Thermo") with `denominator` the
   * literal string "interaction". Reading those two as group labels is what
   * produced "DESeq2 needs at least 2 replicates per group (KO:Thermo: 0)" on a
   * design where every group had six: they are not groups, and no sample was
   * ever going to have that condition.
   *
   * rnaseq-lab has always written this field. This app did not read it.
   */
  kind?: 'pairwise' | 'interaction'
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
  /**
   * The covariate whose levels were fitted SEPARATELY, when the exporter
   * blocked the run — tissue, cell line, cohort.
   *
   * Absent on every bundle written before blocking existed, and on every
   * unblocked one, which is the common case: one fit spans every group and
   * nothing in lib/crossblock.ts applies. When present it names a column in
   * samples.csv, and it changes what the bundle means — the DEG tables come
   * from one fit per level, so no comparison ACROSS levels was ever fitted.
   */
  block_factor?: string | null
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
  /** Shrunk (apeglm) when the exporter shrank it, else the MLE. What to display. */
  log2FoldChange: number
  lfcSE: number | null
  pvalue: number | null
  padj: number | null
  /**
   * The UNSHRUNK maximum-likelihood estimate and its standard error.
   *
   * Present only on bundles new enough to carry them. Needed for any comparison
   * BETWEEN fits: a shrinkage prior is fitted per fit, so a block full of strong
   * effects is shrunk by a different amount from a quiet one, and comparing
   * shrunk values across blocks reads that difference as biology. Display the
   * shrunk value; compare these. When the exporter shrank nothing these equal
   * log2FoldChange, which is harmless — the comparison is then like for like.
   */
  log2FoldChange_MLE?: number | null
  lfcSE_MLE?: number | null
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

// Full gene-set definition (all members) — enables live, tunable ORA in the browser.
// Loaded from an optional genesets.csv (long format: source,set_id,set_name,gene).
export interface GeneSetDef {
  source: string
  id: string
  name: string
  genes: string[]
}

// The parsed, in-memory bundle the explorer works with.
export interface Bundle {
  meta: BundleMeta
  samples: SampleRow[]
  counts: CountsMatrix
  /**
   * Raw (un-normalized) counts, when the exporter includes them. DESeq2 models
   * raw counts and derives its own size factors, so comparing a pair the
   * pipeline did not export requires this — the normalized matrix cannot stand
   * in without violating the model.
   */
  rawCounts?: CountsMatrix
  degByContrast: Record<string, DEGRow[]>
  enrichmentByContrast: Record<string, EnrichmentRow[]>
  genesets?: GeneSetDef[]
}

// Column-oriented counts for fast per-gene lookup.
export interface CountsMatrix {
  geneIds: string[]
  geneNames: string[]                 // parallel to geneIds ("" if none)
  samples: string[]                   // column order
  values: Float64Array                // row-major: gene i, sample j → values[i*S + j]
  index: Map<string, number>          // gene_id AND upper(gene_name) → row i
}
