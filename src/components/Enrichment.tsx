import { useEffect, useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import { combinedScore } from '../lib/stats'
import { oraIndexed } from '../lib/ora'
import { defaultSources, useGeneSets, useSetIndex } from '../lib/genesets.ts'
import type { Collection } from '../lib/msigdb.ts'
import { detectSpecies, speciesOfMeta, type Species } from '../lib/species.ts'
import GeneSetSources from './GeneSetSources.tsx'
import { contrastTitle } from '../lib/palette'
import { reportOra, useReport } from '../lib/methods'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  onSelectGene: (gene: string) => void
}

/**
 * Enrichment = live, tunable over-representation analysis (ORA) only.
 *
 * The library no longer has to come with the bundle. It used to: a bundle
 * carried genesets.csv, written by export-bundle.R, which meant five
 * collections for Homo sapiens filtered to that experiment's background — and
 * a bundle exported without it could not run ORA at all, which is what this
 * gate used to say. The studio now ships the whole of MSigDB for both species,
 * fetched a collection at a time, exactly as scrnaseq-studio does and from
 * byte-identical files.
 *
 * A bundle's own genesets.csv is still read, and is offered as one more
 * collection beside them rather than as the only one there is.
 */
export default function Enrichment({ bundle, contrast, onSelectGene }: Props) {
  return <CustomORA bundle={bundle} contrast={contrast} onSelectGene={onSelectGene} />
}

