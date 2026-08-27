// Methods-text generator.
//
// Produces ONE continuous paragraph under a single subsection heading — the way a
// Methods section is actually written — with numbered in-text citations that map
// to a reference list built from the tools this bundle really used.
//
// The thresholds a user explored with live inside each analysis tab as local
// state. Rather than lifting all of it into App (and re-rendering the whole
// explorer on every slider drag), each tab *reports* its current settings into
// this tiny external store. The Methods tab subscribes. Tabs unmount when you
// leave them, but their last reported settings persist — which is what a
// write-up needs.

import { useEffect, useSyncExternalStore } from 'react'
import type { Bundle, Contrast } from '../types'

export const STUDIO_VERSION = 'v1.0.0'
export const STUDIO_DOI = '10.5281/zenodo.21514152'

export interface DeParams { padjThr: number; lfcThr: number }
export interface OraParams {
  padjMax: number
  lfcMin: number
  direction: 'both' | 'up' | 'down'
  minSize: number
  maxSize: number
  sources: string[]
  nSets: number
  nDeg: number
  nBackground: number
  nSig: number
  /**
   * Where the tested gene list came from, when it was not this contrast's DEGs.
   *
   * A wedge of the Overlap Venn is a list assembled from several comparisons,
   * and the padj / log2FC fields above are then the defaults the tab happens to
   * be holding rather than anything that touched it. Without this the paragraph
   * described a filtering step that never ran.
   */
  query?: string | null
}
export interface SetParams {
  nSets: number
  /**
   * How many of them were taken out of the library rather than typed.
   *
   * The sentence used to say "user-defined gene sets" unconditionally, which
   * was true while typing was the only way in. A set scored from MSigDB has a
   * source and a systematic id and a paper behind it, and calling it
   * user-defined in a Methods section misdescribes where it came from.
   */
  nLibrary: number
  /** The collections those came from, so the sentence can cite them. */
  librarySources: string[]
  scoreMethod: 'runningsum' | 'meanrank' | 'meanz'
  padjMax: number
  lfcMin: number
  direction: 'both' | 'up' | 'down'
}

export interface OverlapParams {
  nSets: number
  labels: string[]
  padjMax: number
  lfcMin: number
  direction: 'both' | 'up' | 'down'
  concordantOnly: boolean
  /** Genes significant in every one of them. */
  shared: number
  /** Genes significant in at least one. */
  union: number
}

export interface GseaParams {
  metric: 'stat' | 'combined' | 'log2FC' | 'signedP'
  nperm: number
  minSize: number
  maxSize: number
  nSets: number
  nRanked: number
  nSig: number
  sources: string[]
}

export interface PcaParams {
  /** Genes entering the decomposition — DESeq2's ntop. */
  ntop: number
  /** How many actually entered, which is ntop capped by the genes that vary. */
  nGenes: number
  nSamples: number
  pcX: number
  pcY: number
  varX: number
  varY: number
}

export interface MethodsState {
  de: DeParams
  ora: OraParams | null
  sets: SetParams | null
  pca: PcaParams | null
  overlap: OverlapParams | null
  gsea: GseaParams | null
  /** Which tabs have actually been opened — an unopened tab is still at defaults. */
  seen: Record<'de' | 'ora' | 'sets' | 'pca' | 'overlap' | 'gsea', boolean>
}

// Defaults mirror each component's initial state, so the text is complete even
// before a tab is opened; `seen` lets the UI flag that it is showing defaults.
let state: MethodsState = {
  de: { padjThr: 0.05, lfcThr: 1 },
  ora: null,
  sets: null,
  pca: null,
  overlap: null,
  gsea: null,
  seen: { de: false, ora: false, sets: false, pca: false, overlap: false, gsea: false },
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function reportDe(p: DeParams) {
  if (state.seen.de && state.de.padjThr === p.padjThr && state.de.lfcThr === p.lfcThr) return
  state = { ...state, de: p, seen: { ...state.seen, de: true } }
  emit()
}
export function reportOra(p: OraParams) {
  if (state.ora && shallowEq(state.ora, p)) return
  state = { ...state, ora: p, seen: { ...state.seen, ora: true } }
  emit()
}
export function reportPca(p: PcaParams) {
  if (state.pca && shallowEq(state.pca, p)) return
  state = { ...state, pca: p, seen: { ...state.seen, pca: true } }
  emit()
}
export function reportSets(p: SetParams) {
  if (state.sets && shallowEq(state.sets, p)) return
  state = { ...state, sets: p, seen: { ...state.seen, sets: true } }
  emit()
}

export function reportOverlap(p: OverlapParams) {
  if (state.overlap && shallowEq(state.overlap, p)) return
  state = { ...state, overlap: p, seen: { ...state.seen, overlap: true } }
  emit()
}

export function reportGsea(p: GseaParams) {
  if (state.gsea && shallowEq(state.gsea, p)) return
  state = { ...state, gsea: p, seen: { ...state.seen, gsea: true } }
  emit()
}

function shallowEq<T extends object>(a: T, b: T) {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>
  const keys = Object.keys(ra)
  if (keys.length !== Object.keys(rb).length) return false
  return keys.every(k => Array.isArray(ra[k]) && Array.isArray(rb[k])
    ? (ra[k] as unknown[]).join() === (rb[k] as unknown[]).join()
    : ra[k] === rb[k])
}

export const useMethodsState = () =>
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)

