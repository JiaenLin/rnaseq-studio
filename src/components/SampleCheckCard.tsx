import { useMemo, useState } from 'react'
import type { Bundle } from '../types'
import type { GroupSel } from '../lib/design'
import { conditionColors } from '../lib/palette'
import { checkSamples, MIN_SEPARATION } from '../lib/samplecheck'
import Plot from '../lib/Plot'

/**
 * "Is this sample labelled correctly?"
 *
 * The companion to the PCA, and the reason it exists: a PCA that does not
 * separate by group has two very different explanations — the labels are wrong,
 * or the effect is small — and the scatter plot looks the same either way. This
 * asks the narrower question the reader actually has, per sample, and answers it
 * with a number.
 *
 * It reports rather than concludes. A sample that sits with another group may be
 * mislabelled, may be a genuine outlier that belongs nowhere, or may be a normal
 * member of two groups that barely differ. Nothing here can tell those apart —
 * what it can do is point at the sample and say which group it resembles, which
 * is the thing that turns "the PCA looks wrong" into a checkable claim about one
 * tube.
 */
export default function SampleCheckCard({ bundle, sel }: { bundle: Bundle; sel: GroupSel }) {
  const { counts, samples, meta } = bundle
  const [ntop, setNtop] = useState(500)
  const [showMatrix, setShowMatrix] = useState(false)

  const cond = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of samples) m.set(s.sample, s.condition)
    return m
  }, [samples])

  /**
   * Ordered BY GROUP, not by the matrix's column order.
   *
   * The heatmap is only readable when members of a group are adjacent — that is
   * what makes a block structure visible, and a sample sitting in the wrong
   * block is the whole point of drawing it.
   */
  const ordered = useMemo(() => {
    const rank = new Map(meta.conditions.map((c, i) => [c, i] as const))
    const dropped = new Set(sel.excluded)
    return counts.samples
      .filter(name => !dropped.has(name))
      // The column index is looked up rather than taken from the map callback:
      // the filter above has already shifted the positions, and `j` has to index
      // the ORIGINAL matrix.
      .map(name => ({ name, j: counts.samples.indexOf(name), g: cond.get(name) ?? '—' }))
      .sort((a, b) =>
        (rank.get(a.g) ?? 999) - (rank.get(b.g) ?? 999) || a.name.localeCompare(b.name))
  }, [counts.samples, cond, meta.conditions, sel.excluded])

  const result = useMemo(
    () => checkSamples(
      counts.values, counts.samples.length,
      ordered.map(o => o.j), ordered.map(o => o.name), ordered.map(o => o.g), { ntop }),
    [counts.values, counts.samples.length, ordered, ntop])

  const misfits = result.verdicts.filter(v => v.misfit)
  const colors = conditionColors(meta.conditions)

  if (result.verdicts.length === 0) {
    return null
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="mr-auto text-sm font-semibold uppercase tracking-wide text-slate-500">
          Sample check
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          top genes
          <input type="number" className="input w-20 py-1" min={2} step={100} value={ntop}
            onChange={e => setNtop(Math.max(2, Math.round(+e.target.value) || 2))} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showMatrix} onChange={e => setShowMatrix(e.target.checked)} />
          correlation matrix
        </label>
      </div>

      {/* No group structure is the FINDING, not a precondition for one.
          This is the answer to the question that brings people to this card:
          a PCA that does not split by group is either wrong labels or no
          effect, and the separation statistic is what tells them apart. */}
      {result.weakStructure ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <b>These groups barely separate from each other</b>, so there is nothing to check a
          label against. Two samples from the same group are about as different as two from
          different groups
          {Number.isFinite(result.separation) && <> — the gap is {result.separation.toFixed(3)} in
            correlation, against a {MIN_SEPARATION} floor for this check to mean anything</>}.
          {' '}That is a result about the experiment rather than the sample sheet: if your PCA does
          not split by group, this says the effect is small, not that the labels are wrong. No
          sample is singled out, because on data like this the ranking is noise.
        </p>
      ) : misfits.length === 0 ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          <b>Every sample sits with its own group.</b> Each one correlates more closely with the
          other members of the group it is labelled with than with any other group, across the{' '}
          {result.nGenes.toLocaleString()} most variable genes, and the groups separate by{' '}
          {result.separation.toFixed(3)} in correlation.
        </p>
      ) : (
        <>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <b>{misfits.length} sample{misfits.length === 1 ? '' : 's'} sit
              {misfits.length === 1 ? 's' : ''} closer to another group</b> by more than half this
            experiment&rsquo;s own group separation of {result.separation.toFixed(3)}. Worth
            checking, and not proof of anything: a sample lands here because it is mislabelled, or
            because it is an outlier that belongs to no group.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">Sample</th>
                  <th className="px-3 py-2">Labelled</th>
                  <th className="px-3 py-2 text-right">r to own group</th>
                  <th className="px-3 py-2">Looks most like</th>
                  <th className="px-3 py-2 text-right">r to that group</th>
                  <th className="px-3 py-2 text-right">difference</th>
                </tr>
              </thead>
              <tbody>
                {misfits.sort((a, b) => b.margin - a.margin).map(v => (
                  <tr key={v.sample} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-1.5 font-mono font-medium">{v.sample}</td>
                    <td className="px-3 py-1.5">
                      <span className="pill" style={{ background: (colors[v.group] ?? '#94a3b8') + '22',
                        color: colors[v.group] ?? '#475569' }}>{v.group}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{v.own.toFixed(3)}</td>
                    <td className="px-3 py-1.5">
                      <span className="pill" style={{ background: (colors[v.nearest] ?? '#94a3b8') + '22',
                        color: colors[v.nearest] ?? '#475569' }}>{v.nearest}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{v.nearestScore.toFixed(3)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-amber-700 dark:text-amber-300">
                      +{v.margin.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result.singletons.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {result.singletons.join(', ')} {result.singletons.length === 1 ? 'has' : 'have'} one
          sample, so there is nothing to compare {result.singletons.length === 1 ? 'it' : 'them'} with.
        </p>
      )}

      {showMatrix && (
        <div className="mt-3">
          <Plot
            data={[{
              type: 'heatmap',
              z: result.matrix,
              x: result.samples,
              y: result.samples,
              colorscale: 'Viridis',
              hovertemplate: '%{y} vs %{x}<br>r = %{z:.3f}<extra></extra>',
              colorbar: { title: 'Pearson r', thickness: 12, len: 0.7 },
            }]}
            downloadName="sample_correlation"
            layout={{
              margin: { t: 10, r: 10, b: 110, l: 110 },
              height: Math.max(320, result.samples.length * 18 + 140),
              xaxis: { tickfont: { size: 9 }, tickangle: -60, automargin: true },
              yaxis: { tickfont: { size: 9 }, automargin: true, autorange: 'reversed' },
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
              font: { family: 'system-ui, sans-serif' },
            }}
          />
          <p className="mt-1 text-xs text-slate-400">
            Ordered by group, so members of a group are adjacent — a correctly labelled experiment
            shows bright blocks on the diagonal, and a sample in the wrong block is the one to check.
          </p>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Pearson correlation on log2(normalized + 1) over the {result.nGenes.toLocaleString()} most
        variable genes — the same genes the PCA uses, so the two cannot disagree. Each sample is
        scored against the <i>median</i> correlation to the other members of a group, which is what
        stops one mislabelled sample from making every innocent member of its group look wrong too.
      </p>
    </div>
  )
}
