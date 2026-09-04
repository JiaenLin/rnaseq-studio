import { useMemo, useState } from 'react'
import type { Bundle } from '../types'
import Plot from '../lib/Plot'
import { SIG_COLORS } from '../lib/palette'
import {
  blockOfCondition, matchedAcrossBlocks, compareResponses,
  type ResponseComparison,
} from '../lib/crossblock'

/**
 * Comparing two blocks, without a model that spans them.
 *
 * The bundle was fitted one block at a time, so "is heart's ageing response the
 * same as liver's" has no contrast behind it and never will. It is still the
 * question the dataset was built to ask, so this answers it the way it can be
 * answered honestly: put the two blocks' fold changes on the same axes.
 *
 * That works because a fold change is a ratio WITHIN a block. Whatever offset
 * each block's normalisation left behind cancels inside its own ratio, so the
 * two axes are comparable at every magnitude with no cross-block normalisation
 * performed anywhere — which is exactly what comparing expression between
 * tissues cannot claim.
 */
export default function CrossBlock({ bundle }: { bundle: Bundle }) {
  const blockOf = useMemo(() => blockOfCondition(bundle), [bundle])
  const matched = useMemo(() => matchedAcrossBlocks(bundle), [bundle])
  const keys = useMemo(() => [...matched.keys()], [matched])

  const [question, setQuestion] = useState(keys[0] ?? '')
  const active = matched.get(question) ?? matched.get(keys[0] ?? '') ?? []
  const blocks = active.map(m => m.block)

  const [aBlock, setABlock] = useState('')
  const [bBlock, setBBlock] = useState('')
  const a = blocks.includes(aBlock) ? aBlock : blocks[0] ?? ''
  const b = blocks.includes(bBlock) ? bBlock : blocks[1] ?? ''

  const cmp: ResponseComparison | null = useMemo(() => {
    const ma = active.find(m => m.block === a)
    const mb = active.find(m => m.block === b)
    if (!ma || !mb) return null
    return compareResponses(bundle.degByContrast[ma.contrastId] ?? [],
                            bundle.degByContrast[mb.contrastId] ?? [])
  }, [active, a, b, bundle])

  if (!blockOf.size) {
    return (
      <div className="card p-8 text-center text-sm text-slate-400">
        This bundle was fitted as one model over every group, so there are no blocks to
        compare across. Every comparison it supports is on the bar above.
      </div>
    )
  }
  if (!keys.length) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        <p className="mb-2">
          This bundle is fitted per <b>{bundle.meta.block_factor}</b>, but no single question is
          asked in more than one of them.
        </p>
        <p className="text-xs text-slate-400">
          Comparing across blocks means comparing the same comparison in two places — the same
          two levels contrasted in each. Export a comparison that appears in at least two
          {' '}{bundle.meta.block_factor} levels and it will appear here.
        </p>
      </div>
    )
  }

  const nBoth = cmp?.genes.length ?? 0

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            <div className="mb-1 font-semibold uppercase tracking-wide">The same question, asked in</div>
            <select className="input py-1 text-sm" value={question}
              onChange={e => { setQuestion(e.target.value); setABlock(''); setBBlock('') }}>
              {keys.map(k => (
                <option key={k} value={k}>{k} · {matched.get(k)!.length} {bundle.meta.block_factor}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            <div className="mb-1">horizontal</div>
            <select className="input py-1 text-sm" value={a} onChange={e => setABlock(e.target.value)}>
              {blocks.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            <div className="mb-1">vertical</div>
            <select className="input py-1 text-sm" value={b} onChange={e => setBBlock(e.target.value)}>
              {blocks.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>

        {!cmp || nBoth < 3 ? (
          <p className="text-sm text-slate-400">
            Pick two different {bundle.meta.block_factor} levels with results for this question.
          </p>
        ) : (
          <>
            <Comparison bundle={bundle} cmp={cmp} a={a} b={b} question={question} />
            <Numbers cmp={cmp} a={a} b={b} blockFactor={bundle.meta.block_factor ?? 'block'} />
          </>
        )}
      </div>

      {cmp && nBoth >= 3 && <InteractionTable cmp={cmp} a={a} b={b} />}
    </div>
  )
}

/** log2FC against log2FC, every tested gene, no threshold anywhere. */
function Comparison({ bundle, cmp, a, b, question }: {
  bundle: Bundle; cmp: ResponseComparison; a: string; b: string; question: string
}) {
  const bucket = (s: 'both' | 'a' | 'b' | 'none') =>
    cmp.genes.filter(g => (s === 'both' ? g.sigA && g.sigB
      : s === 'a' ? g.sigA && !g.sigB
        : s === 'b' ? !g.sigA && g.sigB : !g.sigA && !g.sigB))
  const trace = (name: string, s: 'both' | 'a' | 'b' | 'none', color: string, size: number) => {
    const rows = bucket(s)
    return {
      type: 'scattergl' as const, mode: 'markers' as const, name: `${name} (${rows.length.toLocaleString()})`,
      x: rows.map(g => g.lfcA), y: rows.map(g => g.lfcB),
      text: rows.map(g => `${g.gene_name}<br>${a}: ${g.lfcA.toFixed(2)}<br>${b}: ${g.lfcB.toFixed(2)}`
        + (Number.isFinite(g.padj) ? `<br>interaction padj ${g.padj.toExponential(2)}` : '')),
      hoverinfo: 'text' as const,
      marker: { size, color, opacity: s === 'none' ? 0.35 : 0.8 },
    }
  }
  const lim = Math.max(2, ...cmp.genes.map(g => Math.max(Math.abs(g.lfcA), Math.abs(g.lfcB))))
  const line = (x: number[], y: number[], dash: string, color: string, name: string) => ({
    type: 'scatter' as const, mode: 'lines' as const, x, y, name,
    line: { dash, width: 1.5, color }, hoverinfo: 'skip' as const, showlegend: true,
  })
  return (
    <Plot
      data={[
        trace('not significant either side', 'none', '#cbd5e1', 3),
        trace(`${a} only`, 'a', SIG_COLORS.down, 4),
        trace(`${b} only`, 'b', SIG_COLORS.up, 4),
        trace('both', 'both', '#7c3aed', 4.5),
        line([-lim, lim], [-lim, lim], 'dot', '#94a3b8', 'equal response'),
        ...(Number.isFinite(cmp.slope)
          ? [line([-lim, lim], [-lim * cmp.slope, lim * cmp.slope], 'solid', '#0f766e',
              `fitted slope ${cmp.slope.toFixed(2)}`)]
          : []),
      ]}
      layout={{
        height: 460,
        title: { text: `${question} — ${bundle.meta.block_factor}: ${a} vs ${b}`, x: 0, xanchor: 'left', font: { size: 12.5 } },
        xaxis: { title: { text: `log2 fold change in ${a}` }, zeroline: true, range: [-lim, lim] },
        yaxis: { title: { text: `log2 fold change in ${b}` }, zeroline: true, range: [-lim, lim] },
        legend: { orientation: 'h', y: -0.18, font: { size: 10 } },
        margin: { l: 60, r: 20, t: 30, b: 90 },
      }}
    />
  )
}

function Numbers({ cmp, a, b, blockFactor }: {
  cmp: ResponseComparison; a: string; b: string; blockFactor: string
}) {
  const q = cmp.quadrants
  const concordant = q.upUp + q.downDown
  const discordant = q.upDown + q.downUp
  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Stat label="genes tested in both" value={cmp.genes.length.toLocaleString()} />
        <Stat label="Spearman" value={cmp.spearman.toFixed(3)} />
        <Stat label="Pearson" value={cmp.pearson.toFixed(3)} />
        <Stat label={`slope (${b} per unit ${a})`} value={Number.isFinite(cmp.slope) ? cmp.slope.toFixed(3) : '—'} />
        <Stat label="same direction" value={concordant.toLocaleString()} />
        <Stat label="opposite" value={discordant.toLocaleString()} />
      </div>

      <p className="leading-relaxed text-slate-500 dark:text-slate-400">
        Correlation says whether the two move <b>together</b>; the slope says whether they move by
        the <b>same amount</b>. The slope is a Deming fit, not least squares — both axes are noisy
        estimates, and regressing one on the other is pulled toward zero by that noise, which would
        make the quieter {blockFactor} look even quieter than it is.
      </p>

      {/* Blocks have their own gene universes, so absence has two meanings and
          they are not the same claim. */}
      {(cmp.onlyA.length > 0 || cmp.onlyB.length > 0) && (
        <p className="leading-relaxed text-amber-700 dark:text-amber-300">
          <b>{cmp.onlyA.length.toLocaleString()}</b> genes were tested in {a} but not in {b}, and{' '}
          <b>{cmp.onlyB.length.toLocaleString()}</b> the other way round — not expressed highly
          enough there to enter that fit at all. They are absent from the plot because they have no
          second coordinate, not because they did not change. &ldquo;Not tested here&rdquo; and
          &ldquo;tested and unchanged&rdquo; are different findings.
        </p>
      )}

      {cmp.usedMLE ? (
        <p className="leading-relaxed text-slate-500 dark:text-slate-400">
          <b>{cmp.nInteraction.toLocaleString()}</b> genes respond differently in the two at
          padj&nbsp;&lt;&nbsp;0.05. That is a Wald test on the difference of the two fold changes,
          with SE&nbsp;=&nbsp;&radic;(SE<sub>{a}</sub>²&nbsp;+&nbsp;SE<sub>{b}</sub>²) — valid
          because the two fits used different samples, and better than one model spanning both,
          which would force a single dispersion per gene across them. Computed on the unshrunk
          estimates, since shrinkage strength differs between fits.
        </p>
      ) : (
        <p className="leading-relaxed text-amber-700 dark:text-amber-300">
          This bundle predates the unshrunk fold-change columns, so no interaction test is offered.
          Comparing shrunk estimates across two fits would read a difference in shrinkage as
          biology. The scatter above is still sound — re-export from RNA-seq Lab for the test.
        </p>
      )}
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="text-slate-500 dark:text-slate-400">
    {label} <b className="tabular-nums text-slate-800 dark:text-slate-100">{value}</b>
  </span>
)

/** The genes whose response actually differs, strongest first. */
function InteractionTable({ cmp, a, b }: { cmp: ResponseComparison; a: string; b: string }) {
  const [n, setN] = useState(25)
  if (!cmp.usedMLE) return null
  const rows = cmp.genes
    .filter(g => Number.isFinite(g.padj))
    .sort((x, y) => x.padj - y.padj || Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, n)
  if (!rows.length) return null
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3">
        <h3 className="text-sm font-semibold">Genes that respond differently</h3>
        <span className="text-xs text-slate-400">{cmp.nInteraction.toLocaleString()} at padj &lt; 0.05</span>
        <button className="btn ml-auto py-0.5 text-xs" onClick={() => setN(v => v + 25)}>Show more</button>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">gene</th>
              <th className="px-3 py-2 text-right">{a}</th>
              <th className="px-3 py-2 text-right">{b}</th>
              <th className="px-3 py-2 text-right">difference</th>
              <th className="px-3 py-2 text-right">z</th>
              <th className="px-3 py-2 text-right">padj</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(g => (
              <tr key={g.gene_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5 font-medium">{g.gene_name}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{g.lfcA.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{g.lfcB.toFixed(2)}</td>
                <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${g.delta > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                  {g.delta > 0 ? '+' : ''}{g.delta.toFixed(2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{g.z.toFixed(1)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {g.padj < 1e-4 ? g.padj.toExponential(1) : g.padj.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
