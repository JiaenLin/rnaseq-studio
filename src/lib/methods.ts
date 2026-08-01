// Methods-text generator.
//
// The thresholds a user actually explored with live inside each analysis tab as
// local state. Rather than lifting all of it into App (and re-rendering the
// whole explorer on every slider drag), each tab *reports* its current settings
// into this tiny external store. The Methods tab subscribes. Tabs unmount when
// you leave them, but their last reported settings persist here — which is
// exactly what a write-up needs.

import { useEffect, useSyncExternalStore } from 'react'
import type { Bundle, Contrast } from '../types'

export const STUDIO_VERSION = 'v1.0.0'
export const STUDIO_DOI = '10.5281/zenodo.21514152'

export interface DeParams {
  padjThr: number
  lfcThr: number
}
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

/* ─────────────────────────── text generation ─────────────────────────── */

const fmtP = (p: number) => (p < 1e-3 ? p.toExponential(1).replace('e-', ' × 10⁻') : String(+p.toFixed(4)))
const fmtN = (n: number) => n.toLocaleString('en-US')
// 3 decimals, trailing zeros stripped — keeps log2(1.5) = 0.585 intact.
const fmtL = (v: number) => String(+v.toFixed(3))
const list = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** Map a bundle's engine string to a citable method name. */
export function engineName(engine: string): { name: string; cite: string | null } {
  const e = engine.toLowerCase()
  if (e.includes('deseq')) return { name: 'DESeq2', cite: 'Love MI, Huber W, Anders S. Genome Biol. 2014;15:550.' }
  if (e.includes('limma') || e.includes('voom'))
    return { name: 'limma-voom', cite: 'Law CW et al. Genome Biol. 2014;15:R29; Ritchie ME et al. Nucleic Acids Res. 2015;43:e47.' }
  if (e.includes('edger')) return { name: 'edgeR', cite: 'Robinson MD, McCarthy DJ, Smyth GK. Bioinformatics. 2010;26:139–140.' }
  if (e.includes('sample-generator')) return { name: 'a simulated demo dataset', cite: null }
  return { name: 'the upstream analysis pipeline', cite: null }
}

// log2FC is always signed relative to the NUMERATOR, so both directions name the
// numerator group — "down-regulated in <denominator>" would invert the meaning.
const directionText = (d: 'both' | 'up' | 'down', numerator: string) =>
  d === 'both' ? 'in either direction' : `${d === 'up' ? 'up' : 'down'}-regulated in ${numerator}`

const SCORE_TEXT: Record<SetParams['scoreMethod'], string> = {
  runningsum:
    'a weighted rank running-sum statistic (ssGSEA-style, α = 0.25) over within-sample gene ranks',
  meanrank: 'the mean within-sample rank of set members, scaled to 0–1',
  meanz: 'the mean z-score of set members across samples',
}

export type SectionId = 'de' | 'ora' | 'sets' | 'ranking' | 'software' | 'references'

export interface Section {
  id: SectionId
  heading: string
  body: string
  /** True when the numbers came from settings the user actually adjusted. */
  live: boolean
}

/** Count DEGs at the thresholds currently shown on the Volcano tab. */
export function countDeg(bundle: Bundle, contrast: Contrast, p: DeParams) {
  let n = 0, up = 0
  for (const r of bundle.degByContrast[contrast.id] ?? []) {
    if (r.padj == null || r.log2FoldChange == null) continue
    if (r.padj < p.padjThr && Math.abs(r.log2FoldChange) >= p.lfcThr) { n++; if (r.log2FoldChange > 0) up++ }
  }
  return { n, up, down: n - up }
}

