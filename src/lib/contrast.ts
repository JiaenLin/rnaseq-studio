// Which comparison the statistics describe — one question, one answer.
//
// This module exists because the app used to answer it three times. There was
// `contrastId` behind a select in the header, `sel.control` behind a Control
// select, and `focus` behind a "Statistics for" select, and the contrast every
// tab actually read was derived from the last two while the first went on
// showing whatever it was last set to. Changing the control moved the analysis
// and left the header naming a different comparison, which is what the header
// then kept saying — not a stale render, a genuinely separate variable that
// nothing wrote.
//
// So: one list of the comparisons that exist, one selected id, and everything
// else derived. `sel` survives, narrowed to what it always really was — which
// arms the per-sample plots draw — and is no longer able to decide what is
// being tested.
//
// THE CONTRACT NOBODY WAS CHECKING
//
// A contrast names two groups, and the app assumed those names are sample
// conditions. A pipeline is under no obligation to agree. A factorial design
// fitted as `~ genotype * temperature` produces coefficients called
// "genotypeKO.temperatureThermo", and an exporter that writes those through
// gives contrasts named `KO:Thermo` against samples whose condition column says
// `KO_Thermo`. Every per-sample view then resolves that group to no samples,
// and DESeq2 re-runs report "at least 2 replicates per group (KO:Thermo: 0)" —
// a message about replication, for a problem that is about spelling.
//
// The DEG table for such a contrast is perfectly good: it came out of the
// pipeline and says what it says. What cannot be done is tie it to samples. So
// the two capabilities are tracked separately here rather than assumed
// together, and `groupsAreConditions` is what the UI reads to know which views
// it can honestly offer.

import type { Bundle, Contrast, SampleRow } from '../types'
import { samplesInGroups } from './design.ts'

/**
 * Sample counts per condition, from samples.csv intersected with the matrix,
 * minus anything the reader has excluded.
 *
 * The exclusion argument is not optional in spirit: these numbers are printed
 * on the group chips, and a chip reading "KO_Cold 6" beside a summary line
 * reading "5 samples" is the app disagreeing with itself on screen.
 */
export function conditionSizes(bundle: Bundle, excluded: readonly string[] = []): Map<string, number> {
  /**
   * Counted over the columns the MATRIX has, not the rows samples.csv has.
   *
   * Those differ more often than they should — a sample dropped at QC is
   * removed from the counts and left in the sheet — and every number in this
   * app comes from the matrix. The bar used to count samples.csv rows, so a
   * group could advertise six replicates and draw four.
   */
  const inMatrix = new Set(bundle.counts.samples)
  const gone = new Set(excluded)
  const out = new Map<string, number>()
  // Deliberately NOT pre-seeded with every declared condition. auditBundle
  // asks `sizes.has(c)` to find a condition meta.json declares that no sample
  // carries, so seeding zeros would make that check pass for everything and
  // silently retire the warning. A group whose samples are all excluded is kept
  // visible by the caller instead — see ComparisonBar's `total`.
  for (const s of bundle.samples) {
    if (!inMatrix.has(s.sample) || gone.has(s.sample)) continue
    out.set(s.condition, (out.get(s.condition) ?? 0) + 1)
  }
  return out
}

/** DESeq2's floor. Below this the dispersion cannot be estimated within a group. */
export const MIN_REPLICATES = 2

/**
 * The pipeline's contrast for this exact pair, if it exported one.
 *
 * Only ever a ONE-group-against-ONE-group match. A bundle contrast is a pairwise
 * comparison between two conditions; a pooled selection is a different model —
 * it treats several groups as one level — and quietly handing back a pairwise
 * table for it would answer a question nobody asked.
 *
 * This is the whole of what "precomputed" means now. It used to decide what
 * could be asked at all: the app listed the exported contrasts and you chose
 * from them, so a pair the pipeline skipped was a pair the app could not reach.
 * The reader picks both sides freely now, and this reports whether the answer
 * already exists rather than gating the question on it.
 */
export function matchPrecomputed(
  bundle: Bundle, control: readonly string[], test: readonly string[],
): Contrast | null {
  if (control.length !== 1 || test.length !== 1) return null
  return bundle.meta.contrasts.find(c =>
    c.kind !== 'interaction'
    && c.denominator === control[0]
    && c.numerator === test[0]
    && (bundle.degByContrast[c.id]?.length ?? 0) > 0) ?? null
}

/**
 * The exclusions that actually change THIS comparison.
 *
 * An excluded Ctrl_Cold sample cannot affect a KO_Thermo vs KO_Cold run, so it
 * has no business in the cache key — including it would throw away a valid
 * result every time an unrelated sample was toggled.
 */
export function relevantExclusions(
  bundle: Bundle, control: readonly string[], test: readonly string[], excluded: readonly string[],
): string[] {
  const cond = new Map(bundle.samples.map(s => [s.sample, s.condition]))
  const sides = new Set([...control, ...test])
  return excluded.filter(name => sides.has(cond.get(name) ?? '')).sort()
}

