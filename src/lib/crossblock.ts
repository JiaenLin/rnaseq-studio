// Comparing across blocks, without a model that spans them.
//
// A bundle from RNA-seq Lab can be BLOCKED: one fit per tissue, cell line, or
// whatever `meta.block_factor` names, because DESeq2 has a single dispersion
// per gene and eleven tissues in one fit means brown fat setting the variance
// for hypothalamus. That is right, and it leaves an obvious question — is the
// ageing response in heart the same as in liver — that no single fit answers.
//
// The wrong response is to refuse it. The question is good; only the model is
// unavailable. Three things can be said honestly, and this module computes them:
//
//   1. THE RESPONSE COMPARISON. A log2 fold change is a ratio WITHIN a block,
//      so whatever per-block offset normalisation left behind cancels inside
//      it. Heart's log2FC(104w/008w) and liver's are on the same axis with no
//      cross-block normalisation performed anywhere, at every magnitude. That
//      is the whole reason this works when comparing expression does not.
//
//   2. THE INTERACTION. "Does the effect differ between the two" is
//      (lfcA - lfcB), and because the two fits used disjoint samples the
//      estimates are independent: SE = sqrt(seA^2 + seB^2), and a Wald z on
//      that is a valid test computed from two separate fits. It is BETTER than
//      the joint fit that would otherwise be needed — each block keeps its own
//      dispersion, and no cross-block normalisation happens at all.
//
//   3. WHAT WAS NOT TESTED. Blocks have their own gene universes: on the mouse
//      ageing atlas the per-tissue filter keeps 15,586 genes in liver and
//      19,097 in brain. So a gene absent from an overlap is either "tested and
//      unchanged" or "not expressed here", and those are different claims. The
//      source paper for that atlas merged them into one colour; this does not.
//
// ON THE UNSHRUNK ESTIMATE. The test uses log2FoldChange_MLE and lfcSE_MLE, not
// the shrunk values. ashr fits its prior per fit, so a block full of strong
// effects is shrunk less than a quiet one — measured across the eleven tissues,
// the fraction of significant genes surviving |log2FC| >= 1 ranges from 0.32 in
// hypothalamus to 0.72 in eWAT. Comparing shrunk values between blocks reads
// that difference in shrinkage as biology, and would roughly double the
// apparent gap between the loudest and quietest tissue.
//
// ON PAIRING. The atlas takes all eleven tissues from the same 25 animals, so
// two blocks are not strictly independent. Positive within-animal correlation
// makes seA^2 + seB^2 an OVERestimate of the variance of the difference, so
// assuming independence is CONSERVATIVE — the test under-rejects rather than
// over-rejects. Said plainly rather than left for a reader to discover.

import type { Bundle, DEGRow } from '../types'

/* ---------------------------------------------------------------------------
   Which block a group belongs to
--------------------------------------------------------------------------- */

/**
 * Condition -> block, from the covariate `meta.block_factor` names.
 *
 * Empty when the bundle is unblocked, which is most of them: every comparison
 * is then within the single fit and nothing here applies.
 */
export function blockOfCondition(bundle: Bundle): Map<string, string> {
  const factor = bundle.meta.block_factor
  const out = new Map<string, string>()
  if (!factor) return out
  for (const s of bundle.samples) {
    const v = (s as Record<string, string>)[factor]
    if (v && !out.has(s.condition)) out.set(s.condition, v)
  }
  return out
}

/** True when the two sides sit in different blocks, so no one fit spans them. */
export function spansBlocks(
  blockOf: ReadonlyMap<string, string>, control: readonly string[], test: readonly string[],
): boolean {
  const bs = new Set([...control, ...test].map(g => blockOf.get(g)).filter(Boolean))
  return bs.size > 1
}

/* ---------------------------------------------------------------------------
   The normal tail, to double precision
--------------------------------------------------------------------------- */

