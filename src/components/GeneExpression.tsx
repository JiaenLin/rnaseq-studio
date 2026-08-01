import { useEffect, useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import { conditionColors, SIG_COLORS } from '../lib/palette'
import { combinedScore, mean, welchP, zscore } from '../lib/stats'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  selectedGene: string | null
  onSelectGene: (gene: string) => void
}

const MAX_HEATMAP = 120
// Faceted box plots are one Plotly figure with independent axes; beyond this many
// panels they stop being readable long before they get slow.
const MAX_FACETS = 24

// Single gene OR a gene list, in one tab. One gene → detailed box plot with group
// means + DEG panel. Many genes → expression heatmap + a per-gene DEG-statistics
// bar plot + a per-gene DEG table.
export default function GeneExpression({ bundle, contrast, selectedGene, onSelectGene }: Props) {
  const { counts, meta } = bundle
  const S = counts.samples.length
  const [text, setText] = useState('')
  const [log2, setLog2] = useState(true)
  const [focused, setFocused] = useState(false)
  // Suppresses the dropdown right after a pick, so a fully-typed gene doesn't keep
  // re-opening its own suggestion. Cleared on the next keystroke.
  const [suppress, setSuppress] = useState(false)
  // For a gene list: one aggregate score, or every gene side by side.
  const [listView, setListView] = useState<'module' | 'genes'>('module')
  const colors = conditionColors(meta.conditions)

  // External pick (from Volcano/DEG table/Enrichment) → load that single gene.
  useEffect(() => { if (selectedGene) setText(selectedGene) }, [selectedGene])

  const sampleCond = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of bundle.samples) m[s.sample] = s.condition
    return m
  }, [bundle.samples])

  const ordered = useMemo(() => {
    const colByName = new Map(counts.samples.map((s, j) => [s, j] as const))
    return [...counts.samples]
      .sort((a, b) => (meta.conditions.indexOf(sampleCond[a] ?? '') - meta.conditions.indexOf(sampleCond[b] ?? '')) || a.localeCompare(b))
      .map(s => ({ sample: s, col: colByName.get(s)!, cond: sampleCond[s] ?? '?' }))
  }, [counts.samples, sampleCond, meta.conditions])

  const degMap = useMemo(() => {
    const m = new Map<string, DEGRow>()
    for (const r of bundle.degByContrast[contrast.id] || []) {
      m.set(r.gene_id.toUpperCase(), r)
      if (r.gene_name) m.set(r.gene_name.toUpperCase(), r)
    }
    return m
  }, [bundle.degByContrast, contrast.id])

  // Autocomplete on the last token being typed.
  const parts = text.split(',')
  const lastTok = (parts[parts.length - 1] ?? '').trim()
  const suggestions = useMemo(() => {
    const q = lastTok.toUpperCase()
    if (q.length < 1) return []
    let exact: string | null = null
    const pref: { label: string; len: number }[] = []
    for (let i = 0; i < counts.geneNames.length; i++) {
      const nm = counts.geneNames[i], id = counts.geneIds[i]
      const NM = nm ? nm.toUpperCase() : '', ID = id.toUpperCase()
      const label = nm || id
      // An exact hit always ranks first (SOX2 before SOX21); prefix hits follow,
      // shortest name first so the closest completion sits nearest the top.
      if (NM === q || ID === q) { exact = label; continue }
      if (NM.startsWith(q)) pref.push({ label, len: NM.length })
      else if (ID.startsWith(q)) pref.push({ label, len: ID.length })
    }
    pref.sort((a, b) => a.len - b.len || a.label.localeCompare(b.label))
    const out = exact ? [exact, ...pref.map(p => p.label)] : pref.map(p => p.label)
    return out.slice(0, 10)
  }, [lastTok, counts])

  const pickSuggestion = (g: string) => {
    const p = text.split(',')
    p[p.length - 1] = (p.length > 1 ? ' ' : '') + g
    setText(p.join(',').replace(/^\s+/, ''))
    setSuppress(true)
  }

  const tokens = useMemo(
    () => Array.from(new Set(text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean))),
    [text])

  const matched = useMemo(() => {
    const out: { name: string; id: string; row: number }[] = []
    const seen = new Set<number>()
    for (const t of tokens) {
      const i = counts.index.get(t.toUpperCase())
      if (i === undefined || seen.has(i)) continue
      seen.add(i)
      out.push({ name: counts.geneNames[i] || counts.geneIds[i], id: counts.geneIds[i], row: i })
    }
    out.sort((a, b) =>
      (degMap.get(b.id.toUpperCase())?.log2FoldChange ?? 0) - (degMap.get(a.id.toUpperCase())?.log2FoldChange ?? 0))
    return out
  }, [tokens, counts, degMap])

  const unmatched = tokens.filter(t => counts.index.get(t.toUpperCase()) === undefined)
  const geneVals = (row: number) => Array.from(counts.values.subarray(row * S, row * S + S))

  const input = (
    <div className="relative mb-3 flex flex-wrap items-center gap-2">
      <input
        className="input w-96 max-w-full"
        placeholder="Gene, or a list — e.g.  TP53   or   TP53, MYC, IL6, STAT1"
        value={text}
        onChange={e => { setText(e.target.value); setSuppress(false) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={e => {
          if (e.key === 'Enter' && suggestions[0]) { e.preventDefault(); pickSuggestion(suggestions[0]) }
          else if (e.key === 'Escape') setFocused(false)
        }}
      />
      <label className="flex items-center gap-1.5 text-sm text-slate-500">
        <input type="checkbox" checked={log2} onChange={e => setLog2(e.target.checked)} /> log2 scale
      </label>
      <button className="btn" onClick={() => setText('TP53, MYC, IL6, STAT1, CDKN1A, BAX')}>Load list</button>
      <button className="btn" onClick={() => setText('')}>Clear</button>
      {focused && !suppress && suggestions.length > 0 && (
        <ul className="absolute left-0 top-11 z-10 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {suggestions.map(s => (
            <li key={s}>
              <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-indigo-50 dark:hover:bg-slate-700"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pickSuggestion(s)}>{s}</button>
            </li>
          ))}
        </ul>
      )}
      {tokens.length > 0 && (
        <span className="ml-1 text-sm text-slate-400">
          {matched.length}/{tokens.length} found{unmatched.length ? ` · missing: ${unmatched.slice(0, 8).join(', ')}` : ''}
        </span>
      )}
    </div>
  )

  // ── single gene ────────────────────────────────────────────────────────────
  if (matched.length === 1) {
    const g = matched[0]
    const vals = geneVals(g.row)
    const byCond: Record<string, number[]> = {}
    ordered.forEach(o => { (byCond[o.cond] ||= []).push(vals[o.col]) })
    const order = meta.conditions.filter(c => byCond[c]?.length)
    const traces = order.map(c => ({
      type: 'box', name: c, y: byCond[c].map(v => (log2 ? Math.log2(v + 1) : v)),
      boxpoints: 'all', jitter: 0.5, pointpos: 0, boxmean: true,
      marker: { color: colors[c], size: 7 }, line: { color: colors[c] }, fillcolor: colors[c] + '22',
    }))
    const d = degMap.get(g.id.toUpperCase())

    return (
      <div>
        {input}
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card p-4">
            <Plot data={traces} downloadName={`expr_${g.name}`} layout={{
              margin: { t: 10, r: 10, b: 40, l: 56 }, showlegend: false,
              yaxis: { title: log2 ? 'log2(normalized + 1)' : 'normalized counts', zeroline: false },
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
            }} />
            <p className="mt-1 text-center text-xs text-slate-400">Dashed line = group mean.</p>
          </div>

          <div className="space-y-4">
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{g.name}</h3>
              <dl className="space-y-2 text-sm">
                <Row label="log2 fold change" value={d?.log2FoldChange?.toFixed(3)} hint={`${contrast.numerator} vs ${contrast.denominator}`} />
                <Row label="adj. p-value" value={fmtP(d?.padj)} />
                <Row label="p-value" value={fmtP(d?.pvalue)} />
                <Row label="base mean" value={d?.baseMean?.toFixed(1)} />
                <div className="pt-1">{sig(d, contrast)}</div>
              </dl>
            </div>
            <div className="card p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mean expression per group</h4>
              <table className="w-full text-sm">
                <tbody>
                  {order.map(c => (
                    <tr key={c} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
                      <td className="py-1.5"><span className="pill" style={{ background: colors[c] + '22', color: colors[c] }}>{c}</span></td>
                      <td className="py-1.5 text-right text-slate-400">n={byCond[c].length}</td>
                      <td className="py-1.5 text-right font-mono font-medium">{mean(byCond[c]).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-slate-400">mean normalized counts</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── empty / list ───────────────────────────────────────────────────────────
  if (matched.length === 0) {
    return <div>{input}<div className="card p-16 text-center text-sm text-slate-400">Enter a gene, or a comma-separated list of genes.</div></div>
  }

  // module / signature score over ALL matched genes (mean of per-gene z-scores)
  const zAll = matched.map(g => zscore(geneVals(g.row).map(v => Math.log2(v + 1))))
  const moduleByCol = new Array(S).fill(0)
  if (zAll.length) for (let j = 0; j < S; j++) { let s = 0; for (const z of zAll) s += z[j]; moduleByCol[j] = s / zAll.length }
  const moduleByCond: Record<string, number[]> = {}
  ordered.forEach(o => { (moduleByCond[o.cond] ||= []).push(moduleByCol[o.col]) })
  const denScores = moduleByCond[contrast.denominator] || []
  const numScores = moduleByCond[contrast.numerator] || []
  const moduleStat = denScores.length >= 2 && numScores.length >= 2 ? welchP(denScores, numScores) : null
  const moduleTraces = meta.conditions.filter(c => moduleByCond[c]?.length).map(c => ({
    type: 'box', name: c, y: moduleByCond[c], boxpoints: 'all', jitter: 0.5, pointpos: 0, boxmean: true,
    marker: { color: colors[c], size: 7 }, line: { color: colors[c] }, fillcolor: colors[c] + '22',
  }))

  // ── per-gene small multiples ────────────────────────────────────────────────
  // One figure with `grid.pattern: 'independent'` rather than N <Plot> instances:
  // each gene keeps its own y-scale (expression spans orders of magnitude between
  // genes, so a shared axis would flatten the low-expressed ones) at the cost of
  // a single Plotly instance.
  const facetGenes = matched.slice(0, MAX_FACETS)
  const facetCols = Math.min(facetGenes.length, facetGenes.length <= 3 ? facetGenes.length : facetGenes.length <= 8 ? 4 : 5)
  const facetRows = Math.ceil(facetGenes.length / Math.max(facetCols, 1))
  const condOrder = meta.conditions.filter(c => ordered.some(o => o.cond === c))

  // Plotly names the first axis "x"/"xaxis" and only later ones "x2"/"xaxis2";
  // "xaxis1" is not a recognized layout key and would be silently dropped.
  const ax = (gi: number) => (gi === 0 ? '' : String(gi + 1))

  const facetTraces = facetGenes.flatMap((g, gi) => {
    const vals = geneVals(g.row)
    const byC: Record<string, number[]> = {}
    ordered.forEach(o => { (byC[o.cond] ||= []).push(vals[o.col]) })
    return condOrder.filter(c => byC[c]?.length).map(c => ({
      type: 'box', name: c, legendgroup: c,
      showlegend: gi === 0,                       // one shared legend, not one per panel
      y: byC[c].map(v => (log2 ? Math.log2(v + 1) : v)),
      xaxis: `x${ax(gi)}`, yaxis: `y${ax(gi)}`,
      boxpoints: 'all', jitter: 0.5, pointpos: 0, boxmean: true,
      marker: { color: colors[c], size: 5 }, line: { color: colors[c], width: 1.2 },
      fillcolor: colors[c] + '22',
      hovertemplate: `${g.name} · ${c}<br>%{y:.2f}<extra></extra>`,
    }))
  })

  // Significance stars keep each panel title informative without a second line.
  const stars = (p: number | null | undefined) =>
    p == null ? '' : p < 0.001 ? ' ***' : p < 0.01 ? ' **' : p < 0.05 ? ' *' : ''

  const facetLayout: Record<string, unknown> = {
    grid: { rows: facetRows, columns: facetCols, pattern: 'independent', ygap: 0.42, xgap: 0.28 },
    margin: { t: 26, r: 8, b: 8, l: 44 },
    height: Math.max(220, facetRows * 168 + 60),
    showlegend: true,
    legend: { orientation: 'h', y: 1.04, x: 0.5, xanchor: 'center', font: { size: 11 } },
    boxmode: 'group',
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, sans-serif' },
    annotations: facetGenes.map((g, gi) => ({
      text: `${g.name}${stars(degMap.get(g.id.toUpperCase())?.padj)}`,
      xref: `x${ax(gi)} domain`, yref: `y${ax(gi)} domain`,
      x: 0.5, y: 1.14, xanchor: 'center', yanchor: 'bottom',
      showarrow: false, font: { size: 11.5, weight: 600 },
    })),
  }
  facetGenes.forEach((_, gi) => {
    // Condition names live in the shared legend, so panel ticks stay off.
    facetLayout[`xaxis${ax(gi)}`] = { showticklabels: false, showgrid: false, zeroline: false }
    facetLayout[`yaxis${ax(gi)}`] = { tickfont: { size: 9 }, automargin: true, zeroline: false }
  })

  const shown = matched.slice(0, MAX_HEATMAP)
  const zByGene = shown.map(g => zscore(geneVals(g.row).map(v => Math.log2(v + 1))))
  const heatTrace = [{
    type: 'heatmap',
    z: shown.map((_, gi) => ordered.map(o => zByGene[gi][o.col])),
    x: ordered.map(o => o.sample), y: shown.map(g => g.name),
    colorscale: 'RdBu', reversescale: true, zmid: 0, zmin: -2.5, zmax: 2.5,
    colorbar: { title: 'z', thickness: 12, len: 0.6 },
    hovertemplate: '%{y} · %{x}<br>z %{z:.2f}<extra></extra>',
  }]

  // per-gene DEG bar (log2FC), ascending so most up-regulated ends on top
  const barGenes = [...matched].sort((a, b) =>
    (degMap.get(a.id.toUpperCase())?.log2FoldChange ?? 0) - (degMap.get(b.id.toUpperCase())?.log2FoldChange ?? 0))
  const thr = contrast.padj_threshold ?? 0.05
  const barTrace = [{
    type: 'bar', orientation: 'h',
    x: barGenes.map(g => degMap.get(g.id.toUpperCase())?.log2FoldChange ?? 0),
    y: barGenes.map(g => g.name),
    customdata: barGenes.map(g => g.name),
    text: barGenes.map(g => `padj ${fmtP(degMap.get(g.id.toUpperCase())?.padj ?? null)}`),
    hovertemplate: '%{y}<br>log2FC %{x:.2f}<br>%{text}<extra></extra>',
    marker: {
      color: barGenes.map(g => {
        const d = degMap.get(g.id.toUpperCase())
        if (!d || d.padj == null || d.padj >= thr) return SIG_COLORS.ns
        return d.log2FoldChange > 0 ? SIG_COLORS.up : SIG_COLORS.down
      }),
    },
  }]

  return (
    <div>
      {input}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {listView === 'module'
                  ? `Module score (mean z of ${matched.length} genes)`
                  : `Per-gene expression (${facetGenes.length} of ${matched.length} genes)`}
              </h3>
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {([['module', 'Module score'], ['genes', 'Per gene']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setListView(v)}
                    className={`pressable rounded-md px-2.5 py-1 text-xs font-medium ${
                      listView === v
                        ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                  >{label}</button>
                ))}
              </div>
            </div>
            {listView === 'module' && moduleStat && (
              <span className="text-sm text-slate-500">
                {contrast.numerator} vs {contrast.denominator}: Δ {moduleStat.diff.toFixed(2)} · t {moduleStat.t.toFixed(2)} · p {fmtP(moduleStat.p)}
              </span>
            )}
          </div>

          {listView === 'module' ? (
            <>
              <Plot data={moduleTraces} downloadName={`module_score_${contrast.id}`} layout={{
                margin: { t: 8, r: 10, b: 36, l: 52 }, showlegend: false,
                yaxis: { title: 'module score', zeroline: true },
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
              }} style={{ height: 300 }} />
              <p className="mt-1 text-xs text-slate-400">
                Module score = for each sample, the mean across these genes of the gene's z-score (log2 normalized expression, standardized across samples). Dashed line = group mean.
              </p>
            </>
          ) : (
            <>
              <Plot data={facetTraces} downloadName={`per_gene_box_${contrast.id}`} layout={facetLayout} />
              <p className="mt-1 text-xs text-slate-400">
                One panel per gene, each on its <b>own y-scale</b> ({log2 ? 'log2 normalized + 1' : 'normalized counts'}) —
                expression differs by orders of magnitude between genes, so a shared axis would flatten the low-expressed ones.
                Dashed line = group mean. Stars = adjusted p-value (* &lt; 0.05, ** &lt; 0.01, *** &lt; 0.001).
                {matched.length > MAX_FACETS && ` Showing the first ${MAX_FACETS} of ${matched.length} genes.`}
              </p>
            </>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Per-gene expression — z-scored across samples{matched.length > MAX_HEATMAP ? ` (top ${MAX_HEATMAP})` : ''}
          </h3>
          <Plot data={heatTrace} downloadName={`heatmap_${contrast.id}`} layout={{
            margin: { t: 8, r: 10, b: 70, l: 90 }, height: Math.max(220, shown.length * 16 + 120),
            xaxis: { tickangle: -45, automargin: true }, yaxis: { automargin: true, tickfont: { size: 10 } },
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
          }} />
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Per-gene DEG statistics — log2FC ({contrast.numerator} vs {contrast.denominator})
          </h3>
          <Plot
            data={barTrace}
            downloadName={`per_gene_log2FC_${contrast.id}`}
            layout={{
              margin: { t: 8, r: 10, b: 40, l: 90 }, height: Math.max(200, barGenes.length * 22 + 80),
              xaxis: { title: 'log2 fold change', zeroline: true },
              yaxis: { automargin: true, tickfont: { size: 11 } },
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
            }}
            onPointClick={p => p?.customdata && onSelectGene(p.customdata)}
          />
          <p className="mt-1 text-center text-xs text-slate-400">
            Grey = not significant (padj ≥ {thr}). Click a bar to open that gene.
          </p>
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Per-gene DEG table</h3>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                <tr><th className="px-3 py-2">Gene</th><th className="px-3 py-2 text-right">log2FC</th>
                  <th className="px-3 py-2 text-right">combined</th>
                  <th className="px-3 py-2 text-right">padj</th><th className="px-3 py-2">significance</th></tr>
              </thead>
              <tbody>
                {matched.map(g => {
                  const d = degMap.get(g.id.toUpperCase())
                  const comb = d ? combinedScore(d.log2FoldChange, d.pvalue) : null
                  return (
                    <tr key={g.id} className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
                      onClick={() => onSelectGene(g.name)}>
                      <td className="px-3 py-1.5 font-medium">{g.name}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>{d && d.log2FoldChange != null ? d.log2FoldChange.toFixed(2) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{comb != null ? comb.toFixed(2) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtP(d?.padj ?? null)}</td>
                      <td className="px-3 py-1.5">{sig(d, contrast, true)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400"><b>Combined score</b> = −log10(p-value) × log2FC.</p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}{hint && <span className="ml-1 text-xs text-slate-400">({hint})</span>}</dt>
      <dd className="font-mono font-medium">{value ?? '—'}</dd>
    </div>
  )
}

function sig(d: DEGRow | undefined, c: Contrast, compact = false) {
  const thr = c.padj_threshold ?? 0.05
  if (!d || d.padj == null) return <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">n.s.</span>
  if (d.padj >= thr) return <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">not significant</span>
  const up = d.log2FoldChange > 0
  const who = up ? c.numerator : c.denominator
  return <span className={`pill ${up ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{compact ? `↑ ${who}` : `▲ higher in ${who}`}</span>
}

function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
