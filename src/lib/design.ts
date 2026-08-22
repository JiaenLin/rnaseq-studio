// Which groups are being compared, which samples are in, and which one is the
// reference.
//
// This used to be `{ control: string; groups: string[] }` — one reference group
// and a list of arms to draw — and the comparison the statistics described was
// chosen somewhere else entirely, off a list of the contrasts the pipeline
// happened to export. That made the pipeline's choices the app's choices: a pair
// nobody exported was a pair you could not ask about, and a question the design
// supports but the exporter skipped simply did not exist here.
//
// Now the reader picks both sides freely and either side may hold more than one
// group. Two groups pooled against two others is not a convenience — on a 2×2 it
// is the main effect, the question the four pairwise contrasts cannot answer on
// their own. Whether a pair was precomputed becomes a property of the answer
// rather than the thing that decides what can be asked.
//
// This module only decides what is *shown* and *compared*. The statistics are
// always DESeq2 — either the contrast the pipeline exported, or a run performed
// here (see lib/deseq.ts).

import type { BundleMeta, Contrast, SampleRow } from '../types'

export interface GroupSel {
  /**
   * Reference groups — the denominator, and the baseline relative expression is
   * measured against. More than one pools them.
   */
  control: string[]
  /** The other side of the comparison — the numerator. */
  test: string[]
  /**
   * Arms drawn in the per-sample views but not part of the comparison.
   *
   * Display only. Kept apart from `test` because putting a group on screen and
   * putting it into the numerator are different acts, and conflating them is
   * how the old bar let a display choice move every p-value on the page.
   */
  extra: string[]
  /**
   * Samples taken out of the analysis entirely, by name.
   *
   * A failed library or an animal that turned out to be the wrong genotype is
   * not a group and cannot be excluded by unticking one — it is one sample, and
   * until now there was no way to drop it without editing the bundle.
   */
  excluded: string[]
}

export const emptySel = (): GroupSel => ({ control: [], test: [], extra: [], excluded: [] })

/** Everything shown, with the active contrast's denominator as the reference. */
export function defaultSelection(meta: BundleMeta, contrast?: Contrast): GroupSel {
  const control = contrast?.denominator || meta.control || meta.conditions[0] || ''
  const test = contrast?.numerator && contrast.numerator !== control ? [contrast.numerator] : []
  return {
    control: control ? [control] : [],
    test,
    extra: meta.conditions.filter(c => c !== control && !test.includes(c)),
    excluded: [],
  }
}

/** Display order: control first, then the compared arms, then the rest. */
export const displayOrder = (sel: GroupSel): string[] =>
  [...sel.control, ...sel.test, ...sel.extra].filter((c, i, a) => c && a.indexOf(c) === i)

/** The groups the comparison is actually between — control and test only. */
export const comparedGroups = (sel: GroupSel): string[] =>
  [...sel.control, ...sel.test].filter((c, i, a) => c && a.indexOf(c) === i)

/**
 * A readable name for one side.
 *
 * `KO_Cold` alone, `KO_Cold + KO_Thermo` for two, and a count past three —
 * a legend entry naming six pooled groups is not a legend entry.
 */
export function sideLabel(groups: readonly string[]): string {
  if (!groups.length) return '—'
  if (groups.length <= 2) return groups.join(' + ')
  return `${groups[0]} +${groups.length - 1} more`
}

/** True when the two sides share a group, which is not a comparison. */
export const overlaps = (sel: GroupSel): boolean =>
  sel.control.some(c => sel.test.includes(c))

export interface OrderedSample { sample: string; col: number; cond: string }

/**
 * Samples restricted to the selected groups and sorted into display order.
 * `col` indexes the counts matrix, so callers can read values directly.
 *
 * Excluded samples are dropped here, which is the single place that has to
 * remember it — every per-sample view in the app resolves its samples through
 * this function, so a sample switched off on the Overview is off everywhere.
 */
export function orderSamples(
  countsSamples: string[], samples: SampleRow[], sel: GroupSel,
): OrderedSample[] {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  const rank = new Map(displayOrder(sel).map((c, i) => [c, i] as const))
  const colByName = new Map(countsSamples.map((s, j) => [s, j] as const))
  const out = new Set(sel.excluded)

  return countsSamples
    .filter(s => !out.has(s) && rank.has(cond[s] ?? ''))
    .sort((a, b) =>
      (rank.get(cond[a] ?? '') ?? 0) - (rank.get(cond[b] ?? '') ?? 0) || a.localeCompare(b))
    .map(s => ({ sample: s, col: colByName.get(s)!, cond: cond[s] ?? '?' }))
}

/**
 * Samples on one side of the comparison, after exclusions.
 *
 * What DESeq2 is handed, and what the replicate counts on the bar are counted
 * from — so the number shown before a run is the number the run uses.
 */
export function samplesInGroups(
  countsSamples: string[], samples: SampleRow[], groups: readonly string[], excluded: readonly string[],
): string[] {
  const cond: Record<string, string> = {}
  for (const s of samples) cond[s.sample] = s.condition
  const want = new Set(groups)
  const out = new Set(excluded)
  return countsSamples.filter(s => !out.has(s) && want.has(cond[s] ?? ''))
}

/**
 * Values from every group on one side, pooled.
 *
 * The relative-expression baseline and the module-score test both used
 * `byCond[sel.control]` when a side was a single string. A side can now hold
 * several groups, and indexing a record by an array yields undefined — so the
 * baseline would silently become empty and every relative value NaN. Pooling is
 * also the right answer rather than a repair: if the comparison treats two
 * groups as one level, the baseline it is measured against is both of them.
 */
export const poolValues = <T>(byCond: Record<string, T[]>, groups: readonly string[]): T[] =>
  groups.flatMap(g => byCond[g] ?? [])
