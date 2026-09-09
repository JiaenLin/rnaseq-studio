import { useMemo, useState } from 'react'
import type { Bundle } from '../types'
import { isoformGenes, isoformsOfGene, categoryTally, prettyCategory } from '../lib/isoform'

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`
const sci = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v < 1e-4 ? v.toExponential(1) : v.toFixed(4)
/** A share, never rounded to a misleading "0.0%": 21 of 55,852 is not zero. */
const pctOf = (n: number, total: number) => {
  if (!total) return '—'
  const v = 100 * n / total
  return v === 0 ? '0%' : v < 0.1 ? '<0.1%' : `${v.toFixed(1)}%`
}
/** Never call bambu's own class strings "SQANTI categories". They are not. */
const VOCAB: Record<string, string> = {
  bambu: 'bambu transcript classes',
  sqanti: 'SQANTI3 structural categories',
  mixed: 'mixed bambu / SQANTI3 classes — the join reached only some models',
  none: 'Structural categories',
}
const fc = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2)

/**
 * The isoform layer: which isoform of a gene, not just how much of the gene.
 *
 * One tab, deliberately. The temptation is three — structure, usage, novelty —
 * and they are three views of the SAME twenty rows, so splitting them makes a
 * reader carry a gene id between tabs to answer one question.
 *
 * The list defaults to switches — usage changed, gene total did not — because
 * that is the finding that exists only because the reads are long. Everything
 * else in this app can already show a gene going up.
 */
export default function Isoforms(
  { bundle, contrastId, onGene }:
  { bundle: Bundle; contrastId: string; onGene: (g: string) => void },
) {
  const [switchOnly, setSwitchOnly] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const layer = bundle.meta.transcript_layer
  const genes = useMemo(
    () => isoformGenes(bundle, contrastId, { switchOnly }),
    [bundle, contrastId, switchOnly])
  const allGenes = useMemo(
    () => isoformGenes(bundle, contrastId, { switchOnly: false }),
    [bundle, contrastId])
  const cats = useMemo(() => categoryTally(bundle.transcripts ?? []), [bundle.transcripts])

  const contrast = bundle.meta.contrasts.find(c => c.id === contrastId)
  const num = contrast?.numerator ?? 'test'
  const den = contrast?.denominator ?? 'reference'

  if (!bundle.transcripts || !bundle.dtuByContrast?.[contrastId]) {
    return (
      <div className="card p-6">
        <h2 className="text-base font-semibold">Isoforms</h2>
        <p className="mt-2 text-sm text-slate-500">
          This bundle carries an isoform layer, but no usage table for{' '}
          <b>{contrast?.label ?? contrastId}</b>. Usage is a two-group test, so an
          interaction coefficient has none — pick a pairwise comparison.
        </p>
      </div>
    )
  }

  const novel = bundle.transcripts.filter(t => t.novel).length

  return (
    <div className="space-y-4">
      {/* ── what this layer is, in one line ───────────────────────────── */}
      <div className="card p-5">
        <h2 className="text-base font-semibold">Isoforms</h2>
        <p className="mt-1 text-sm text-slate-500">
          {bundle.transcripts.length.toLocaleString()} transcripts ·{' '}
          {novel.toLocaleString()} novel ({pctOf(novel, bundle.transcripts.length)}) ·{' '}
          usage tested with <b>{layer?.dtu_engine ?? 'the pipeline’s engine'}</b>
          {layer?.dtu_filter ? <> keeping {layer.dtu_filter}</> : null}.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          <b>{allGenes.length.toLocaleString()}</b> gene{allGenes.length === 1 ? '' : 's'} have an
          isoform whose share of the gene changed (FDR&nbsp;&lt;&nbsp;0.05), of which{' '}
          <b>{allGenes.filter(g => g.genePadj != null && g.genePadj >= 0.05).length.toLocaleString()}</b>{' '}
          show no change in the gene’s total — the switches.
        </p>
        {cats.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">
              {VOCAB[layer?.category_vocabulary ?? ''] ?? 'Structural categories'}
            </div>
            <div className="flex flex-wrap gap-1.5">
            {cats.map(c => (
              <span key={c.name}
                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {prettyCategory(c.name)} <b className="tabular-nums">{c.n.toLocaleString()}</b>
              </span>
            ))}
            </div>
          </div>
        )}
        {layer?.dte_fit && (
          <p className="mt-3 text-xs text-slate-400">
            Transcript-level DESeq2 was fitted {layer.dte_fit}, so its numbers do not
            reconcile arithmetically with the gene table on the other tabs.
          </p>
        )}
      </div>

      {/* ── the list ───────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {switchOnly ? 'Isoform switches' : 'All genes with changed usage'}
          </h3>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={switchOnly}
              onChange={e => { setSwitchOnly(e.target.checked); setOpen(null) }} />
            Only where the gene’s total did not change
          </label>
        </div>

        {genes.length === 0 ? (
          <p className="text-sm text-slate-500">
            {switchOnly
              ? 'No gene here changed its isoform mix without also changing its total. Untick the box to see every gene with changed usage.'
              : 'No isoform changed its share of its gene at FDR < 0.05 in this comparison.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-3 font-medium">Gene</th>
                  <th className="py-2 pr-3 font-medium">Isoforms</th>
                  <th className="py-2 pr-3 text-right font-medium">Usage FDR</th>
                  <th className="py-2 pr-3 text-right font-medium">Gene log2FC</th>
                  <th className="py-2 pr-3 text-right font-medium">Gene FDR</th>
                  <th className="py-2 font-medium">Moved</th>
                </tr>
              </thead>
              <tbody>
                {genes.slice(0, 200).map(g => (
                  <tr key={g.gene_id}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    onClick={() => setOpen(open === g.gene_id ? null : g.gene_id)}>
                    <td className="py-2 pr-3 font-medium">{g.gene_name}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-500">{g.nTranscripts}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{sci(g.dtuPadj)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fc(g.geneLog2FC)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{sci(g.genePadj)}</td>
                    <td className="py-2 text-xs text-slate-500">
                      {g.moved.slice(0, 2).map(m => m.tx.display_name).join(', ')}
                      {g.moved.length > 2 ? ` +${g.moved.length - 2}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {genes.length > 200 && (
              <p className="mt-2 text-xs text-slate-400">
                Showing the 200 with the smallest usage FDR of {genes.length.toLocaleString()}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── one gene, opened ───────────────────────────────────────────── */}
      {open && (
        <GeneDetail bundle={bundle} contrastId={contrastId} geneId={open}
          num={num} den={den} onGene={onGene} />
      )}
    </div>
  )
}