/**
 * P(Z > z) for z >= 0, by Hart's rational approximation (West, 2005).
 *
 * A Chebyshev erfc good to 1e-7 is fine for a threshold and useless for
 * ranking: genomics p-values run to 1e-30 and the ordering below 1e-7 would be
 * noise. This is accurate to roughly machine precision across the range and
 * degrades gracefully past z = 37, where the tail underflows anyway.
 */
export function upperTail(z: number): number {
  if (!Number.isFinite(z)) return NaN
  const x = Math.abs(z)
  if (x > 37) return 0
  const e = Math.exp(-x * x / 2)
  if (x < 7.07106781186547) {
    let b = 3.52624965998911e-2 * x + 0.700383064443688
    b = b * x + 6.37396220353165
    b = b * x + 33.912866078383
    b = b * x + 112.079291497871
    b = b * x + 221.213596169931
    b = b * x + 220.206867912376
    let c = 8.83883476483184e-2 * x + 1.75566716318264
    c = c * x + 16.064177579207
    c = c * x + 86.7807322029461
    c = c * x + 296.564248779674
    c = c * x + 637.333633378831
    c = c * x + 793.826512519948
    c = c * x + 440.413735824752
    return e * b / c
  }
  let b = x + 0.65
  b = x + 4 / b
  b = x + 3 / b
  b = x + 2 / b
  b = x + 1 / b
  return e / (b * 2.506628274631)
}

/** Two-sided normal p-value for a Wald statistic. */
export const twoSided = (z: number) => Math.min(1, 2 * upperTail(z))

/**
 * Benjamini-Hochberg, returning adjusted values in the INPUT order.
 *
 * Written out rather than reused from ora.ts because the unit here is the set
 * of genes tested in BOTH blocks — a different denominator from anything the
 * per-block tables were corrected against, and correcting over the wrong set is
 * the easiest way to make an interaction look significant.
 */
export function bh(p: readonly number[]): number[] {
  const n = p.length
  const idx = Array.from({ length: n }, (_, i) => i).filter(i => Number.isFinite(p[i]))
  idx.sort((a, b) => p[a] - p[b])
  const out = new Array<number>(n).fill(NaN)
  let prev = 1
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k]
    prev = Math.min(prev, (p[i] * idx.length) / (k + 1))
    out[i] = Math.min(1, prev)
  }
  return out
}

/* ---------------------------------------------------------------------------
   The comparison
--------------------------------------------------------------------------- */

export interface GeneResponse {
  gene_id: string
  gene_name: string
  /** Fold change in each block, unshrunk when the bundle carries it. */
  lfcA: number
  lfcB: number
  seA: number | null
  seB: number | null
  /** Significant in that block's own table, at the thresholds asked for. */
  sigA: boolean
  sigB: boolean
  /** lfcA - lfcB, and its Wald test. NaN when either SE is missing. */
  delta: number
  z: number
  pvalue: number
  padj: number
}

export type GeneState = 'both' | 'onlyA' | 'onlyB'

export interface ResponseComparison {
  /** Genes tested in both blocks. The only rows an interaction can be had for. */
  genes: GeneResponse[]
  /** Tested in one block and not the other — reported, never silently dropped. */
  onlyA: string[]
  onlyB: string[]
  /** Pearson and Spearman of lfcA against lfcB, over `genes`. */
  pearson: number
  spearman: number
  /**
   * Deming slope: how far B moves per unit of A.
   *
   * Not least squares. Both axes are noisy estimates, so regressing B on A is
   * attenuated toward zero by regression dilution — it would report a quiet
   * block as responding even less than it does, which is exactly the claim
   * people draw from these plots. Deming uses the ratio of the two blocks' own
   * standard errors, so the noise is modelled rather than ignored.
   */
  slope: number
  quadrants: { upUp: number; upDown: number; downUp: number; downDown: number }
  /** Genes whose response differs between the blocks, at padj < 0.05. */
  nInteraction: number
  /** False when the bundle predates the MLE columns; then no interaction is run. */
  usedMLE: boolean
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** The unshrunk estimate when the bundle has it, else the shrunk one. */
const effectOf = (r: DEGRow): { lfc: number; se: number | null; mle: boolean } => {
  const m = num(r.log2FoldChange_MLE)
  const ms = num(r.lfcSE_MLE)
  if (m != null && ms != null) return { lfc: m, se: ms, mle: true }
  return { lfc: r.log2FoldChange, se: num(r.lfcSE), mle: false }
}

const pearsonOf = (x: readonly number[], y: readonly number[]): number => {
  const n = x.length
  if (n < 3) return NaN
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i] }
  mx /= n; my /= n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my
    sxy += a * b; sxx += a * a; syy += b * b
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN
}

