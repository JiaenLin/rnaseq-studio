// Which groups are being compared, and which one is the reference.
//
// A combinatorial design can carry 20+ arms while any single question involves
// three or four of them. This selection is held once at the app level and read
// by every view, so narrowing to "control + two arms" narrows the expression
// plots, the module score and the heatmap together rather than tab by tab.
//
// This module only decides what is *shown*. Which pair the statistics describe
// is chosen separately, and those statistics are always DESeq2 — either the
// contrast the pipeline exported, or a run performed here (see lib/deseq.ts).

import type { BundleMeta, Contrast, SampleRow } from '../types'

export interface GroupSel {
  /** Reference group — the relative-expression baseline, drawn first. */
  control: string
  /** Experimental groups to display, in order. */
  groups: string[]
}

/** Everything shown, with the active contrast's denominator as the reference. */
export function defaultSelection(meta: BundleMeta, contrast?: Contrast): GroupSel {
  const control = contrast?.denominator || meta.control || meta.conditions[0] || ''
  return { control, groups: meta.conditions.filter(c => c !== control) }
}

/** Display order: control first, then the chosen experimental groups. */
export const displayOrder = (sel: GroupSel): string[] =>
  [sel.control, ...sel.groups.filter(g => g && g !== sel.control)].filter(Boolean)

export interface OrderedSample { sample: string; col: number; cond: string }

/**
 * Samples restricted to the selected groups and sorted into display order.
 * `col` indexes the counts matrix, so callers can read values directly.
 */
export function orderSamples(
  countsSamples: string[], samples: SampleRow[], sel: GroupSel,
): OrderedSample[] {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  const rank = new Map(displayOrder(sel).map((c, i) => [c, i] as const))
  const colByName = new Map(countsSamples.map((s, j) => [s, j] as const))

  return countsSamples
    .filter(s => rank.has(cond[s] ?? ''))
    .sort((a, b) =>
      (rank.get(cond[a] ?? '') ?? 0) - (rank.get(cond[b] ?? '') ?? 0) || a.localeCompare(b))
    .map(s => ({ sample: s, col: colByName.get(s)!, cond: cond[s] ?? '?' }))
}
