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
}
export interface SetParams {
  nSets: number
  scoreMethod: 'runningsum' | 'meanrank' | 'meanz'
  padjMax: number
  lfcMin: number
  direction: 'both' | 'up' | 'down'
}

export interface MethodsState {
  de: DeParams
  ora: OraParams | null
  sets: SetParams | null
  /** Which tabs have actually been opened — an unopened tab is still at defaults. */
  seen: Record<'de' | 'ora' | 'sets', boolean>
}

// Defaults mirror each component's initial state, so the text is complete even
// before a tab is opened; `seen` lets the UI flag that it is showing defaults.
let state: MethodsState = {
  de: { padjThr: 0.05, lfcThr: 1 },
  ora: null,
  sets: null,
  seen: { de: false, ora: false, sets: false },
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
export function reportSets(p: SetParams) {
  if (state.sets && shallowEq(state.sets, p)) return
  state = { ...state, sets: p, seen: { ...state.seen, sets: true } }
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
function sourceRef(src: string): string | null {
  const s = src.toLowerCase()
  if (s.includes('hallmark') || s.includes('msigdb')) return 'msigdb'
  if (s.includes('kegg')) return 'kegg'
  if (s.includes('reactome')) return 'reactome'
  if (s.includes('wikipathway')) return 'wikipathways'
  if (s.startsWith('go') || s.includes('gene ontology')) return 'go'
  return null
}

/** Map a bundle's engine string to a method name and its citation key(s). */
export function engineName(engine: string): { name: string; keys: string[] } {
  const e = engine.toLowerCase()
  if (e.includes('deseq')) return { name: 'DESeq2', keys: ['deseq2'] }
  if (e.includes('limma') || e.includes('voom')) return { name: 'limma-voom', keys: ['voom', 'limma'] }
  if (e.includes('edger')) return { name: 'edgeR', keys: ['edger'] }
  if (e.includes('sample-generator')) return { name: 'a simulated demo dataset', keys: [] }
  return { name: 'the upstream analysis pipeline', keys: [] }
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

const SCORE_TEXT: Record<SetParams['scoreMethod'], string> = {
  runningsum: 'a weighted rank running-sum statistic (ssGSEA-style{{ssgsea}}, α = 0.25) over within-sample gene ranks',
  meanrank: 'the mean within-sample rank of set members, scaled to 0–1',
  meanz: 'the mean z-score of set members across samples',
}

export type AnalysisId = 'de' | 'ora' | 'sets' | 'ranking'
export type CiteStyle = 'numbered' | 'authoryear'

export interface MethodsDoc {
  title: string
  body: string
  refs: { n: number; text: string }[]
  /** Analyses whose numbers are still defaults because that tab was never opened. */
  unseen: string[]
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
  const eng = engineName(meta.engine)
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
    const subject = sameAsDe
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

  /* User-defined gene-set activity */
  const withSets = include.has('sets') && s.sets && s.sets.nSets > 0
  if (withSets && s.sets) {
    const g = s.sets
    sentences.push(
      `Per-sample activity of ${g.nSets} user-defined gene set${g.nSets > 1 ? 's' : ''} was scored with ` +
      `${SCORE_TEXT[g.scoreMethod]}.`)
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

  return { title, ...resolveCitations(sentences.join(' '), style), unseen }
}

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
    return style === 'numbered'
      ? ` (${keys.map(k => order.indexOf(k) + 1).join(', ')})`
      : ` (${keys.map(k => REFS[k].short).join('; ')})`
  })
  return { body, refs: order.map((k, i) => ({ n: i + 1, text: REFS[k].full })) }
}

export const renderPlain = (d: MethodsDoc, style: CiteStyle) =>
  `${d.title}\n\n${d.body}\n\nReferences\n` +
  d.refs.map((r, i) => (style === 'numbered' ? `${r.n}. ${r.text}` : `${i + 1}. ${r.text}`)).join('\n')
