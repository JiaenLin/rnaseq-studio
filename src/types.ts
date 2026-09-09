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
  /** 1 for a gene-only bundle; 2 exactly when `transcript_layer` is present. */
  schema: 1 | 2
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
  /**
   * Which estimator `log2FoldChange` holds in this bundle's tables — 'none'
   * for the maximum likelihood estimate, 'apeglm' for the shrunken posterior.
   *
   * Absent on bundles written before the exporter recorded it. Read only to
   * TELL the reader what they are looking at: nothing here recomputes on it,
   * and a re-run performed in this app is filed under its own id rather than
   * replacing the table it was compared against.
   */
  shrinkage?: 'none' | 'apeglm' | string
  /**
   * How the library was sequenced. Absent on every schema-v1 bundle, which is
   * how the app tells a gene-only bundle from one carrying an isoform layer
   * without opening a single other file.
   */
  platform?: 'short-read' | 'long-read' | string
  /** Present only on long-read bundles. See `TranscriptLayer`. */
  transcript_layer?: TranscriptLayer | null
  /**
   * Per-sample long-read QC, when the pipeline measured it.
   *
   * REPORTED, NEVER ENFORCED. Nothing in this app filters a sample, hides a
   * result, or refuses a run on the basis of any number here. A heart library
   * that is 90% mitochondrial may be a degraded prep or may be heart; this app
   * is not in a position to know which, and a threshold would be this app
   * asserting an answer it does not have.
   */
  longread_qc?: LongReadQC[] | null
}

/** What a long-read bundle adds. Every field additive; nothing here replaces the gene layer. */
export interface TranscriptLayer {
  annotation: string              // "transcripts.csv"
  counts: string                  // "transcript_counts.csv"
  n_transcripts: number
  n_novel: number
  /** contrast id -> "dte_<id>.csv"; transcript-level DESeq2. */
  dte_files: Record<string, string>
  /** contrast id -> "dtu_<id>.csv"; differential transcript USAGE. */
  dtu_files: Record<string, string>
  /** Named because a different engine's numbers are not comparable. */
  dtu_engine?: string
  dtu_filter?: string
  /** What `usage_effect` is measured in. See `DTURow.usage_effect`. */
  dtu_effect_scale?: string
  /**
   * Which vocabulary `structural_category` in transcripts.csv speaks.
   *
   * 'bambu' is that tool's own class strings (`newWithin`,
   * `newLastJunction:newJunction:newLastExon`); 'sqanti' is SQANTI3's
   * categories (`full-splice_match`, `novel_in_catalog`); 'mixed' is a partial
   * join and is a real answer. Absent means the writer did not record it —
   * then the categories are shown but not named as either.
   */
  category_vocabulary?: 'bambu' | 'sqanti' | 'mixed' | 'none' | string
  /** How the transcript-level DESeq2 was fitted; it does not reconcile with the gene layer. */
  dte_fit?: string
}

/** One row of transcripts.csv. */
export interface TranscriptRow {
  transcript_id: string
  gene_id: string
  gene_name: string
  transcript_name: string
  /**
   * What to SHOW. `Nppb-201` for an annotated model, `Nppb-novel-1` for a novel
   * isoform of a known gene, the accession when there is nothing better.
   * The accession is never lost — it stays the key of every table.
   */
  display_name: string
  /** SQANTI3: full-splice_match, novel_in_catalog, novel_not_in_catalog, … */
  structural_category: string
  novel: boolean
}

/** One row of a dtu_<contrast>.csv. */
export interface DTURow {
  transcript_id: string
  gene_id: string
  /**
   * Change in this isoform's SHARE of its gene, not in its absolute level.
   *
   * The SCALE depends on the engine and is named in
   * `transcript_layer.dtu_effect_scale` — satuRn's is a change in log odds of
   * usage, which is not a log2 fold change. Nothing here converts it, and it is
   * used only to rank isoforms within a gene, where any monotone scale agrees.
   */
  usage_effect: number | null
  pvalue: number | null
  padj: number | null
  /** The gene's own q-value across all its isoforms. */
  gene_padj: number | null
  /** Observed mean share in each group, written by the engine that did the test. */
  mean_usage_num: number | null
  mean_usage_den: number | null
}

/** One sample's long-read QC. Every field optional; pipelines differ. */
export interface LongReadQC {
  sample: string
  total_reads?: number | null
  unmapped_pct?: number | null
  mt_pct?: number | null
  rrna_pct?: number | null
  nuclear_alignments?: number | null
  median_read_length?: number | null
  read_n50?: number | null
  median_polya?: number | null
  /**
   * Share of reads a poly(A) tail was actually CALLED on.
   *
   * Reported beside the median because the median alone cannot tell short tails
   * from mostly-no-tail. dorado writes `pt:i:0` when it finds no tail, and on
   * ONT direct-RNA data a quarter of reads can be 0 — counting those as
   * zero-length measurements puts the median of the real tails at ~10 nt.
   */
  polya_called_pct?: number | null
  transcripts_detected?: number | null
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
  /** The isoform layer, when the bundle carries one. Absent is the common case. */
  transcripts?: TranscriptRow[]
  transcriptCounts?: CountsMatrix
  /** contrast id -> transcript-level DESeq2 rows (same shape as a DEG table). */
  dteByContrast?: Record<string, DEGRow[]>
  /** contrast id -> usage rows. */
  dtuByContrast?: Record<string, DTURow[]>
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
