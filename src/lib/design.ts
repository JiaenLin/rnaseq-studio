// Which groups are being compared, and which one is the reference.
//
// A combinatorial design can carry 20+ arms while any single question involves
// three or four of them. This selection is held once at the app level and read
// by every view, so narrowing to "control + two arms" narrows the expression
// plots, the module score and the heatmap together rather than tab by tab.
//
// Note what this does NOT do: differential-expression statistics come from the
// contrast files the pipeline computed, so selecting arbitrary groups cannot
// invent log2FC or padj for a pair the bundle never tested. Picking exactly one
// experimental group switches to that contrast when the bundle has it.

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

export const isShown = (sel: GroupSel, condition: string): boolean =>
  condition === sel.control || sel.groups.includes(condition)

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

/** The contrast matching this selection, when the bundle actually computed it. */
export function matchingContrast(sel: GroupSel, contrasts: Contrast[]): Contrast | undefined {
  if (sel.groups.length !== 1) return undefined
  return contrasts.find(c => c.denominator === sel.control && c.numerator === sel.groups[0])
}

/**
 * Contrasts indexed by reference group, built once per bundle.
 *
 * Only the comparisons the pipeline actually ran exist here — a viewer cannot
 * conjure log2FC/padj for a pair that was never modelled. Indexing them lets the
 * UI answer "given this control, what can I actually look at?" instantly.
 */
export interface ContrastIndex {
  /** denominator → contrasts computed against it */
  byControl: Map<string, Contrast[]>
  /** groups usable as a reference, in the order meta declares conditions */
  controls: string[]
}

export function indexContrasts(contrasts: Contrast[], conditions: string[]): ContrastIndex {
  const byControl = new Map<string, Contrast[]>()
  for (const c of contrasts) {
    const list = byControl.get(c.denominator)
    if (list) list.push(c)
    else byControl.set(c.denominator, [c])
  }
  const rank = new Map(conditions.map((c, i) => [c, i] as const))
  const controls = [...byControl.keys()]
    .sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b))
  return { byControl, controls }
}

/** Contrasts available for the current selection: this control, a chosen arm. */
export function availableContrasts(idx: ContrastIndex, sel: GroupSel): Contrast[] {
  return (idx.byControl.get(sel.control) ?? []).filter(c => sel.groups.includes(c.numerator))
}

/** Selected arms with no precomputed contrast against the chosen control. */
export function groupsWithoutContrast(idx: ContrastIndex, sel: GroupSel): string[] {
  const have = new Set((idx.byControl.get(sel.control) ?? []).map(c => c.numerator))
  return sel.groups.filter(g => !have.has(g))
}

/** True when the selection no longer matches the contrast supplying DEG stats. */
export const contrastMismatch = (sel: GroupSel, contrast?: Contrast): boolean =>
  !!contrast && (contrast.denominator !== sel.control || !sel.groups.includes(contrast.numerator))
