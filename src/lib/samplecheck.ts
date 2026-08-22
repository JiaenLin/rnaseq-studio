// Does each sample sit with the group its label claims?
//
// A PCA answers this by eye and only when the answer is obvious. The question
// behind it is sharper and worth computing: for a given sample, is it more like
// the OTHER members of its own group than it is like any other group? A sample
// that is not is either an outlier, or is labelled wrongly — and those two look
// identical on a scatter plot, which is why this reports the numbers rather
// than a verdict.
//
// WHY THIS IS NOT A CLUSTERING
//
// It deliberately does not cluster the samples and then compare partitions.
// Clustering answers "how would I group these if I did not know the labels",
// which sounds like the same question and is not: on a design where the
// treatment effect is genuinely small, every sample can be correctly labelled
// and the clustering still disagree with the design. That would flag the whole
// experiment. What is asked here is much narrower and survives a weak effect —
// each sample is scored against the groups AS LABELLED, and only a sample that
// prefers a different group's company to its own is reported.
//
// THE SIMILARITY
//
// Pearson correlation on log2(x+1) over the most variable genes — the same
// input the PCA uses, so the two figures cannot disagree with each other. On
// all genes the correlation between any two RNA-seq libraries is 0.95+ and
// differences vanish into the fourth decimal; restricted to the variable genes
// it separates. Correlation rather than Euclidean distance because it is
// invariant to a library-size scale factor the normalisation may have left
// behind, and a sample that is merely deeper should not read as a different
// biological group.

export interface SampleVerdict {
  sample: string
  group: string
  /** Median correlation to the OTHER members of its own group. */
  own: number
  /** The group it correlates with most, by the same median. */
  nearest: string
  nearestScore: number
  /**
   * True when `nearest` is not its own group.
   *
   * Not a claim that the label is wrong. A sample can prefer another group
   * because it is mislabelled, because it is an outlier that belongs nowhere,
   * or because two groups genuinely barely differ. The report says which.
   */
  misfit: boolean
  /**
   * How much better the nearest group is than its own, in correlation units.
   * Negative when its own group wins.
   */
  margin: number
}

export interface SampleCheck {
  /** Correlation between every pair, in the order of `samples`. */
  matrix: number[][]
  samples: string[]
  groups: string[]
  verdicts: SampleVerdict[]
  /** Genes the correlation was computed on. */
  nGenes: number
  /** Groups with only one member, which cannot be checked. */
  singletons: string[]
  /**
   * How far apart the groups are AT ALL, in correlation units: the median
   * within-group correlation minus the median between-group one.
   *
   * This is the scale everything else is judged against, and computing it is
   * what stopped this check from being useless. Flagging every sample whose
   * margin is above zero flagged 18 of 24 on a dataset with no group structure
   * — which is true, meaningless, and indistinguishable from a real finding.
   * Half the samples prefer a neighbouring group by 0.001 when nothing
   * separates; that is noise, and noise reported as 18 warnings is worse than
   * silence.
   */
  separation: number
  /**
   * True when the groups barely separate, so per-sample verdicts carry no
   * information and none are issued.
   *
   * This is itself the answer to the question that brings people here. A PCA
   * that does not split by group has two explanations — wrong labels, or no
   * effect — and THIS distinguishes them: if no pair of groups is further apart
   * than two members of one group, there is nothing for a label to be wrong
   * about, and the finding is about the experiment rather than the sample sheet.
   */
  weakStructure: boolean
}

/**
 * Pearson correlation of every sample against every other.
 *
 * @param values row-major genes × samples, as CountsMatrix holds them
 * @param S      the matrix's sample stride
 * @param cols   which columns to use, in report order
 * @param names  their names, parallel to `cols`
 * @param groups their group labels, parallel to `cols`
 */
