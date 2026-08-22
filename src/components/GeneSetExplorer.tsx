import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import type { GroupSel } from '../lib/design'
import { displayOrder, orderSamples } from '../lib/design'
import { conditionColors, contrastTitle } from '../lib/palette'
import { combinedScore, zscore } from '../lib/stats'
import { hyperTail, bh } from '../lib/ora'
import { computeSortedOrders, computeRankPositions, meanRankScore, rankRunningSum } from '../lib/scores'
import { reportSets, useReport } from '../lib/methods'
import type { LibraryControl } from '../lib/genesets'
import { LibraryPicker } from './GeneSetSources'
import SetPicker, { type PickedSet } from './SetPicker'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  sel: GroupSel
  /** The app's one gene-set library — see useLibrary in lib/genesets.ts. */
  library: LibraryControl
  onSelectGene: (gene: string) => void
}

/**
 * A set this tab works on, wherever it came from.
 *
 * `rows` are indices into the count matrix, which is what the module score
 * walks; `genesUpper` is what the ORA and the per-gene table join on. `id` and
 * `source` are empty for a typed set and carry MSigDB's systematic name for a
 * set taken out of the library — a Methods section cites the second and cannot
 * cite the first.
 */
interface ParsedSet {
  /**
   * Unique across every set on the page.
   *
   * The selected set used to be found by NAME, which was safe while every set
   * was a line somebody typed and is not now: "Glycolysis" is a Hallmark set, a
   * WikiPathways set and a plausible thing to type, and three sets answering to
   * one name means clicking the third row opens the first.
   */
  key: string
  name: string
  id: string
  source: string
  genesUpper: string[]
  nInput: number
  rows: number[]
}

const EXAMPLE = `Inflammation: TP53, IL6, TNF, IFNG, CXCL10, STAT1, NFKB1
Proliferation: MYC, MKI67, CCND1, EGFR, KRAS
Apoptosis: BAX, BCL2, CDKN1A, PTEN, SOD2`