/** Ranks with ties averaged, so Spearman is the textbook one. */
const ranks = (v: readonly number[]): number[] => {
  const idx = Array.from({ length: v.length }, (_, i) => i).sort((a, b) => v[a] - v[b])
  const r = new Array<number>(v.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k]] = avg
    i = j + 1
  }
  return r
}

/**
 * Compare the same comparison in two blocks.
 *
 * `a` and `b` are DEG tables for the SAME question asked in two blocks — say
 * 104w-vs-008w in heart and in liver. Nothing here checks that they are: the
 * caller knows which contrast it matched, and a comparison of two unrelated
 * contrasts is a coherent thing to plot even if it is rarely what anyone wants.
 */
export function compareResponses(
  a: readonly DEGRow[], b: readonly DEGRow[],
  opts: { padjMax?: number; lfcMin?: number } = {},
): ResponseComparison {
  const padjMax = opts.padjMax ?? 0.05
  const lfcMin = opts.lfcMin ?? 1

  // TESTED means padj is a number. A row present with padj NA was filtered out
  // by independent filtering and was never tested, which is not the same as
  // tested and unchanged.
  const tested = (rows: readonly DEGRow[]) => {
    const m = new Map<string, DEGRow>()
    for (const r of rows) if (r.padj != null && Number.isFinite(r.padj)) m.set(r.gene_id, r)
    return m
  }
  const ta = tested(a), tb = tested(b)

  const genes: GeneResponse[] = []
  const onlyA: string[] = []
  const onlyB: string[] = []
  let usedMLE = true

  for (const [id, ra] of ta) {
    const rb = tb.get(id)
    if (!rb) { onlyA.push(id); continue }
    const ea = effectOf(ra), eb = effectOf(rb)
    if (!ea.mle || !eb.mle) usedMLE = false
    const delta = ea.lfc - eb.lfc
    const se = ea.se != null && eb.se != null
      ? Math.sqrt(ea.se * ea.se + eb.se * eb.se) : null
    const z = se != null && se > 0 ? delta / se : NaN
    genes.push({
      gene_id: id,
      gene_name: ra.gene_name || rb.gene_name || id,
      lfcA: ea.lfc, lfcB: eb.lfc, seA: ea.se, seB: eb.se,
      sigA: ra.padj! < padjMax && Math.abs(ra.log2FoldChange) >= lfcMin,
      sigB: rb.padj! < padjMax && Math.abs(rb.log2FoldChange) >= lfcMin,
      delta, z, pvalue: Number.isFinite(z) ? twoSided(z) : NaN, padj: NaN,
    })
  }
  for (const id of tb.keys()) if (!ta.has(id)) onlyB.push(id)

  // Corrected over the genes tested in BOTH — the set the question was asked of.
  const adj = bh(genes.map(g => g.pvalue))
  genes.forEach((g, i) => { g.padj = adj[i] })

  const x = genes.map(g => g.lfcA)
  const y = genes.map(g => g.lfcB)
  const rx = ranks(x), ry = ranks(y)

  // Deming needs the ratio of the two blocks' error variances. Median rather
  // than mean: a handful of huge SEs on near-zero genes would otherwise set it.
  const medianOf = (v: number[]) => {
    if (!v.length) return NaN
    const s = [...v].sort((p, q) => p - q)
    const h = s.length >> 1
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
  }
  const vA = medianOf(genes.map(g => (g.seA ?? NaN) ** 2).filter(Number.isFinite))
  const vB = medianOf(genes.map(g => (g.seB ?? NaN) ** 2).filter(Number.isFinite))
  const lambda = Number.isFinite(vA) && Number.isFinite(vB) && vA > 0 ? vB / vA : 1

  let slope = NaN
  if (genes.length >= 3) {
    const n = x.length
    let mx = 0, my = 0
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i] }
    mx /= n; my /= n
    let sxx = 0, syy = 0, sxy = 0
    for (let i = 0; i < n; i++) {
      const p = x[i] - mx, q = y[i] - my
      sxx += p * p; syy += q * q; sxy += p * q
    }
    if (Math.abs(sxy) > 1e-12) {
      const t = syy - lambda * sxx
      slope = (t + Math.sqrt(t * t + 4 * lambda * sxy * sxy)) / (2 * sxy)
    }
  }

  const quadrants = { upUp: 0, upDown: 0, downUp: 0, downDown: 0 }
  for (const g of genes) {
    if (!g.sigA && !g.sigB) continue
    const up = g.lfcA > 0, upB = g.lfcB > 0
    if (up && upB) quadrants.upUp++
    else if (up && !upB) quadrants.upDown++
    else if (!up && upB) quadrants.downUp++
    else quadrants.downDown++
  }

  return {
    genes,
    onlyA, onlyB,
    pearson: pearsonOf(x, y),
    spearman: pearsonOf(rx, ry),
    slope,
    quadrants,
    nInteraction: genes.filter(g => Number.isFinite(g.padj) && g.padj < 0.05).length,
    usedMLE: usedMLE && genes.length > 0,
  }
}