export function checkSamples(
  values: Float64Array,
  S: number,
  cols: number[],
  names: string[],
  groups: string[],
  opts: { ntop?: number } = {},
): SampleCheck {
  const ntop = opts.ntop ?? 500
  const m = cols.length
  const empty: SampleCheck = {
    matrix: [], samples: names, groups, verdicts: [], nGenes: 0, singletons: [],
    separation: NaN, weakStructure: true,
  }
  if (m < 2) return empty

  const nGenesTotal = Math.floor(values.length / S)

  // Same transform and same ranking as the PCA, so the two views cannot tell
  // different stories about the same samples.
  const logged = new Float64Array(nGenesTotal * m)
  const vars = new Float64Array(nGenesTotal)
  for (let g = 0; g < nGenesTotal; g++) {
    const at = g * m
    let sum = 0
    for (let j = 0; j < m; j++) {
      const raw = values[g * S + cols[j]]
      const lv = Number.isFinite(raw) ? Math.log2(Math.max(raw, 0) + 1) : 0
      logged[at + j] = lv
      sum += lv
    }
    const mean = sum / m
    let ss = 0
    for (let j = 0; j < m; j++) { const d = logged[at + j] - mean; ss += d * d }
    vars[g] = ss / (m - 1)
  }
  const varying: number[] = []
  for (let g = 0; g < nGenesTotal; g++) if (vars[g] > 0) varying.push(g)
  if (!varying.length) return empty
  varying.sort((a, b) => vars[b] - vars[a] || a - b)
  const keep = varying.slice(0, Math.min(ntop, varying.length))
  const G = keep.length

  // Each sample as a z-scored vector over the kept genes, so a dot product IS
  // the correlation and the pairwise loop is one multiply-add per gene.
  const z = new Float64Array(m * G)
  for (let j = 0; j < m; j++) {
    let sum = 0
    for (let k = 0; k < G; k++) sum += logged[keep[k] * m + j]
    const mean = sum / G
    let ss = 0
    for (let k = 0; k < G; k++) { const d = logged[keep[k] * m + j] - mean; ss += d * d }
    const sd = Math.sqrt(ss) || 1
    for (let k = 0; k < G; k++) z[j * G + k] = (logged[keep[k] * m + j] - mean) / sd
  }

  const matrix: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(1))
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      let acc = 0
      for (let k = 0; k < G; k++) acc += z[i * G + k] * z[j * G + k]
      // Clamped: the dot product of two unit vectors is in [-1, 1] up to
      // rounding, and a correlation printed as 1.0000000000000002 is a
      // distraction in a table people are reading for anomalies.
      const r = Math.max(-1, Math.min(1, acc))
      matrix[i][j] = r
      matrix[j][i] = r
    }
  }

  const levels = [...new Set(groups)]
  const membersOf = new Map<string, number[]>()
  for (const l of levels) membersOf.set(l, [])
  groups.forEach((g, i) => membersOf.get(g)!.push(i))
  const singletons = levels.filter(l => membersOf.get(l)!.length < 2)

  const verdicts: SampleVerdict[] = []
  for (let i = 0; i < m; i++) {
    const mine = groups[i]
    /**
     * MEDIAN correlation of i to a group, never counting i itself.
     *
     * The median, not the mean, and the difference is the whole usefulness of
     * this check on a real experiment. One mislabelled sample sitting inside a
     * group drags that group's MEAN down for every genuine member of it, so a
     * single swap was reported as five misfits — the impostor plus the four
     * samples it had contaminated — and the reader has to work out which one is
     * the cause. A median over the other members ignores a single contaminant
     * entirely, so the same swap reports exactly the sample that is wrong.
     */
    const scoreTo = (level: string) => {
      const idx = membersOf.get(level)!.filter(j => j !== i)
      if (!idx.length) return NaN
      const rs = idx.map(j => matrix[i][j]).sort((a, b) => a - b)
      const h = rs.length >> 1
      return rs.length % 2 ? rs[h] : (rs[h - 1] + rs[h]) / 2
    }
    const own = scoreTo(mine)
    let nearest = mine
    let nearestScore = -Infinity
    for (const l of levels) {
      const v = scoreTo(l)
      if (Number.isFinite(v) && v > nearestScore) { nearestScore = v; nearest = l }
    }
    // A singleton group has no "own" score, so it cannot be a misfit — there is
    // nothing to be unlike. Reporting it would be reporting the design.
    const comparable = Number.isFinite(own)
    verdicts.push({
      sample: names[i],
      group: mine,
      own: comparable ? own : NaN,
      nearest,
      nearestScore: Number.isFinite(nearestScore) ? nearestScore : NaN,
      misfit: false,                          // decided below, against `separation`
      margin: comparable ? nearestScore - own : NaN,
    })
  }

  /**
   * The scale a margin is judged against: how far apart the groups are at all.
   *
   * Medians on both sides, for the same reason the per-sample score uses one —
   * one bad sample must not set the scale for the whole experiment.
   */
  const within: number[] = []
  const between: number[] = []
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      (groups[i] === groups[j] ? within : between).push(matrix[i][j])
    }
  }
  const median = (a: number[]) => {
    if (!a.length) return NaN
    const b = [...a].sort((x, y) => x - y)
    const h = b.length >> 1
    return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2
  }
  const separation = within.length && between.length
    ? median(within) - median(between)
    : NaN
  const weakStructure = !Number.isFinite(separation) || separation < MIN_SEPARATION

  if (!weakStructure) {
    for (const v of verdicts) {
      // Judged against the design's own scale, not against zero. A sample is
      // worth reporting when its preference for another group is at least half
      // as strong as the separation between groups in this experiment — which
      // on a well-separated design is a real anomaly, and on a marginal one is
      // never reached because nothing gets that far.
      v.misfit = Number.isFinite(v.margin) && v.margin > separation * MARGIN_FRACTION
    }
  }

  return {
    matrix, samples: names, groups, verdicts, nGenes: G, singletons,
    separation, weakStructure,
  }
}

/**
 * Below this much separation between groups, the experiment has no group
 * structure to check labels against. In correlation units on the most variable
 * genes, where a real treatment effect moves the within-vs-between gap well
 * past this.
 */
export const MIN_SEPARATION = 0.02

/** How much of the design's separation a sample must cross to be reported. */
export const MARGIN_FRACTION = 0.5
