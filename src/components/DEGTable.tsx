import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import { combinedScore } from '../lib/stats'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

type SortKey = 'gene_name' | 'baseMean' | 'log2FoldChange' | 'combined' | 'pvalue' | 'padj'
const MAX_ROWS = 500

const cellVal = (r: DEGRow, k: SortKey): number | string | null =>
  k === 'combined' ? combinedScore(r.log2FoldChange, r.pvalue) : (r as any)[k]

export default function DEGTable({ bundle, contrast, onSelectGene }: Props) {
  const all = bundle.degByContrast[contrast.id] || []
  const padjThr = contrast.padj_threshold ?? 0.05
  const [q, setQ] = useState('')
  const [sigOnly, setSigOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('padj')
  const [asc, setAsc] = useState(true)

  const filtered = useMemo(() => {
    const query = q.trim().toUpperCase()
    let rows = all
    if (query) rows = rows.filter(r =>
      (r.gene_name || '').toUpperCase().includes(query) || r.gene_id.toUpperCase().includes(query))
    if (sigOnly) rows = rows.filter(r => r.padj != null && r.padj < padjThr)
    const dir = asc ? 1 : -1
    const sorted = [...rows].sort((a, b) => {
      const av = cellVal(a, sort), bv = cellVal(b, sort)
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
    return sorted
  }, [all, q, sigOnly, sort, asc, padjThr])

  const clickSort = (k: SortKey) => {
    if (k === sort) setAsc(!asc)
    else { setSort(k); setAsc(k === 'gene_name' || k === 'pvalue' || k === 'padj') }
  }

  const download = () => {
    const header = ['gene_id', 'gene_name', 'baseMean', 'log2FoldChange', 'lfcSE', 'pvalue', 'padj', 'combinedScore']
    const lines = [header.join(',')]
    for (const r of filtered) lines.push(header.map(h =>
      h === 'combinedScore' ? (combinedScore(r.log2FoldChange, r.pvalue) ?? '') : ((r as any)[h] ?? '')).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `deg_${contrast.id}${sigOnly ? '_sig' : ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <input className="input w-56" placeholder="Filter genes…" value={q} onChange={e => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-slate-500">
          <input type="checkbox" checked={sigOnly} onChange={e => setSigOnly(e.target.checked)} />
          significant only (padj &lt; {padjThr})
        </label>
        <span className="text-slate-400">{filtered.length.toLocaleString()} genes</span>
        <button className="btn ml-auto" onClick={download}>⭳ Download CSV</button>
      </div>

      <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
            <tr>
              <Th label="Gene" k="gene_name" sort={sort} asc={asc} onClick={clickSort} />
              <Th label="Base mean" k="baseMean" sort={sort} asc={asc} onClick={clickSort} num />
              <Th label="log2FC" k="log2FoldChange" sort={sort} asc={asc} onClick={clickSort} num />
              <Th label="Combined" k="combined" sort={sort} asc={asc} onClick={clickSort} num />
              <Th label="p-value" k="pvalue" sort={sort} asc={asc} onClick={clickSort} num />
              <Th label="padj" k="padj" sort={sort} asc={asc} onClick={clickSort} num />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={r.gene_id + i}
                className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                onClick={() => onSelectGene(r.gene_name || r.gene_id)}>
                <td className="px-3 py-1.5 font-medium">{r.gene_name || r.gene_id}
                  {r.gene_name && r.gene_name !== r.gene_id &&
                    <span className="ml-1.5 font-mono text-xs text-slate-400">{r.gene_id}</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.baseMean, 1)}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${r.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                  {fmt(r.log2FoldChange, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(combinedScore(r.log2FoldChange, r.pvalue), 2)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-500">{fmtP(r.pvalue)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtP(r.padj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > MAX_ROWS &&
        <p className="mt-2 text-center text-xs text-slate-400">
          Showing top {MAX_ROWS} of {filtered.length.toLocaleString()} — refine the filter or download the full CSV.
        </p>}
      <p className="mt-2 text-xs text-slate-400">
        <b>Combined score</b> = −log10(p-value) × log2FC — a signed ranking metric (large positive = strongly
        up-regulated &amp; significant; large negative = strongly down-regulated). Click any column header to sort;
        click again to reverse.
      </p>
    </div>
  )
}

function Th({ label, k, sort, asc, onClick, num }: {
  label: string; k: SortKey; sort: SortKey; asc: boolean; onClick: (k: SortKey) => void; num?: boolean
}) {
  return (
    <th className={`cursor-pointer select-none px-3 py-2 ${num ? 'text-right' : 'text-left'}`} onClick={() => onClick(k)}>
      {label}{sort === k ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

const fmt = (v: number | null, d: number) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d))
function fmtP(p: number | null): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
