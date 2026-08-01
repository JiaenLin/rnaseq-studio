// Differential expression computed in the browser, for any pair of groups.
//
// The bundle only carries the contrasts the pipeline chose to run. A 23-arm
// design has hundreds of possible pairs and nobody exports them all, so any
// comparison the user assembles that was not precomputed is tested here instead.
//
// This is a Welch t-test on log2 normalized counts with Benjamini-Hochberg
// correction — deliberately simple, and NOT equivalent to DESeq2: there is no
// dispersion shrinkage, no negative-binomial model, and no shared information
// across genes. It is an exploratory screen. Everything it produces is labelled
// as computed here so it is never mistaken for the pipeline's own statistics.

import type { CountsMatrix, DEGRow } from '../types'
import type { OrderedSample } from './design'
import { mean, welchP } from './stats.ts'
import { bh } from './ora.ts'

export const COMPUTED_ENGINE = 'welch-t (computed in browser)'

/** Marks a contrast id that this module produced rather than the pipeline. */
export const computedContrastId = (numerator: string, denominator: string) =>
  `~computed:${numerator}_vs_${denominator}`

export const isComputedContrast = (id: string) => id.startsWith('~computed:')

/**
 * Test every gene for `numerator` vs `denominator`.
 * `ordered` supplies the column index of each sample, so values are read
 * straight out of the counts matrix without re-deriving the layout.
 */
export function computeDE(
  counts: CountsMatrix,
  ordered: OrderedSample[],
  numerator: string,
  denominator: string,
): DEGRow[] {
  const numCols = ordered.filter(o => o.cond === numerator).map(o => o.col)
  const denCols = ordered.filter(o => o.cond === denominator).map(o => o.col)
  const S = counts.samples.length
  const n = counts.geneIds.length

  const rows: DEGRow[] = new Array(n)
  const pvals: number[] = new Array(n)

  // Too few replicates for a variance estimate: report fold change, no p-value.
  const testable = numCols.length >= 2 && denCols.length >= 2

  for (let i = 0; i < n; i++) {
    const base = i * S
    const a: number[] = [], b: number[] = []
    let rawA = 0, rawB = 0
    for (const c of denCols) { const v = counts.values[base + c]; rawA += v; a.push(Math.log2(v + 1)) }
    for (const c of numCols) { const v = counts.values[base + c]; rawB += v; b.push(Math.log2(v + 1)) }

    const lfc = mean(b) - mean(a)
    let p: number | null = null
    if (testable) {
      const w = welchP(a, b)
      p = Number.isFinite(w.p) ? w.p : 1
    }
    pvals[i] = p ?? 1
    rows[i] = {
      gene_id: counts.geneIds[i],
      gene_name: counts.geneNames[i] || counts.geneIds[i],
      baseMean: (rawA + rawB) / Math.max(1, denCols.length + numCols.length),
      log2FoldChange: Number.isFinite(lfc) ? lfc : 0,
      lfcSE: null,
      pvalue: p,
      padj: null,
    }
  }

  if (testable) {
    const adj = bh(pvals)
    for (let i = 0; i < n; i++) rows[i].padj = adj[i]
  }
  return rows
}

export const countSignificant = (rows: DEGRow[], padjMax = 0.05, lfcMin = 1) =>
  rows.reduce((acc, r) =>
    acc + (r.padj != null && r.padj < padjMax && Math.abs(r.log2FoldChange) >= lfcMin ? 1 : 0), 0)