export function buildSections(bundle: Bundle, contrast: Contrast, s: MethodsState): Section[] {
  const out: Section[] = []
  const { meta } = bundle
  const eng = engineName(meta.engine)
  const nNum = bundle.samples.filter(x => x.condition === contrast.numerator).length
  const nDen = bundle.samples.filter(x => x.condition === contrast.denominator).length
  const deg = countDeg(bundle, contrast, s.de)
  const species = meta.species && !/unknown/i.test(meta.species) ? ` (${meta.species})` : ''

  /* Differential expression */
  const groups = nNum && nDen ? ` (n = ${nNum} vs ${nDen})` : ''
  out.push({
    id: 'de',
    heading: 'Differential expression',
    live: s.seen.de,
    body:
      `Gene-level counts${species} were analysed with ${eng.name} to compare ` +
      `${contrast.numerator} against ${contrast.denominator}${groups}, with ${contrast.denominator} as the reference. ` +
      `Genes with a Benjamini–Hochberg adjusted p-value below ${fmtP(s.de.padjThr)} and an absolute ` +
      `log2 fold-change of at least ${fmtL(s.de.lfcThr)} were considered differentially expressed ` +
      `(${fmtN(deg.n)} genes; ${fmtN(deg.up)} up, ${fmtN(deg.down)} down).`,
  })

  /* Over-representation analysis */
  if (s.ora) {
    const o = s.ora
    const src = o.sources.length ? list(o.sources) : 'all available collections'
    const dirWord = directionText(o.direction, contrast.numerator)
    out.push({
      id: 'ora',
      heading: 'Over-representation analysis',
      live: s.seen.ora,
      body:
        `Differentially expressed genes (adjusted p < ${fmtP(o.padjMax)}, |log2 fold-change| ≥ ${fmtL(o.lfcMin)}, ` +
        `${dirWord}; ${fmtN(o.nDeg)} genes) were tested for over-representation against ${fmtN(o.nSets)} gene sets ` +
        `from ${src}, restricted to sets of ${o.minSize}–${o.maxSize} genes. ` +
        `Enrichment was assessed with a one-sided hypergeometric test and Benjamini–Hochberg correction, ` +
        `using the ${fmtN(o.nBackground)} annotated genes detected in this dataset as the background ` +
        `(${fmtN(o.nSig)} sets at adjusted p < 0.05).`,
    })
  }

  /* User-defined gene-set activity */
  if (s.sets && s.sets.nSets > 0) {
    const g = s.sets
    out.push({
      id: 'sets',
      heading: 'Gene-set activity',
      live: s.seen.sets,
      body:
        `Per-sample activity of ${g.nSets} user-defined gene set${g.nSets > 1 ? 's' : ''} was scored with ` +
        `${SCORE_TEXT[g.scoreMethod]}. Set-level differential expression was summarised over the same ` +
        `thresholds used above (adjusted p < ${fmtP(g.padjMax)}, |log2 fold-change| ≥ ${fmtL(g.lfcMin)}).`,
    })
  }

  /* Optional: the Studio-specific ranking metric */
  out.push({
    id: 'ranking',
    heading: 'Gene ranking',
    live: true,
    body:
      `Genes were ranked by a combined score, defined as −log10(p) × log2 fold-change, ` +
      `which orders genes by statistical significance and effect size together.`,
  })

  /* Software */
  const named = eng.cite ? `; differential expression used ${eng.name}` : ''
  out.push({
    id: 'software',
    heading: 'Software',
    live: true,
    body:
      `Exploratory analysis, gene-set scoring and figures were produced with RNA-seq Studio ` +
      `${STUDIO_VERSION} (Lin, 2026), which runs entirely client-side${named}.`,
  })

  /* References — kept separate so it can be pasted straight into a bibliography. */
  const refs = [`Lin J. RNA-seq Studio (${STUDIO_VERSION}). Zenodo; 2026. doi:${STUDIO_DOI}`]
  if (eng.cite) refs.push(eng.cite)
  out.push({ id: 'references', heading: 'References', live: true, body: refs.join('\n') })

  return out
}

export const renderMethods = (sections: Section[], chosen: Set<SectionId>) =>
  sections.filter(s => chosen.has(s.id)).map(s => `${s.heading}\n${s.body}`).join('\n\n')