/* ---------------------------------------------------------------------------
   Which contrasts ask the SAME question in different blocks
--------------------------------------------------------------------------- */

/**
 * A group's identity WITHIN its block — everything about it except which block
 * it is in.
 *
 * Derived from the covariates samples.csv carries, not by cutting up the label.
 * `Liver_104w` and `Heart_104w` are the same question asked in two places, and
 * the thing they share is the level of every factor except the blocking one.
 * Name surgery would work on this atlas and fail on the first study whose
 * separator is a hyphen or whose tissue name contains an underscore.
 */
export function withinLabel(bundle: Bundle, group: string): string {
  const factor = bundle.meta.block_factor
  if (!factor) return group
  const s = bundle.samples.find(r => r.condition === group) as Record<string, string> | undefined
  if (!s) return group
  const parts = Object.keys(s)
    .filter(k => k !== 'sample' && k !== 'condition' && k !== factor)
    .sort()
    .map(k => s[k])
    .filter(Boolean)
  return parts.length ? parts.join('_') : group
}

export interface MatchedContrast {
  block: string
  contrastId: string
  label: string
}

/**
 * Contrasts grouped by the question they ask, keyed by within-block labels.
 *
 * Only keys present in TWO OR MORE blocks are returned: a question asked in one
 * place has nothing to be compared against, and offering it would be an empty
 * plot with a chooser above it.
 */
export function matchedAcrossBlocks(bundle: Bundle): Map<string, MatchedContrast[]> {
  const blockOf = blockOfCondition(bundle)
  const out = new Map<string, MatchedContrast[]>()
  if (!blockOf.size) return out
  for (const c of bundle.meta.contrasts) {
    if (c.kind === 'interaction') continue
    const block = blockOf.get(c.numerator) ?? ''
    if (!block || blockOf.get(c.denominator) !== block) continue
    if (!(bundle.degByContrast[c.id]?.length)) continue
    const key = `${withinLabel(bundle, c.numerator)} vs ${withinLabel(bundle, c.denominator)}`
    const list = out.get(key) ?? []
    list.push({ block, contrastId: c.id, label: c.label })
    out.set(key, list)
  }
  for (const [k, v] of out) if (v.length < 2) out.delete(k)
  return out
}