/**
 * The key a computed result is cached under.
 *
 * Exported and used by BOTH the state above and the runner in App, because the
 * two must agree exactly. They did not: the key was the two group lists and
 * nothing else, so running DESeq2 with one sample excluded and then excluding a
 * different one hit the same cache entry — the app served the first run's
 * numbers under the second run's label, with no way to tell from the screen.
 */
export function comparisonKey(
  bundle: Bundle, control: readonly string[], test: readonly string[], excluded: readonly string[],
): string {
  const gone = relevantExclusions(bundle, control, test, excluded)
  return `${[...test].join('+')}|${[...control].join('+')}`
    + (gone.length ? `|-${gone.join(',')}` : '')
}

export type Source = 'bundle' | 'computed' | 'computable' | 'unavailable'

export interface ComparisonState {
  source: Source
  /** The bundle contrast behind it, when `source` is 'bundle'. */
  contrast: Contrast | null
  nControl: number
  nTest: number
  /** Why it cannot be run, when `source` is 'unavailable'. */
  blocked?: string
  /**
   * Excluded samples that a precomputed table for this pair would still contain.
   *
   * When non-empty, that table is NOT used — see `hiddenPrecomputed`.
   */
  staleExclusions?: string[]
  /**
   * The pipeline's table for this pair, withheld because it does not describe
   * the current selection.
   *
   * Carried so the bar can name what it is declining to show. Nothing reads it
   * as a result.
   */
  hiddenPrecomputed?: Contrast | null
  /** Whether a run here is possible. */
  canRun?: boolean
}

/**
 * What can be said about the pair the reader has selected.
 *
 * One object rather than a list, because there is no list any more — the
 * question is "what about THIS pair", asked fresh whenever either side changes.
 */
export function comparisonState(
  bundle: Bundle,
  control: readonly string[],
  test: readonly string[],
  excluded: readonly string[],
  computedKeys: Record<string, unknown>,
): ComparisonState {
  const nControl = samplesInGroups(bundle.counts.samples, bundle.samples, control, excluded).length
  const nTest = samplesInGroups(bundle.counts.samples, bundle.samples, test, excluded).length
  const key = comparisonKey(bundle, control, test, excluded)
  const gone = relevantExclusions(bundle, control, test, excluded)
  const base = { nControl, nTest }

  if (Object.prototype.hasOwnProperty.call(computedKeys, key)) {
    return { ...base, source: 'computed', contrast: null }
  }
  const pre = matchPrecomputed(bundle, control, test)
  if (pre && !gone.length) return { ...base, source: 'bundle', contrast: pre, staleExclusions: [] }

  /**
   * A precomputed table exists, and does not describe this selection.
   *
   * It was shown anyway, with a warning beside it. That was the wrong call: a
   * DEG table, a volcano and an enrichment run are read, exported and pasted
   * into slides long after the sentence above them has been forgotten, and the
   * numbers in them are computed over samples the reader has explicitly taken
   * out. A warning does not travel with a screenshot.
   *
   * So the pipeline's result is WITHHELD for this selection rather than
   * annotated. It is not lost — clear the exclusion, or re-run here, and it
   * comes straight back. `hiddenPrecomputed` is carried so the bar can say
   * which table it is declining to show and why, instead of the tabs simply
   * looking empty.
   */
  if (pre) {
    const runnable = !!bundle.rawCounts && nControl >= MIN_REPLICATES && nTest >= MIN_REPLICATES
    return {
      ...base,
      source: runnable ? 'computable' : 'unavailable',
      contrast: null,
      hiddenPrecomputed: pre,
      staleExclusions: gone,
      canRun: runnable,
      blocked: runnable ? undefined
        : !bundle.rawCounts
          ? 'This bundle has no raw_counts.csv, so the comparison cannot be re-run without the excluded samples. Bring them back to see your pipeline\u2019s result.'
          : `Too few samples remain after the exclusions — ${nTest} and ${nControl}, and DESeq2 needs at least ${MIN_REPLICATES} on each side.`,
    }
  }

  if (!control.length || !test.length) {
    return { ...base, source: 'unavailable', contrast: null,
      blocked: 'Choose at least one group on each side.' }
  }
  if (control.some(c => test.includes(c))) {
    return { ...base, source: 'unavailable', contrast: null,
      blocked: 'The same group is on both sides, which is not a comparison.' }
  }
  if (!bundle.rawCounts) {
    return { ...base, source: 'unavailable', contrast: null,
      blocked: 'Your pipeline did not export this pair, and this bundle has no raw_counts.csv — DESeq2 models raw counts, so it cannot be run here.' }
  }
  if (nControl < MIN_REPLICATES || nTest < MIN_REPLICATES) {
    return { ...base, source: 'unavailable', contrast: null,
      blocked: `DESeq2 needs at least ${MIN_REPLICATES} samples on each side — this selection has ${nTest} and ${nControl}.` }
  }
  return { ...base, source: 'computable', contrast: null }
}