/**
 * One gene's isoforms, with the mix drawn to scale.
 *
 * The bar is the thing worth drawing: two stacked bars of EQUAL height, one per
 * group, each segment an isoform's share. Equal height is the point — it makes
 * a change of composition visible without a change of size, which is exactly
 * what a switch is and exactly what a fold-change column cannot show.
 */
function GeneDetail(
  { bundle, contrastId, geneId, num, den, onGene }: {
    bundle: Bundle; contrastId: string; geneId: string
    num: string; den: string; onGene: (g: string) => void
  },
) {
  const rows = useMemo(
    () => isoformsOfGene(bundle, contrastId, geneId), [bundle, contrastId, geneId])
  const name = rows[0]?.tx.gene_name || geneId
  // Shares come from the engine that ran the test, never recomputed here — a
  // proportion this app derived could disagree with the p-value beside it.
  const shown = rows.filter(r => r.row)
  const palette = ['#0b6b62', '#4ea3c0', '#96601a', '#8d5fa8', '#5b8c3e', '#a33a5c', '#6b7280']
  // One colour per tested isoform, assigned once so the stacked bar and the
  // table's dots cannot drift apart.
  const colorOf = new Map(shown.map((r, i) => [r.tx.transcript_id, palette[i % palette.length]]))

  const bar = (which: 'mean_usage_den' | 'mean_usage_num') => {
    const vals = shown.map(r => Math.max(0, r.row?.[which] ?? 0))
    const total = vals.reduce((a, b) => a + b, 0)
    return (
      <div className="flex h-7 w-full overflow-hidden rounded border border-slate-200 dark:border-slate-700">
        {total > 0 ? vals.map((v, i) => (
          <div key={i} style={{ width: `${100 * v / total}%`, background: palette[i % palette.length] }}
            title={`${shown[i].tx.display_name} · ${pct(v)}`} />
        )) : <div className="w-full bg-slate-100 dark:bg-slate-800" />}
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <button className="text-xs text-sky-600 underline dark:text-sky-400"
          onClick={() => onGene(name)}>
          Open {name} in Gene expression →
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">
          No isoform of this gene survived the usage test’s count filter.
        </p>
      ) : (
        <>
          <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <div className="self-center text-xs text-slate-500">{den}</div>{bar('mean_usage_den')}
            <div className="self-center text-xs text-slate-500">{num}</div>{bar('mean_usage_num')}
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Both bars are the same height: they show the gene’s isoform mix, not its level.
          </p>
        </>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="py-2 pr-3 font-medium">Isoform</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 text-right font-medium">{den} share</th>
              <th className="py-2 pr-3 text-right font-medium">{num} share</th>
              <th className="py-2 pr-3 text-right font-medium">Usage FDR</th>
              <th className="py-2 pr-3 text-right font-medium">Level log2FC</th>
              <th className="py-2 font-medium">Accession</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tx, row, dte }) => (
              <tr key={tx.transcript_id}
                className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="py-2 pr-3 font-medium">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: colorOf.get(tx.transcript_id) ?? 'transparent' }} />
                  {tx.display_name}
                  {tx.novel && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      novel
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-500">
                  {tx.structural_category ? prettyCategory(tx.structural_category) : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{pct(row?.mean_usage_den)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{pct(row?.mean_usage_num)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{sci(row?.padj)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fc(dte?.log2FoldChange)}</td>
                <td className="py-2 font-mono text-[11px] text-slate-400">{tx.transcript_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        <b>Share</b> is this isoform’s fraction of its gene, as measured by the usage test.
        <b className="ml-2">Level log2FC</b> is transcript-level DESeq2 — how much of it there is,
        which is a different question. A row can move on one and not the other.
      </p>
    </div>
  )
}