/** Report from inside an analysis tab. `dep` is a cheap change key. */
export function useReport(fn: () => void, dep: string) {
  useEffect(fn, [dep]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* ───────────────────────────── references ───────────────────────────── */

interface RefEntry { short: string; full: string }

// Primary citations for every tool or database the explorer can actually use.
// Database references should be updated to the release the user downloaded.
const REFS: Record<string, RefEntry> = {
  deseq2: {
    short: 'Love et al., 2014',
    full: 'Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. Genome Biol. 2014;15:550.',
  },
  voom: {
    short: 'Law et al., 2014',
    full: 'Law CW, Chen Y, Shi W, Smyth GK. voom: precision weights unlock linear model analysis tools for RNA-seq read counts. Genome Biol. 2014;15:R29.',
  },
  limma: {
    short: 'Ritchie et al., 2015',
    full: 'Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK. limma powers differential expression analyses for RNA-sequencing and microarray studies. Nucleic Acids Res. 2015;43:e47.',
  },
  edger: {
    short: 'Robinson et al., 2010',
    full: 'Robinson MD, McCarthy DJ, Smyth GK. edgeR: a Bioconductor package for differential expression analysis of digital gene expression data. Bioinformatics. 2010;26:139–140.',
  },
  bh: {
    short: 'Benjamini & Hochberg, 1995',
    full: 'Benjamini Y, Hochberg Y. Controlling the false discovery rate: a practical and powerful approach to multiple testing. J R Stat Soc B. 1995;57:289–300.',
  },
  msigdb: {
    short: 'Liberzon et al., 2015',
    full: 'Liberzon A, Birger C, Thorvaldsdóttir H, Ghandi M, Mesirov JP, Tamayo P. The Molecular Signatures Database hallmark gene set collection. Cell Syst. 2015;1:417–425.',
  },
  kegg: {
    short: 'Kanehisa & Goto, 2000',
    full: 'Kanehisa M, Goto S. KEGG: Kyoto Encyclopedia of Genes and Genomes. Nucleic Acids Res. 2000;28:27–30.',
  },
  reactome: {
    short: 'Milacic et al., 2024',
    full: 'Milacic M, Beavers D, Conley P, et al. The Reactome Pathway Knowledgebase 2024. Nucleic Acids Res. 2024;52:D672–D678.',
  },
  wikipathways: {
    short: 'Agrawal et al., 2024',
    full: 'Agrawal A, Balcı H, Hanspers K, et al. WikiPathways 2024: next generation pathway database. Nucleic Acids Res. 2024;52:D679–D689.',
  },
  go: {
    short: 'Ashburner et al., 2000',
    full: 'Ashburner M, Ball CA, Blake JA, et al. Gene Ontology: tool for the unification of biology. Nat Genet. 2000;25:25–29.',
  },
  gsea: {
    short: 'Subramanian et al., 2005',
    full: 'Subramanian A, Tamayo P, Mootha VK, et al. Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. Proc Natl Acad Sci USA. 2005;102:15545–15550.',
  },
  mootha: {
    short: 'Mootha et al., 2003',
    full: 'Mootha VK, Lindgren CM, Eriksson KF, et al. PGC-1α-responsive genes involved in oxidative phosphorylation are coordinately downregulated in human diabetes. Nat Genet. 2003;34:267–273.',
  },
  ssgsea: {
    short: 'Barbie et al., 2009',
    full: 'Barbie DA, Tamayo P, Boehm JS, et al. Systematic RNA interference reveals that oncogenic KRAS-driven cancers require TBK1. Nature. 2009;462:108–112.',
  },
  studio: {
    short: 'Lin, 2026',
    full: `Lin J. RNA-seq Studio (${STUDIO_VERSION}). Zenodo; 2026. doi:${STUDIO_DOI}`,
  },
}

/** Map a gene-set collection name from the bundle to its primary citation. */
/**
 * Every collection label the shipped manifest offers.
 *
 * Kept as a list rather than inferred, because the question this answers is
 * "did this come from MSigDB", and the only sources that did not are the ones
 * the reader brought — whose names are arbitrary and must not be guessed at.
 * Falling through to no citation is the safe direction: an uncited line is a
 * gap an author fills, a wrongly cited one is a claim they did not make.
 *
 * Must agree with public/genesets/manifest.json; scripts/test-genesets.mjs
 * checks that it does.
 */
export const MSIGDB_COLLECTIONS = new Set([
  'Hallmark', 'KEGG', 'KEGG (orthologs)', 'Reactome', 'WikiPathways', 'PID',
  'BioCarta', 'Canonical (other)', 'Metabolic',
  'GO:BP', 'GO:MF', 'GO:CC', 'Human phenotype', 'Tumour phenotype',
  'Cell type', 'Perturbations', 'Immunologic', 'Vaccine response', 'Oncogenic',
  'TF targets', 'miRNA targets',
  'Cancer atlas (3CA)', 'Cancer modules', 'Cancer neighbourhoods',
  'Copy-number correlates', 'Positional',
])

function sourceRef(src: string): string | null {
  const s = src.toLowerCase()
  if (s.includes('kegg')) return 'kegg'
  if (s.includes('reactome')) return 'reactome'
  if (s.includes('wikipathway')) return 'wikipathways'
  if (s.startsWith('go:') || s.includes('gene ontology')) return 'go'
  if (s.includes('msigdb')) return 'msigdb'
  // Every other shipped collection is MSigDB's, including Metabolic — which is
  // assembled from the collections above and carries no database of its own.
  if (MSIGDB_COLLECTIONS.has(src)) return 'msigdb'
  return null
}

/**
 * Name the tool that actually produced the results.
 *
 * `meta.engine` is a deployment label, not a tool name — bundles from the R
 * exporter say "desktop-R" — so fall back to `meta.counts_unit`, which records
 * the normalization ("DESeq2 normalized (median-of-ratios)") and identifies the
 * package. If neither names a tool, emit a bracketed placeholder: a manuscript
 * needs a real tool name, and a vague filler phrase would be worse than an
 * obvious blank the author has to fill.
 */
export function engineName(engine: string, countsUnit = ''): { name: string; keys: string[]; unknown: boolean } {
  if (engine.toLowerCase().includes('sample-generator'))
    return { name: 'a simulated demo dataset', keys: [], unknown: false }

  const hay = `${engine} ${countsUnit}`.toLowerCase()
  if (hay.includes('deseq')) return { name: 'DESeq2', keys: ['deseq2'], unknown: false }
  if (hay.includes('limma') || hay.includes('voom')) return { name: 'limma-voom', keys: ['voom', 'limma'], unknown: false }
  if (hay.includes('edger')) return { name: 'edgeR', keys: ['edger'], unknown: false }
  return { name: '[differential expression tool — add name and citation]', keys: [], unknown: true }
}

/* ───────────────────────────── generation ───────────────────────────── */

const fmtP = (p: number) => (p < 1e-3 ? p.toExponential(1).replace('e-', ' × 10⁻') : String(+p.toFixed(4)))
const fmtN = (n: number) => n.toLocaleString('en-US')
// 3 decimals, trailing zeros stripped — keeps log2(1.5) = 0.585 intact.
const fmtL = (v: number) => String(+v.toFixed(3))
const list = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

// log2FC is always signed relative to the NUMERATOR, so both directions name the
// numerator group — "down-regulated in <denominator>" would invert the meaning.
const directionText = (d: 'both' | 'up' | 'down', numerator: string) =>
  d === 'both' ? 'in either direction' : `${d === 'up' ? 'up' : 'down'}-regulated in ${numerator}`

const METRIC_TEXT: Record<GseaParams['metric'], string> = {
  stat: 'the Wald statistic (log2 fold-change divided by its standard error)',
  combined: 'a combined score of −log10(p) × log2 fold-change',
  signedP: '−log10(p) signed by the direction of the fold change',
  log2FC: 'log2 fold-change',
}

const SCORE_TEXT: Record<SetParams['scoreMethod'], string> = {
  runningsum: 'a weighted rank running-sum statistic (ssGSEA-style{{ssgsea}}, α = 0.25) over within-sample gene ranks',
  meanrank: 'the mean within-sample rank of set members, scaled to 0–1',
  meanz: 'the mean z-score of set members across samples',
}

export type AnalysisId = 'de' | 'pca' | 'ora' | 'gsea' | 'sets' | 'overlap' | 'ranking'
export type CiteStyle = 'numbered' | 'authoryear'

export interface MethodsDoc {
  title: string
  body: string
  refs: { n: number; text: string }[]
  /** Analyses whose numbers are still defaults because that tab was never opened. */
  unseen: string[]
  /** True when the bundle never named the tool that produced the results. */
  engineUnknown: boolean
}

export const DEFAULT_TITLE = 'RNA-seq analysis'

/** Count DEGs at the thresholds currently shown on the Volcano tab. */
export function countDeg(bundle: Bundle, contrast: Contrast, p: DeParams) {
  let n = 0, up = 0
  for (const r of bundle.degByContrast[contrast.id] ?? []) {
    if (r.padj == null || r.log2FoldChange == null) continue
    if (r.padj < p.padjThr && Math.abs(r.log2FoldChange) >= p.lfcThr) { n++; if (r.log2FoldChange > 0) up++ }
  }
  return { n, up, down: n - up }
}

export function buildDoc(
  bundle: Bundle,
  contrast: Contrast,
  s: MethodsState,
  include: Set<AnalysisId>,
  style: CiteStyle = 'numbered',
  title = DEFAULT_TITLE,
): MethodsDoc {
  const { meta } = bundle
  // A contrast computed in-app is DESeq2 regardless of what produced the bundle,
  // so the Methods text must name DESeq2 rather than the bundle's engine.
  const eng = contrast.id.startsWith('~deseq2:')
    ? { name: 'DESeq2', keys: ['deseq2'], unknown: false }
    : engineName(meta.engine, meta.counts_unit)
  const nNum = bundle.samples.filter(x => x.condition === contrast.numerator).length
  const nDen = bundle.samples.filter(x => x.condition === contrast.denominator).length
  const species = meta.species && !/unknown/i.test(meta.species) ? ` (${meta.species})` : ''
  const groups = nNum && nDen ? ` (n = ${nNum} vs ${nDen})` : ''

  const sentences: string[] = []
  const unseen: string[] = []

  /* Differential expression */
  if (include.has('de')) {
    const deg = countDeg(bundle, contrast, s.de)
    const cite = eng.keys.length ? `{{${eng.keys.join(',')}}}` : ''
    sentences.push(
      `Gene-level counts${species} were analysed with ${eng.name}${cite} to compare ` +
      `${contrast.numerator} against ${contrast.denominator}${groups}, with ${contrast.denominator} as the ` +
      `reference; genes with a Benjamini–Hochberg{{bh}} adjusted p-value below ${fmtP(s.de.padjThr)} and an ` +
      `absolute log2 fold-change of at least ${fmtL(s.de.lfcThr)} were considered differentially expressed ` +
      `(${fmtN(deg.n)} genes; ${fmtN(deg.up)} up, ${fmtN(deg.down)} down).`)
    if (!s.seen.de) unseen.push('differential expression')
  }

  /* Over-representation analysis */
  /* Sample-level structure, before any gene. */
  if (include.has('pca') && s.pca) {
    const p = s.pca
    sentences.push(
      `Sample-level structure was inspected by principal component analysis of the ` +
      `${fmtN(p.nGenes)} most variable genes on log2(normalized counts + 1), with genes centred ` +
      `and not scaled; PC${p.pcX} and PC${p.pcY} accounted for ${(p.varX * 100).toFixed(1)}% and ` +
      `${(p.varY * 100).toFixed(1)}% of the variance across ${fmtN(p.nSamples)} samples.`)
    if (!s.seen.pca) unseen.push('PCA')
  }

  if (include.has('ora') && s.ora) {
    const o = s.ora
    const named = o.sources.map(src => {
      const key = sourceRef(src)
      return key ? `${src}{{${key}}}` : src
    })
    const src = named.length ? list(named) : 'all available collections'
    // Only restate the cutoffs when they differ from the ones just stated for DE —
    // repeating identical thresholds is the kind of padding a reviewer notices.
    const sameAsDe = include.has('de')
      && o.padjMax === s.de.padjThr && o.lfcMin === s.de.lfcThr && o.direction === 'both'
    const subject = o.query
      // Named, not described by cutoffs: the list was selected on the Overlap
      // tab, across comparisons, and no threshold on the enrichment card
      // touched it.
      ? `The ${fmtN(o.nDeg)} genes ${o.query}`
      : sameAsDe
        ? 'These differentially expressed genes'
        : `Differentially expressed genes (adjusted p < ${fmtP(o.padjMax)}, ` +
          `|log2 fold-change| ≥ ${fmtL(o.lfcMin)}, ${directionText(o.direction, contrast.numerator)}; ` +
          `${fmtN(o.nDeg)} genes)`
    sentences.push(
      `${subject} were tested for over-representation against ${fmtN(o.nSets)} gene sets from ` +
      `${src}, restricted to sets of ${o.minSize}–${o.maxSize} genes, using a one-sided hypergeometric test ` +
      `with Benjamini–Hochberg correction and the ${fmtN(o.nBackground)} annotated genes detected in this ` +
      `dataset as background (${fmtN(o.nSig)} sets at adjusted p < 0.05).`)
    if (!s.seen.ora) unseen.push('enrichment')
  }

  /* Pre-ranked GSEA.
     Its own sentence, and it must not reuse the ORA one's cutoffs: GSEA applies
     none. Saying "differentially expressed genes were tested" of a method that
     ranks every gene and thresholds nothing would misdescribe the analysis. */
  if (include.has('gsea') && s.gsea) {
    const g = s.gsea
    const named = g.sources.map(src => {
      const key = sourceRef(src)
      return key ? `${src}{{${key}}}` : src
    })
    sentences.push(
      `All ${fmtN(g.nRanked)} tested genes were ranked by ${METRIC_TEXT[g.metric]} and analysed by `
      + `pre-ranked gene set enrichment analysis{{gsea,mootha}} against ${fmtN(g.nSets)} gene sets from `
      + `${named.length ? list(named) : 'all enabled collections'} of ${g.minSize}–${g.maxSize} genes, `
      + `using the weighted (p = 1) Kolmogorov–Smirnov running-sum statistic with `
      + `${fmtN(g.nperm)} gene-set permutations per set size and Benjamini–Hochberg{{bh}} correction `
      + `(${fmtN(g.nSig)} sets at adjusted p < 0.05).`)
    if (!s.seen.gsea) unseen.push('GSEA')
  }

  /* Where several comparisons agree.
     Its own sentence rather than a clause on the DE one: it describes a
     different object — a relationship between gene lists, not a gene list. */
  if (include.has('overlap') && s.overlap && s.overlap.nSets > 1) {
    const o = s.overlap
    const same = o.padjMax === s.de.padjThr && o.lfcMin === s.de.lfcThr && o.direction === 'both'
    sentences.push(
      `The differentially expressed genes of ${o.nSets} comparisons (${list(o.labels)}) were intersected` +
      (same
        ? ' at the same cutoffs'
        : ` at an adjusted p below ${fmtP(o.padjMax)} and |log2 fold-change| of at least ${fmtL(o.lfcMin)}` +
          (o.direction === 'both' ? '' : `, restricted to genes ${o.direction}-regulated in each comparison's test group`)) +
      (o.concordantOnly ? ', counting a gene as shared only where it changed in the same direction in every comparison' : '') +
      `; ${fmtN(o.union)} genes were differentially expressed in at least one comparison and ` +
      `${fmtN(o.shared)} in all ${o.nSets}.`)
    if (!s.seen.overlap) unseen.push('comparison overlap')
  }

  /* User-defined gene-set activity */
  const withSets = include.has('sets') && s.sets && s.sets.nSets > 0
  if (withSets && s.sets) {
    const g = s.sets
    const nOwn = Math.max(0, g.nSets - g.nLibrary)
    const cited = g.librarySources.map(src => {
      const key = sourceRef(src)
      return key ? `${src}{{${key}}}` : src
    })
    // Named separately because they are different objects: one is a published
    // set with an id a reader can look up, the other is a list this study drew.
    const what = [
      g.nLibrary > 0
        && `${g.nLibrary} gene set${g.nLibrary > 1 ? 's' : ''}`
        + (cited.length ? ` from ${list(cited)}` : ''),
      nOwn > 0 && `${nOwn} user-defined gene set${nOwn > 1 ? 's' : ''}`,
    ].filter(Boolean) as string[]
    sentences.push(
      `Per-sample activity of ${list(what)} was scored with ${SCORE_TEXT[g.scoreMethod]}.`)
    if (!s.seen.sets) unseen.push('gene-set activity')
  }

  /* Optional Studio-specific ranking metric */
  if (include.has('ranking')) {
    sentences.push(
      `Genes were ranked by a combined score, defined as −log10(p) × log2 fold-change, which orders genes ` +
      `by statistical significance and effect size together.`)
  }

  /* Software — always present, since this is where Studio is cited. */
  const did = ['Exploratory analysis']
  if (withSets) did.push('gene-set scoring')
  did.push('figures')
  sentences.push(`${list(did)} were produced with RNA-seq Studio ${STUDIO_VERSION}{{studio}}.`)

  return {
    title,
    ...resolveCitations(sentences.join(' '), style),
    unseen,
    engineUnknown: include.has('de') && eng.unknown,
  }
}

// Private-use sentinels wrap a numbered citation inside `body`, so the same
// string can be rendered as real <sup> on screen and in the HTML clipboard
// flavour, or as Unicode superscripts in plain text.
const SUP_OPEN = '\uE000'
const SUP_CLOSE = '\uE001'
const SUP_RE = new RegExp(`${SUP_OPEN}(.+?)${SUP_CLOSE}`, 'g')

/**
 * Replace {{key}} / {{key,key}} markers with citations, numbering them in order
 * of first appearance so the reference list always matches the prose.
 */
function resolveCitations(text: string, style: CiteStyle) {
  const order: string[] = []
  // [a-z0-9,] — keys contain digits (deseq2), and omitting them silently drops the citation.
  const body = text.replace(/\{\{([a-z0-9,]+)\}\}/g, (_m, group: string) => {
    const keys = group.split(',').filter(k => REFS[k])
    if (!keys.length) return ''
    for (const k of keys) if (!order.includes(k)) order.push(k)
    // Superscripts attach to the preceding word — no space before them.
    return style === 'numbered'
      ? `${SUP_OPEN}${keys.map(k => order.indexOf(k) + 1).join(',')}${SUP_CLOSE}`
      : ` (${keys.map(k => REFS[k].short).join('; ')})`
  })
  return { body, refs: order.map((k, i) => ({ n: i + 1, text: REFS[k].full })) }
}

/** Split a body into runs of plain text and superscript citations, for React. */
export function bodySegments(body: string): { sup: boolean; v: string }[] {
  const out: { sup: boolean; v: string }[] = []
  let last = 0
  for (const m of body.matchAll(SUP_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ sup: false, v: body.slice(last, i) })
    out.push({ sup: true, v: m[1] })
    last = i + m[0].length
  }
  if (last < body.length) out.push({ sup: false, v: body.slice(last) })
  return out
}

const SUP_DIGITS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}
const toSupText = (d: string) => [...d].map(c => SUP_DIGITS[c] ?? c).join('')

const escHtml = (s: string) =>
  s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

export const renderPlain = (d: MethodsDoc) =>
  `${d.title}\n\n${d.body.replace(SUP_RE, (_m, g: string) => toSupText(g))}\n\nReferences\n` +
  d.refs.map(r => `${r.n}. ${r.text}`).join('\n')

/**
 * Rich-text flavour for the clipboard. Word and Google Docs prefer text/html,
 * so citations paste as real superscript rather than Unicode lookalikes.
 * References are numbered paragraphs, not an <ol>, so nothing renumbers on paste.
 */
export const renderHtml = (d: MethodsDoc) => {
  const body = bodySegments(d.body)
    .map(s => (s.sup ? `<sup>${escHtml(s.v)}</sup>` : escHtml(s.v)))
    .join('')
  return `<p><b>${escHtml(d.title)}</b></p><p>${body}</p><p><b>References</b></p>` +
    d.refs.map(r => `<p>${r.n}. ${escHtml(r.text)}</p>`).join('')
}