/* ---------------------------------------------------------------------------
   What is wrong with this bundle, said once.
--------------------------------------------------------------------------- */

export interface Problem {
  kind: 'orphan-contrast' | 'orphan-condition' | 'missing-samples' | 'empty-contrast'
  /** One sentence, for a banner. */
  text: string
}

/**
 * Contract violations worth telling the reader about.
 *
 * Every one of these used to be silent, and each one shows up downstream as a
 * plot that is empty or a number that is wrong without saying why. The point is
 * not to refuse the bundle — it is to name the discrepancy where the reader can
 * see it, rather than let them discover it as an error about replication.
 */
export function auditBundle(bundle: Bundle): Problem[] {
  const problems: Problem[] = []
  const sizes = conditionSizes(bundle)
  const declared = new Set(bundle.meta.conditions)

  // 1. A contrast naming groups no sample has — the factorial-vocabulary case.
  const orphanGroups = new Set<string>()
  for (const c of bundle.meta.contrasts) {
    // An interaction coefficient has no groups by construction — that is what
    // it IS, not a defect in the bundle, and warning about it would train
    // people to ignore this banner.
    if (c.kind === 'interaction') continue
    for (const g of [c.numerator, c.denominator]) if (!sizes.has(g)) orphanGroups.add(g)
  }
  if (orphanGroups.size) {
    const names = [...orphanGroups].sort()
    problems.push({
      kind: 'orphan-contrast',
      text: `${names.length === 1 ? 'A contrast names a group' : 'Contrasts name groups'} that no sample has: `
        + `${names.slice(0, 6).map(q).join(', ')}${names.length > 6 ? `, and ${names.length - 6} more` : ''}. `
        + 'Their differential expression results are shown as exported, but they cannot be '
        + 'tied to samples — so per-sample expression, the heatmap and re-running DESeq2 are '
        + 'unavailable for them. This usually means the pipeline named its contrasts after '
        + 'model coefficients rather than after the condition column in samples.csv.',
    })
  }

  // 2. A condition declared in meta.json that no sample carries.
  const orphanConds = bundle.meta.conditions.filter(c => !sizes.has(c))
  if (orphanConds.length) {
    problems.push({
      kind: 'orphan-condition',
      text: `meta.json lists ${orphanConds.length === 1 ? 'a condition' : 'conditions'} no sample has: `
        + `${orphanConds.slice(0, 6).map(q).join(', ')}. `
        + 'They are offered nowhere, because there is nothing to draw for them.',
    })
  }

  // 3. A condition the samples have that meta.json never declared.
  const undeclared = [...sizes.keys()].filter(c => !declared.has(c))
  if (undeclared.length) {
    problems.push({
      kind: 'orphan-condition',
      text: `samples.csv has ${undeclared.length === 1 ? 'a condition' : 'conditions'} meta.json does not list: `
        + `${undeclared.slice(0, 6).map(q).join(', ')}. `
        + 'Add them to meta.conditions to compare them.',
    })
  }

  // 4. Samples in the sheet that the matrix has no column for.
  const inMatrix = new Set(bundle.counts.samples)
  const missing = bundle.samples.map(s => s.sample).filter(s => !inMatrix.has(s))
  if (missing.length) {
    problems.push({
      kind: 'missing-samples',
      text: `${missing.length} sample${missing.length === 1 ? '' : 's'} in samples.csv `
        + `${missing.length === 1 ? 'has' : 'have'} no column in the counts matrix `
        + `(${missing.slice(0, 4).map(q).join(', ')}${missing.length > 4 ? ', …' : ''}). `
        + 'They are excluded from every count and every plot.',
    })
  }

  // 5. A contrast whose DEG file never arrived or parsed to nothing.
  const emptyContrasts = bundle.meta.contrasts
    .filter(c => !(bundle.degByContrast[c.id]?.length))
    .map(c => c.label || c.id)
  if (emptyContrasts.length) {
    problems.push({
      kind: 'empty-contrast',
      text: `${emptyContrasts.length === 1 ? 'A contrast has' : 'Contrasts have'} no results table: `
        + `${emptyContrasts.slice(0, 4).map(q).join(', ')}${emptyContrasts.length > 4 ? ', …' : ''}. `
        + `${emptyContrasts.length === 1 ? 'Its' : 'Their'} deg_<id>.csv `
        + `${emptyContrasts.length === 1 ? 'is' : 'are'} missing from the bundle, `
        + 'named differently by meta.json, or could not be read.',
    })
  }

  return problems
}

const q = (s: string) => `“${s}”`

/** A sample's condition, for callers that only have the sheet. */
export const conditionOf = (samples: SampleRow[]): Map<string, string> =>
  new Map(samples.map(s => [s.sample, s.condition]))