function CustomORA({ bundle, contrast, onSelectGene }: Props) {
  const deg = bundle.degByContrast[contrast.id] || []
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(1)
  const [direction, setDirection] = useState<'both' | 'up' | 'down'>('both')
  const [minSize, setMinSize] = useState(10)
  const [maxSize, setMaxSize] = useState(500)
  const [selSources, setSelSources] = useState<Set<string>>(new Set())
  const [termId, setTermId] = useState<string>('')
  const [rankBy, setRankBy] = useState<'padj' | 'count'>('padj')
  const [topN, setTopN] = useState(15)

  const degMap = useMemo(() => buildDegMap(deg), [deg])
  const { rankMap, totalRanked } = useMemo(() => buildRankMap(deg), [deg])

  /**
   * Which species' library to test against.
   *
   * The bundle's own meta.species is read first — it is what the lab recorded,
   * and better evidence than anything inferable from the gene list. Detection
   * from the gene names is the fallback for a bundle that left it blank, and
   * the reader can override either.
   */
  const detected = useMemo(
    () => detectSpecies(deg.map(r => r.gene_name || r.gene_id)), [deg])
  const [speciesPick, setSpeciesPick] = useState<Species | null>(null)
  const species: Species = speciesPick
    ?? speciesOfMeta(bundle.meta.species)
    ?? detected.species

  const [srcs, setSrcs] = useState<string[]>([])
  const [customSets, setCustomSets] = useState<Collection[]>([])

  /**
   * The bundle's own genesets.csv, as a collection like any other.
   *
   * It used to be the whole library; it is now one source among twenty-three,
   * which is the right relationship — it is this experiment's export, and
   * MSigDB is the database. Named for the bundle so it cannot be mistaken for
   * one of the shipped collections.
   */
  const embedded = useMemo<Collection[]>(() => {
    const defs = bundle.genesets ?? []
    if (!defs.length) return []
    const at = new Map<string, number>()
    const symbols: string[] = []
    const sets = defs.map(d => ({
      id: d.id,
      name: d.name || d.id,
      genes: Int32Array.from(d.genes.map(g => {
        let k = at.get(g)
        if (k === undefined) { k = symbols.length; at.set(g, k); symbols.push(g) }
        return k
      })),
    }))
    return [{
      species: 'any', source: 'From this bundle', release: bundle.meta.project || 'this export',
      symbols, sets,
    }]
  }, [bundle.genesets, bundle.meta.project])

  const withEmbedded = useMemo(
    () => [...customSets, ...embedded], [customSets, embedded])
  const lib = useGeneSets(species, srcs, withEmbedded)

  // The species' own defaults, once the manifest says what it has — written
  // only while nothing is chosen, so it cannot fight a reader turning one off.
  useEffect(() => {
    if (!lib.manifest || srcs.length) return
    const d = defaultSources(lib.manifest, species)
    if (d.length) setSrcs(d)
  }, [lib.manifest, species, srcs.length])

  /**
   * The background: every gene this experiment TESTED, annotated.
   *
   * Passed whole to indexFor, which intersects it with the union of the enabled
   * collections — the annotated background this app has always used, and the
   * one scrnaseq-studio was corrected to use. The intersection has to happen
   * against the library actually enabled, so it cannot be done here.
   */
  const background = useMemo(
    () => deg.map(r => r.gene_name || r.gene_id), [deg])
  const index = useSetIndex(lib.collections, background)

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

  /**
   * oraIndexed, not runORA.
   *
   * runORA walks every gene of every set and upper-cases as it goes, which was
   * free across the five collections a bundle used to carry and is about 1.6
   * million string operations across MSigDB's 35 361 — on every drag of a
   * threshold slider. The fold against the background happens once, in
   * useSetIndex above; what happens here is a walk over the DEG list.
   */
  const results = useMemo(
    () => (index
      ? oraIndexed([...degUpper], index, {
        minSize, maxSize, sources: selSources.size ? selSources : undefined,
      })
      : []),
    [degUpper, index, minSize, maxSize, selSources])

  const nDegInBg = useMemo(() => {
    if (!index) return 0
    let n = 0
    for (const g of degUpper) if (index.idOf.has(g)) n++
    return n
  }, [degUpper, index])
  const orderedResults = useMemo(
    () => rankBy === 'count' ? [...results].sort((a, b) => b.count - a.count || a.padj - b.padj) : results,
    [results, rankBy])
  // Feed the exact ORA configuration to the Methods tab.
  const nSig = results.filter(r => r.padj < 0.05).length
  const nSets = index?.sets.length ?? 0
  const nBg = index?.N ?? 0
  const allSources = useMemo(
    () => lib.collections.map(c => c.source), [lib.collections])
  useReport(
    () => reportOra({
      padjMax, lfcMin, direction, minSize, maxSize,
      sources: selSources.size ? [...selSources] : allSources,
      nSets, nDeg: degUpper.size, nBackground: nBg, nSig,
    }),
    [padjMax, lfcMin, direction, minSize, maxSize, [...selSources].sort().join(','),
      nSets, degUpper.size, nBg, nSig].join('|'),
  )

  const top = orderedResults.slice(0, topN)
  const bars = [...top].reverse().map(r => ({ id: r.id, description: r.name, count: r.count, padj: r.padj }))
  const selected = orderedResults.find(r => r.id === termId) || top[0]

  const toggleSource = (s: string) => setSelSources(prev => {
    const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n
  })

  const memberRows = (selected?.overlap || []).map(g => {
    const d = degMap.get(g)
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: rankMap.get(g) }
  }).sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity))

  return (
    <div className="space-y-4">
      <div className="card p-4">
        {/* Which collections are in play. They are a parameter of the analysis
            like the thresholds below them — switching GO:BP off changes what is
            tested and therefore what Benjamini–Hochberg is applied across — so
            they sit on the card that runs the test. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 text-xs dark:border-slate-800">
          <span className="font-semibold uppercase tracking-wide text-slate-400">Species</span>
          <select
            className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 dark:border-slate-700"
            value={species} aria-label="Gene set species"
            onChange={e => setSpeciesPick(e.target.value as Species)}
          >
            <option value="human">Human</option>
            <option value="mouse">Mouse</option>
          </select>
          <span className="text-slate-400">
            {speciesOfMeta(bundle.meta.species)
              ? `this bundle records ${bundle.meta.species}`
              : `not recorded in the bundle; the gene names look ${detected.species}`}
          </span>
        </div>
        <GeneSetSources
          lib={lib} species={species} sources={srcs} onSources={setSrcs}
          customSets={customSets} onCustomSets={setCustomSets}
          index={index} background={background} detected={detected}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Ctl label="padj ≤">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={0.25} step={0.005} value={Math.min(padjMax, 0.25)} onChange={e => setPadjMax(+e.target.value)} className="w-full" />
              <input type="number" className="input w-20 py-1" step={0.001} min={0} max={1} value={padjMax}
                onChange={e => setPadjMax(clamp(+e.target.value, 0, 1))} />
            </div>
          </Ctl>
          <Ctl label="|log2FC| ≥">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={3} step={0.1} value={Math.min(lfcMin, 3)} onChange={e => setLfcMin(+e.target.value)} className="w-full" />
              <input type="number" className="input w-20 py-1" step={0.1} min={0} value={lfcMin}
                onChange={e => setLfcMin(clamp(+e.target.value, 0, 100))} />
            </div>
          </Ctl>
          <Ctl label="direction">
            <select className="input w-full py-1" value={direction} onChange={e => setDirection(e.target.value as any)}>
              <option value="both">both</option>
              <option value="up">up in {contrast.numerator}</option>
              <option value="down">up in {contrast.denominator}</option>
            </select>
          </Ctl>
          <Ctl label="set size">
            <div className="flex items-center gap-1">
              <input type="number" className="input w-16 py-1" value={minSize} min={1} onChange={e => setMinSize(+e.target.value || 1)} />
              <span className="text-slate-400">–</span>
              <input type="number" className="input w-20 py-1" value={maxSize} min={1} onChange={e => setMaxSize(+e.target.value || 1)} />
            </div>
          </Ctl>
          <Ctl label="rank by">
            <select className="input w-full py-1" value={rankBy} onChange={e => setRankBy(e.target.value as any)}>
              <option value="padj">adjusted p-value</option>
              <option value="count">gene count</option>
            </select>
          </Ctl>
          <Ctl label="terms shown">
            <input type="number" className="input w-20 py-1" value={topN} min={1} max={100}
              onChange={e => setTopN(clamp(Math.round(+e.target.value), 1, 100))} />
          </Ctl>
        </div>

        {allSources.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">sources:</span>
            {allSources.map(s => (
              <button key={s} onClick={() => toggleSource(s)}
                className={`pill pressable border ${selSources.size === 0 || selSources.has(s) ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'border-slate-200 text-slate-400 dark:border-slate-700'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-sm text-slate-500">
          <b>{degUpper.size.toLocaleString()}</b> DEGs at these thresholds ({nDegInBg.toLocaleString()} in the annotated background of {nBg.toLocaleString()}) ·
          <b> {results.length.toLocaleString()}</b> enriched sets (padj &lt; 0.05: {results.filter(r => r.padj < 0.05).length})
        </p>
      </div>

      {results.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          No sets pass with the current thresholds — loosen padj / log2FC, or widen the set-size range.
        </div>
      ) : (
        <>
          <div className="card p-4">
            <Plot
              data={[barTrace(bars)]}
              layout={barLayout(bars.length, contrast.label)}
              onPointClick={p => p?.customdata && setTermId(p.customdata)}
              downloadName={`custom_ORA_${contrast.id}`}
            />
            <p className="mt-1 text-center text-xs text-slate-400">Live over-representation (hypergeometric + BH). Bar = DEG count, colour = −log10 p.adjust. Click a bar to list its DEGs.</p>
          </div>

          {selected && (
            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {selected.name}<span className="ml-2 font-mono text-xs normal-case text-slate-400">{selected.id} · {selected.source} · {contrast.label}</span>
                </h3>
                <span className="text-sm text-slate-500">
                  {selected.count}/{selected.setSize} DEGs · fold {selected.foldEnrichment.toFixed(1)}× · padj {fmtP(selected.padj)}
                </span>
              </div>
              <GeneStatTable rows={memberRows} contrast={contrast} totalRanked={totalRanked} onSelectGene={onSelectGene} />
              <p className="mt-2 text-xs text-slate-400">
                Overlapping DEGs (padj ≤ {padjMax}, |log2FC| ≥ {lfcMin}) — all significant by construction.
                <b> Combined</b> = −log10(p)×log2FC; <b>rank</b> = position among all {totalRanked.toLocaleString()} tested genes by combined score.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────
interface MemberRow { g: string; d: DEGRow | undefined; comb: number | null; rank: number | undefined }

function GeneStatTable({ rows, contrast, totalRanked, onSelectGene }: {
  rows: MemberRow[]; contrast: Contrast; totalRanked: number; onSelectGene: (g: string) => void
}) {
  const thr = contrast.padj_threshold ?? 0.05
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2">Gene</th>
            <th className="px-3 py-2 text-right">log2FC</th>
            <th className="px-3 py-2 text-right">combined</th>
            <th className="px-3 py-2 text-right">rank (all DEGs)</th>
            <th className="px-3 py-2 text-right">padj</th>
            <th className="px-3 py-2">significance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ g, d, comb, rank }) => (
            <tr key={g} className="cursor-pointer border-t border-slate-100 hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-slate-800"
              onClick={() => onSelectGene(g)}>
              <td className="px-3 py-1.5 font-medium">{g}</td>
              <td className={`px-3 py-1.5 text-right font-mono ${d && d.log2FoldChange > 0 ? 'text-red-600' : 'text-blue-600'}`}>{d && d.log2FoldChange != null ? d.log2FoldChange.toFixed(2) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono">{comb != null ? comb.toFixed(2) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-500">{rank ? `${rank} / ${totalRanked}` : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono">{fmtP(d?.padj ?? null)}</td>
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
  )
}

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-xs font-medium text-slate-500">{label}</div>{children}</div>
}

function barTrace(bars: { id: string; description: string; count: number; padj: number | null }[]) {
  return {
    type: 'bar', orientation: 'h',
    x: bars.map(t => t.count),
    // Full name, word-wrapped onto multiple lines so long MSigDB terms aren't cut off.
    y: bars.map(t => wrapLabel(t.description, 40)),
    customdata: bars.map(t => t.id),
    // Hover shows the complete, un-wrapped name plus stats.
    text: bars.map(t => `${t.description}<br>padj ${fmtP(t.padj)}`),
    hovertemplate: '%{text}<br>count %{x}<extra></extra>',
    marker: {
      color: bars.map(t => -Math.log10(Math.max(t.padj ?? 1, 1e-300))),
      colorscale: 'YlOrRd', showscale: true,
      colorbar: { title: '−log10<br>p.adjust', thickness: 12, len: 0.6 },
      line: { color: '#64748b', width: 0.5 },
    },
  }
}
function barLayout(n: number, label: string) {
  return {
    title: contrastTitle(`Over-representation — ${label}`),
    margin: { t: 34, r: 20, b: 40, l: 300 }, height: Math.max(240, n * 26 + 80),
    xaxis: { title: 'DEG count' }, yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
  }
}
function buildDegMap(rows: DEGRow[]) {
  const m = new Map<string, DEGRow>()
  for (const r of rows) { m.set(r.gene_id.toUpperCase(), r); if (r.gene_name) m.set(r.gene_name.toUpperCase(), r) }
  return m
}
function buildRankMap(rows: DEGRow[]) {
  const scored = rows.map(r => ({ r, c: combinedScore(r.log2FoldChange, r.pvalue) }))
    .filter(x => x.c != null).sort((a, b) => (b.c as number) - (a.c as number))
  const rankMap = new Map<string, number>()
  scored.forEach((s, i) => { rankMap.set(s.r.gene_id.toUpperCase(), i + 1); if (s.r.gene_name) rankMap.set(s.r.gene_name.toUpperCase(), i + 1) })
  return { rankMap, totalRanked: scored.length }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)))
// Word-wrap a long label to <=width per line (breaking on _ / - and spaces, hard-
// wrapping any single run that is still too long) using <br> for Plotly tick text.
function wrapLabel(s: string, width: number): string {
  if (s.length <= width) return s
  const lines: string[] = []
  let line = ''
  for (const tok of s.split(/(?=[_/\- ])/)) {
    if (line && (line + tok).length > width) { lines.push(line); line = tok.replace(/^[_/\- ]/, '') }
    else line += tok
  }
  if (line) lines.push(line)
  return lines.flatMap(l => {
    if (l.length <= width) return [l]
    return l.match(new RegExp(`.{1,${width}}`, 'g')) || [l]
  }).join('<br>')
}
function fmtP(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
