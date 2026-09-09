import type { Bundle } from '../types'

const n0 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString()
const p1 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`

/**
 * What the long-read libraries actually contain.
 *
 * REPORTS, NEVER GATES. Nothing here filters a sample, hides a result, greys a
 * row or warns. A heart library that is 90% mitochondrial may be a degraded
 * prep or may simply be heart — the most mitochondria-rich tissue there is —
 * and this app cannot tell those apart. What it can do is put the number in
 * front of the reader beside the results it bears on, and let them decide.
 *
 * The bar is drawn because the table alone buries the finding: "84.7%
 * mitochondrial" in a cell reads as one number among six, while a bar whose
 * usable segment is a sliver reads immediately.
 */
export default function LongReadQC({ bundle }: { bundle: Bundle }) {
  const qc = bundle.meta.longread_qc
  if (!qc || qc.length === 0) return null

  const cond = new Map(bundle.samples.map(s => [s.sample, s.condition]))
  const anyPolya = qc.some(q => q.median_polya != null)
  const anyLen = qc.some(q => q.median_read_length != null)

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold">Library composition</h3>
      <p className="mt-1 text-xs text-slate-500">
        Measured from the alignments. Shown so you can weigh it — nothing in this app
        filters or flags a sample on these numbers.
      </p>

      <div className="mt-4 space-y-1.5">
        {qc.map(q => {
          const mt = q.mt_pct ?? 0
          const un = q.unmapped_pct ?? 0
          // Composition as a share of ALL reads: mapped-mitochondrial, mapped-
          // elsewhere, unmapped. mt_pct is a share of mapped reads, so it is
          // rescaled here rather than laid next to unmapped as if they summed.
          const mapped = Math.max(0, 100 - un)
          const mtAll = mapped * mt / 100
          const rest = Math.max(0, mapped - mtAll)
          return (
            <div key={q.sample} className="grid items-center gap-3"
              style={{ gridTemplateColumns: '7rem 1fr 4rem' }}>
              <div className="truncate text-xs text-slate-500">
                {q.sample}<span className="ml-1 text-slate-400">{cond.get(q.sample) ?? ''}</span>
              </div>
              <div className="flex h-5 overflow-hidden rounded border border-slate-200 dark:border-slate-700">
                <div style={{ width: `${mtAll}%`, background: '#a33a5c' }} title={`mitochondrial ${p1(mt)} of mapped`} />
                <div style={{ width: `${rest}%`, background: '#0b6b62' }} title="mapped, not mitochondrial" />
                <div style={{ width: `${un}%`, background: '#cbd5e1' }} title={`unmapped ${p1(un)}`} />
              </div>
              <div className="text-right text-xs tabular-nums text-slate-500">{p1(mt)} MT</div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: '#a33a5c' }} />mitochondrial</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: '#0b6b62' }} />mapped elsewhere</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: '#cbd5e1' }} />unmapped</span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500 dark:border-slate-700">
              <th className="py-1.5 pr-3 font-medium">Sample</th>
              <th className="py-1.5 pr-3 text-right font-medium">Reads</th>
              <th className="py-1.5 pr-3 text-right font-medium">Unmapped</th>
              <th className="py-1.5 pr-3 text-right font-medium">MT</th>
              <th className="py-1.5 pr-3 text-right font-medium">rRNA</th>
              {anyLen && <th className="py-1.5 pr-3 text-right font-medium">Median length</th>}
              {anyPolya && <th className="py-1.5 pr-3 text-right font-medium">Median poly(A)</th>}
              <th className="py-1.5 text-right font-medium">Transcripts</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {qc.map(q => (
              <tr key={q.sample} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="py-1.5 pr-3 font-medium">{q.sample}</td>
                <td className="py-1.5 pr-3 text-right">{n0(q.total_reads)}</td>
                <td className="py-1.5 pr-3 text-right">{p1(q.unmapped_pct)}</td>
                <td className="py-1.5 pr-3 text-right">{p1(q.mt_pct)}</td>
                <td className="py-1.5 pr-3 text-right">{p1(q.rrna_pct)}</td>
                {anyLen && <td className="py-1.5 pr-3 text-right">{n0(q.median_read_length)} nt</td>}
                {anyPolya && <td className="py-1.5 pr-3 text-right">{n0(q.median_polya)} nt</td>}
                <td className="py-1.5 text-right">{n0(q.transcripts_detected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