// For each user-defined gene set: its per-gene DEG statistics, how many members
// are DEGs, and an over-representation (ORA) test as an activity readout — plus
// a per-sample module score for cross-condition comparison.
export default function GeneSetExplorer({ bundle, contrast, sel, library, onSelectGene }: Props) {
  const { counts, meta } = bundle
  const S = counts.samples.length
  const deg = bundle.degByContrast[contrast.id] || []
  const [text, setText] = useState('')
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(1)
  const [direction, setDirection] = useState<'both' | 'up' | 'down'>('both')
  const [selName, setSelName] = useState('')
  /**
   * Sets taken out of the library, beside the ones typed below them.
   *
   * Kept apart from `text` rather than written into it. A GO term is 500
   * symbols; pasting that into the textarea would bury the reader's own three
   * lines under a wall they cannot edit and did not write, and it would throw
   * away the systematic id — which is the thing a Methods section quotes.
   */
  const [picked, setPicked] = useState<PickedSet[]>([])
  const [scoreMethod, setScoreMethod] = useState<'runningsum' | 'meanrank' | 'meanz'>('runningsum')
  const colors = conditionColors(meta.conditions)
  const pickedIds = useMemo(() => new Set(picked.map(p => p.id)), [picked])
  const addPicked = (p: PickedSet) =>
    setPicked(ps => ps.some(x => x.id === p.id && x.source === p.source) ? ps : [...ps, p])

  const degMap = useMemo(() => {
    const m = new Map<string, DEGRow>()
    for (const r of deg) { m.set(r.gene_id.toUpperCase(), r); if (r.gene_name) m.set(r.gene_name.toUpperCase(), r) }
    return m
  }, [deg])

  const { rankMap, totalRanked } = useMemo(() => {
    const scored = deg.map(r => ({ r, c: combinedScore(r.log2FoldChange, r.pvalue) }))
      .filter(x => x.c != null).sort((a, b) => (b.c as number) - (a.c as number))
    const rm = new Map<string, number>()
    scored.forEach((s, i) => { rm.set(s.r.gene_id.toUpperCase(), i + 1); if (s.r.gene_name) rm.set(s.r.gene_name.toUpperCase(), i + 1) })
    return { rankMap: rm, totalRanked: scored.length }
  }, [deg])

  // Background = all tested genes; DEG set = thresholded genes (by name/id).
  const background = useMemo(() => {
    const bg = new Set<string>()
    for (const r of deg) bg.add((r.gene_name || r.gene_id).toUpperCase())
    return bg
  }, [deg])
  const N = background.size
  /** The same background as a list, which is what the library picker folds on. */
  const backgroundList = useMemo(
    () => deg.map(r => r.gene_name || r.gene_id), [deg])
  const degUpper = useMemo(() => {
    const s = new Set<string>()
    for (const r of deg) {
      if (r.padj == null || r.padj > padjMax) continue
      if (r.log2FoldChange == null || Math.abs(r.log2FoldChange) < lfcMin) continue
      if (direction === 'up' && r.log2FoldChange <= 0) continue
      if (direction === 'down' && r.log2FoldChange >= 0) continue
      s.add((r.gene_name || r.gene_id).toUpperCase())
    }
    return s
  }, [deg, padjMax, lfcMin, direction])
  const n = useMemo(() => { let c = 0; for (const g of degUpper) if (background.has(g)) c++; return c }, [degUpper, background])

  /** One set, from a name and a member list, whatever produced them. */
  const build = useMemo(() => (key: string, name: string, id: string, source: string, members: string[]): ParsedSet => {
    const toks = Array.from(new Set(members.map(x => x.trim().toUpperCase()).filter(Boolean)))
    const rows: number[] = []; const seen = new Set<number>()
    for (const tk of toks) {
      const i = counts.index.get(tk)
      if (i !== undefined && !seen.has(i)) { seen.add(i); rows.push(i) }
    }
    return { key, name, id, source, genesUpper: toks, nInput: toks.length, rows }
  }, [counts])

  const sets = useMemo<ParsedSet[]>(() => {
    // Library sets first — they were chosen deliberately, and a typed line is
    // the ad-hoc thing beside them.
    const out: ParsedSet[] = picked.map(p => build(`lib:${p.source}/${p.id}`, p.name, p.id, p.source, p.genes))
    for (const line of text.split('\n')) {
      const t = line.trim(); if (!t) continue
      const ci = t.indexOf(':')
      const name = ci > 0 ? t.slice(0, ci).trim() : `Set ${out.length + 1}`
      const body = ci > 0 ? t.slice(ci + 1) : t
      out.push(build(`typed:${out.length}:${name}`, name, '', 'typed here', body.split(/[\s,;]+/)))
    }
    return out.filter(s => s.nInput > 0)
  }, [text, picked, build])

  // Per-set overlap + ORA enrichment (BH across the defined sets).
  const setRows = useMemo(() => {
    const rows = sets.map(s => {
      const inBg = s.genesUpper.filter(g => background.has(g))
      const K = inBg.length
      const k = inBg.filter(g => degUpper.has(g)).length
      const p = K > 0 && n > 0 ? hyperTail(k, K, n, N) : 1
      const fold = n > 0 && K > 0 ? (k / n) / (K / N) : 0
      return { key: s.key, name: s.name, id: s.id, source: s.source, nInput: s.nInput, nScored: s.rows.length, K, k, fold, p }
    })
    const padj = bh(rows.map(r => r.p))
    return rows.map((r, i) => ({ ...r, padj: padj[i] }))
  }, [sets, background, degUpper, n, N])

  const selected = setRows.find(r => r.key === selName) || setRows[0]
  const selSet = sets.find(s => s.key === selected?.key)
  const memberStats = useMemo(() => (selSet?.genesUpper || []).map(g => {
    const d = degMap.get(g)
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: rankMap.get(g) }
  }).sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity)), [selSet, degMap, rankMap])

  // ── per-sample module score (secondary activity view) ──
  // Restricted to the groups chosen in the comparison bar, control first.
  const ordered = useMemo(
    () => orderSamples(counts.samples, bundle.samples, sel),
    [counts.samples, bundle.samples, sel])

  const nGenes = counts.geneIds.length
  // The full-genome sort is only needed for the rank-based methods AND only once
  // gene sets exist — computing it eagerly on mount froze large datasets (78k genes).
  // Tell the Methods tab which scoring method and thresholds are in play.
  const librarySources = useMemo(
    () => [...new Set(picked.map(p => p.source))].sort(), [picked])
  useReport(
    () => reportSets({
      nSets: sets.length, nLibrary: picked.length, librarySources,
      scoreMethod, padjMax, lfcMin, direction,
    }),
    [sets.length, picked.length, librarySources.join(','),
      scoreMethod, padjMax, lfcMin, direction].join('|'),
  )

  const needScores = sets.length > 0 && scoreMethod !== 'meanz'
  const orders = useMemo(() => needScores ? computeSortedOrders(counts.values, nGenes, S) : [],
    [needScores, counts, nGenes, S])
  const rankPos = useMemo(() => needScores && scoreMethod === 'meanrank' && orders.length
    ? computeRankPositions(orders, nGenes, S) : new Float32Array(0),
    [needScores, scoreMethod, orders, nGenes, S])
  const meanZ = (rows: number[]) => {
    const z = rows.map(r => zscore(Array.from(counts.values.subarray(r * S, r * S + S)).map(v => Math.log2(v + 1))))
    const m = new Array(S).fill(0)
    if (z.length) for (let j = 0; j < S; j++) { let a = 0; for (const zr of z) a += zr[j]; m[j] = a / z.length }
    return m
  }
  const scoreSet = (rows: number[]) => {
    try {
      return scoreMethod === 'runningsum' ? rankRunningSum(rows, orders, nGenes)
        : scoreMethod === 'meanrank' ? meanRankScore(rows, rankPos, nGenes, S)
          : meanZ(rows)
    } catch { return new Array(S).fill(0) }
  }
  const moduleBySet = useMemo(() => sets.map(s => ({ name: s.name, key: s.key, n: s.rows.length, moduleByCol: scoreSet(s.rows) })),
    [sets, scoreMethod, orders, rankPos, counts, S, nGenes])

  const boxTraces = useMemo(() => {
    const per: Record<string, { x: string[]; y: number[] }> = {}
    for (const s of moduleBySet) for (const o of ordered) {
      (per[o.cond] ||= { x: [], y: [] }); per[o.cond].x.push(s.name); per[o.cond].y.push(s.moduleByCol[o.col])
    }
    return displayOrder(sel).filter(c => per[c]).map(c => ({
      type: 'box', name: c, x: per[c].x, y: per[c].y, boxpoints: 'all', jitter: 0.4, pointpos: 0,
      marker: { color: colors[c], size: 6 }, line: { color: colors[c] },
    }))
  }, [moduleBySet, ordered, sel, colors])

  const thr = contrast.padj_threshold ?? 0.05

  return (
    <div className="space-y-4">
      {/* where the sets come from, then the thresholds they are read against */}
      <div className="card p-4">
        {/* The same library the Enrichment tab tests against, and the same
            control — a set scored here and a set tested there should not be
            drawn from two different places, and the reader's own pasted
            collections belong to both. */}
        <LibraryPicker library={library} background={backgroundList}
          recorded={bundle.meta.species} />

        <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
          Take a set from the library
        </label>
        <SetPicker library={library} onPick={addPicked} disabledIds={pickedIds} />
        {picked.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {picked.map(p => (
              <span key={`${p.source}/${p.id}`}
                className="pill border border-indigo-300 bg-indigo-50 p-0 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300">
                <span className="py-0.5 pl-2 pr-1" title={`${p.id} · ${p.source} · ${p.genes.length} genes`}>
                  {p.name}
                  <span className="ml-1.5 opacity-70">{p.genes.length}</span>
                </span>
                <button className="pressable rounded-r-full py-0.5 pl-1 pr-2 opacity-70 hover:opacity-100"
                  aria-label={`Remove ${p.name}`} title={`Remove ${p.name}`}
                  onClick={() => setPicked(ps => ps.filter(x => x.id !== p.id || x.source !== p.source))}
                >&times;</button>
              </span>
            ))}
            <button className="btn py-0.5 text-xs" onClick={() => setPicked([])}>Remove all</button>
          </div>
        )}

        <label className="mb-1 mt-4 block text-sm font-medium text-slate-600 dark:text-slate-300">
          &hellip;or define your own — one per line, <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Name: GENE1, GENE2, …</code>
        </label>
        <textarea className="input h-24 w-full font-mono text-xs" placeholder={EXAMPLE} value={text} onChange={e => setText(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-end gap-4 text-xs">
          <button className="btn py-1" onClick={() => setText(EXAMPLE)}>Load example</button>
          <button className="btn py-1" onClick={() => setText('')}>Clear</button>
          <Field label="DEG padj ≤"><input type="number" step={0.001} min={0} max={1} className="input w-20 py-1" value={padjMax} onChange={e => setPadjMax(clamp(+e.target.value, 0, 1))} /></Field>
          <Field label="|log2FC| ≥"><input type="number" step={0.1} min={0} className="input w-20 py-1" value={lfcMin} onChange={e => setLfcMin(clamp(+e.target.value, 0, 100))} /></Field>
          <Field label="direction">
            <select className="input py-1" value={direction} onChange={e => setDirection(e.target.value as any)}>
              <option value="both">both</option><option value="up">up in {contrast.numerator}</option><option value="down">up in {contrast.denominator}</option>
            </select>
          </Field>
          {sets.length > 0 && <span className="text-slate-400">{degUpper.size.toLocaleString()} DEGs · background {N.toLocaleString()}</span>}
        </div>
      </div>

      {sets.length === 0 ? (
        <div className="card p-12 text-center text-sm text-slate-400">
          Search the library above, or define a set of your own, to see its DEG statistics,
          its enrichment, and its activity in every sample.
        </div>
      ) : (
        <>
          {/* set-level DEG overlap + ORA enrichment */}
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Set enrichment &amp; DEG overlap — {contrast.label}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Gene set</th>
                    <th className="px-3 py-2">source</th>
                    <th className="px-3 py-2 text-right">genes (found/input)</th>
                    <th className="px-3 py-2 text-right">DEGs</th>
                    <th className="px-3 py-2 text-right">% DEG</th>
                    <th className="px-3 py-2 text-right">fold enrich.</th>
                    <th className="px-3 py-2 text-right">ORA p</th>
                    <th className="px-3 py-2 text-right">ORA padj</th>
                  </tr>
                </thead>
                <tbody>
                  {setRows.map(r => (
                    <tr key={r.key} onClick={() => setSelName(r.key)}
                      className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${selected?.key === r.key ? 'bg-indigo-50/60 dark:bg-slate-800' : 'hover:bg-indigo-50/40'}`}>
                      <td className="px-3 py-1.5 font-medium">{r.name}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-400" title={r.id || undefined}>
                        {r.source}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{r.K}/{r.nInput}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-indigo-600">{r.k}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.K ? (100 * r.k / r.K).toFixed(0) : '0'}%</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.fold ? r.fold.toFixed(1) + '×' : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{fmtP(r.p)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.padj < thr ? 'font-semibold text-red-600' : ''}`}>{fmtP(r.padj)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              <b>Enrichment as activity readout:</b> hypergeometric over-representation of the set's genes among the {degUpper.size.toLocaleString()} DEGs
              (padj ≤ {padjMax}, |log2FC| ≥ {lfcMin}) against {N.toLocaleString()} tested genes; padj is BH across your {setRows.length} set(s). Click a row for per-gene detail.
            </p>
          </div>

          {/* selected set — per-gene DEG statistics */}
          {selSet && (
            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {selSet.name} — per-gene DEG statistics ({contrast.label})
                </h3>
                <span className="text-sm text-slate-500">{selected?.k}/{selected?.K} genes are DEGs</span>
              </div>
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2">Gene</th><th className="px-3 py-2 text-right">log2FC</th>
                      <th className="px-3 py-2 text-right">padj</th><th className="px-3 py-2 text-right">combined</th>
                      <th className="px-3 py-2 text-right">rank (all DEGs)</th><th className="px-3 py-2">significance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberStats.map(({ g, d, comb, rank }) => (
                      <tr key={g} onClick={() => onSelectGene(g)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800">
                        <td className="px-3 py-1.5 font-medium">{g}{!d && <span className="ml-1 text-xs text-slate-400">(not tested)</span>}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>{d && d.log2FoldChange != null ? d.log2FoldChange.toFixed(2) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtP(d?.padj ?? null)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{comb != null ? comb.toFixed(2) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500">{rank ? `${rank} / ${totalRanked}` : '—'}</td>
                        <td className="px-3 py-1.5">
                          {d && d.padj != null && d.padj < thr
                            ? <span className={`pill ${d.log2FoldChange > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{d.log2FoldChange > 0 ? `↑ ${contrast.numerator}` : `↑ ${contrast.denominator}`}</span>
                            : <span className="pill bg-slate-100 text-slate-500 dark:bg-slate-700">n.s.</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-400"><b>Combined</b> = −log10(p)×log2FC; <b>rank</b> = position among all {totalRanked.toLocaleString()} tested genes by combined score. Click a gene to open it.</p>
            </div>
          )}

          {/* per-sample module score (secondary) */}
          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Per-sample activity (module score)</h3>
              <label className="flex items-center gap-1.5 text-sm text-slate-500">
                score method:
                <select className="input py-1" value={scoreMethod} onChange={e => setScoreMethod(e.target.value as any)}>
                  <option value="runningsum">rank running-sum (weighted, stable)</option>
                  <option value="meanrank">mean rank (rank-based)</option>
                  <option value="meanz">mean z-score</option>
                </select>
              </label>
            </div>
            <Plot data={boxTraces} downloadName={`set_activity_${scoreMethod}_${contrast.id}`} layout={{
              title: contrastTitle(`Gene-set activity — ${contrast.label}`),
              margin: { t: 34, r: 10, b: 50, l: 52 }, boxmode: 'group',
              xaxis: { type: 'category', automargin: true },
              yaxis: { title: scoreMethod === 'runningsum' ? 'enrichment score' : scoreMethod === 'meanrank' ? 'rank score' : 'module score (mean z)', zeroline: true },
              legend: { orientation: 'h', y: 1.12, x: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
            }} style={{ height: 340 }} />
            <dl className="mt-2 space-y-1 text-xs text-slate-400">
              <Method active={scoreMethod === 'runningsum'} name="Rank running-sum (default)">
                rewards a set when its genes rank near the top (highly expressed) in a sample, giving the very top genes extra weight. Per-sample &amp; stable.
              </Method>
              <Method active={scoreMethod === 'meanrank'} name="Mean rank">
                the set's average expression rank in each sample — higher = more highly expressed. Simplest rank score; per-sample &amp; stable.
              </Method>
              <Method active={scoreMethod === 'meanz'} name="Mean z-score">
                each gene's distance from its across-sample average, averaged over the set. Easy to read but wobbles with few replicates.
              </Method>
            </dl>
            <p className="mt-2 text-xs text-slate-400">
              All three are per-sample; higher = the set is more active in that sample. (The
              enrichment table above is DEG-based instead.)
            </p>
            {/* How many genes each box was actually built from.
                The table above reports K — members present in the DEG
                background — and the score walks the COUNT MATRIX, which is a
                different list. A 289-gene MSigDB term of which this experiment
                quantified 40 is a perfectly good score and a bad one to read as
                289 genes' worth of evidence, so the number is on the card
                rather than inferable from another one. */}
            <p className="mt-1 text-xs text-slate-400">
              Scored on the members this bundle quantifies:{' '}
              {moduleBySet.map(m => `${m.name} ${m.n}/${sets.find(s => s.key === m.key)?.nInput ?? m.n}`).join(' · ')}.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-1.5 text-slate-500"><span className="whitespace-nowrap">{label}</span>{children}</label>
}

function Method({ active, name, children }: { active: boolean; name: string; children: React.ReactNode }) {
  return (
    <div className={active ? 'text-slate-600 dark:text-slate-300' : ''}>
      <dt className="inline font-semibold">{active ? '▸ ' : ''}{name}:</dt>{' '}
      <dd className="inline">{children}</dd>
    </div>
  )
}
const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)))
function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
