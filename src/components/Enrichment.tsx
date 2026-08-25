import { useMemo, useState } from 'react'
import type { Bundle, Contrast, DEGRow } from '../types'
import { combinedScore } from '../lib/stats'
import { oraColorDomain, oraIndexed, type ORAResult } from '../lib/ora'
import { useSetIndex, type LibraryControl } from '../lib/genesets.ts'
import type { OverlapQuery, QueryRow } from '../lib/venn'
import { LibraryPicker } from './GeneSetSources.tsx'
import { contrastTitle } from '../lib/palette'
import { reportOra, useReport } from '../lib/methods'
import Plot from '../lib/Plot'

interface Props {
  bundle: Bundle
  contrast: Contrast
  /** The app's one gene-set library — see useLibrary in lib/genesets.ts. */
  library: LibraryControl
  /**
   * A gene list to test INSTEAD of this contrast's DEGs — a wedge of the Venn
   * on the Overlap tab.
   *
   * The genes in a wedge were already selected, by cutoffs applied to several
   * comparisons at once; re-filtering them by this tab's padj and log2FC would
   * apply one comparison's thresholds to a list that is not one comparison's.
   * So when this is set the cutoff controls are gone rather than ignored, and
   * the query, the background and the drill-down all come from the wedge.
   */
  query?: OverlapQuery | null
  onClearQuery?: () => void
  onSelectGene: (gene: string) => void
}

/**
 * What a bar's length means.
 *
 * clusterProfiler draws Count on its barplot and GeneRatio on its dotplot, and
 * the difference matters: a raw count rewards big sets, so "Ribosome" at 63/84
 * outdraws a 5-gene pathway matched 5/5 even though the second is the stronger
 * statement about this DEG list. Gene ratio is the default here for that
 * reason. This card drew count and only count, which on the full MSigDB library
 * put GO:BP's largest terms at the top of every figure.
 */
type BarMetric = 'ratio' | 'count' | 'fold'

/**
 * Below this many sets, a collection is somebody's own rather than a database.
 *
 * Only used to pick the default size floor. MSigDB's smallest shipped
 * collection is 19 sets and its next is 50, so this does not separate them from
 * each other — it separates a pasted handful from all of them.
 */
const SMALL_LIBRARY = 200

/**
 * Enrichment = live, tunable over-representation analysis (ORA) only.
 *
 * The library no longer has to come with the bundle. It used to: a bundle
 * carried genesets.csv, written by export-bundle.R, which meant five
 * collections for Homo sapiens filtered to that experiment's background — and
 * a bundle exported without it could not run ORA at all. The studio now ships
 * the whole of MSigDB for both species, fetched a collection at a time, plus
 * the assembled Metabolic library.
 *
 * A bundle's own genesets.csv is still read, and is offered as one more
 * collection beside them rather than as the only one there is.
 */
export default function Enrichment(props: Props) {
  return <CustomORA {...props} />
}

function CustomORA({ bundle, contrast, library, query, onClearQuery, onSelectGene }: Props) {
  // The wedge's own rows when there is one — so the member drill-down below
  // shows the evidence that put each gene in it, not another comparison's.
  const contrastDeg = bundle.degByContrast[contrast.id] || []
  const deg: MaybeSourced[] = query ? query.rows : contrastDeg
  const [padjMax, setPadjMax] = useState(0.05)
  const [lfcMin, setLfcMin] = useState(1)
  const [direction, setDirection] = useState<'both' | 'up' | 'down'>('both')
  const [termId, setTermId] = useState<string>('')
  const [rankBy, setRankBy] = useState<'padj' | 'count'>('padj')
  const [metric, setMetric] = useState<BarMetric>('ratio')
  const [topN, setTopN] = useState(15)

  const degMap = useMemo(() => buildDegMap(deg), [deg])
  const { rankMap, totalRanked } = useMemo(() => buildRankMap(deg), [deg])

  const { lib } = library

  /**
   * The size window, and whether the reader has set it themselves.
   *
   * 10 is clusterProfiler's `minGSSize` and the right floor for MSigDB, where
   * the KEGG MEDICUS modules are small by design and mostly noise. It is the
   * wrong floor for a collection somebody pasted in: a hand-curated pathway is
   * routinely seven to fifteen genes, and the window is applied to K — the
   * members this CONTRAST tested — so a twelve-gene set with nine tested is
   * silently below it. Somebody who adds seven sets and finds one already gone
   * has been failed by a default chosen for a different library.
   *
   * So the floor is derived from the library until the reader touches the
   * field, after which it is theirs and nothing moves it.
   */
  const [size, setSize] = useState<{ min: number; max: number } | null>(null)
  const smallLibrary = lib.collections.length > 0
    && lib.collections.every(c => c.sets.length < SMALL_LIBRARY)
  const minSize = size?.min ?? (smallLibrary ? 3 : 10)
  const maxSize = size?.max ?? 500
  const setMinSize = (v: number) => setSize({ min: v, max: maxSize })
  const setMaxSize = (v: number) => setSize({ min: minSize, max: v })

  /**
   * The background: every gene this experiment TESTED, annotated.
   *
   * Passed whole to indexFor, which intersects it with the union of the enabled
   * collections — the annotated background this app has always used. The
   * intersection has to happen against the library actually enabled, so it
   * cannot be done here.
   */
  const background = useMemo(
    () => (query ? query.background : deg.map(r => r.gene_name || r.gene_id)),
    [query, deg])

  /**
   * Nothing is tested against itself.
   *
   * A wedge can be saved as a gene set on the Overlap tab, and a saved set is
   * live in the library immediately — so testing that same wedge would find it
   * at a perfect overlap and an astronomical p-value, top the chart with it,
   * and push every real hit down the ranking. Removed from the COLLECTIONS
   * rather than filtered out of the results, because a set that reaches the
   * test also enters the Benjamini–Hochberg correction, and one impossible
   * p-value in there moves every other set's adjusted p.
   */
  const queryId = query?.setId
  const collections = useMemo(() => {
    if (!queryId) return lib.collections
    return lib.collections.map(c => {
      const keep = c.sets.filter(x => x.id !== queryId)
      return keep.length === c.sets.length ? c : { ...c, sets: keep }
    })
  }, [lib.collections, queryId])
  const selfExcluded = !!queryId
    && lib.collections.some(c => c.sets.some(x => x.id === queryId))

  const index = useSetIndex(collections, background)

  const degUpper = useMemo(() => {
    const s = new Set<string>()
    // A wedge is already a selection. Filtering it again here would be a second
    // pass of one contrast's cutoffs over a list drawn from several.
    if (query) {
      for (const r of query.rows) s.add((r.gene_name || r.gene_id).toUpperCase())
      return s
    }
    for (const r of deg) {
      if (r.padj == null || r.padj > padjMax) continue
      if (r.log2FoldChange == null || Math.abs(r.log2FoldChange) < lfcMin) continue
      if (direction === 'up' && r.log2FoldChange <= 0) continue
      if (direction === 'down' && r.log2FoldChange >= 0) continue
      s.add((r.gene_name || r.gene_id).toUpperCase())
    }
    return s
  }, [query, deg, padjMax, lfcMin, direction])

  /**
   * oraIndexed, not runORA.
   *
   * runORA walks every gene of every set and upper-cases as it goes, which was
   * free across the five collections a bundle used to carry and is about 1.6
   * million string operations across MSigDB's 35 361 — on every drag of a
   * threshold slider. The fold against the background happens once, in
   * useSetIndex above; what happens here is a walk over the DEG list.
   *
   * No `sources` post-filter. There used to be a second row of source chips
   * under the sliders that narrowed what was REPORTED, beside the collection
   * chips that decide what is DOWNLOADED, TESTED and CORRECTED ACROSS. Two rows
   * that looked identical and meant different things: switching Reactome off in
   * one changed every p-value on the page, switching it off in the other
   * changed none of them. One control, and it is the one that moves N.
   */
  const results = useMemo(
    () => (index ? oraIndexed([...degUpper], index, { minSize, maxSize }) : []),
    [degUpper, index, minSize, maxSize])

  /**
   * The query size the TEST used: DEGs that are in the annotated background,
   * which is exactly the n `oraIndexed` divides by.
   *
   * The gene ratio has to use the same n as the test that produced the p-value
   * beside it — clusterProfiler's GeneRatio does — or a DEG list that is half
   * unannotated reports a ratio half of what was actually computed.
   */
  const nDegInBg = useMemo(() => {
    if (!index) return 0
    let n = 0
    for (const g of degUpper) if (index.idOf.has(g)) n++
    return n
  }, [degUpper, index])

  /**
   * How many sets the size window actually left to test.
   *
   * Without this the card could only count DEGs, and a reader who saw two bars
   * had no way to learn where the rest went. The default 10–500 window drops
   * 255 of KEGG's 844 sets on its own, because the MEDICUS modules are small by
   * design — that is a fact about the analysis and it belongs on screen.
   */
  const inRange = useMemo(() => {
    if (!index) return { n: 0, of: 0 }
    let n = 0
    for (const s of index.sets) if (s.K >= minSize && s.K <= maxSize) n++
    return { n, of: index.sets.length }
  }, [index, minSize, maxSize])

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
      padjMax, lfcMin, direction, minSize, maxSize, sources: allSources,
      nSets, nDeg: degUpper.size, nBackground: nBg, nSig,
      // Without this the Methods paragraph would claim the tested list came out
      // of the cutoffs beside it, which for a wedge is simply untrue.
      query: query ? query.prose : null,
    }),
    [padjMax, lfcMin, direction, minSize, maxSize, allSources.join(','),
      nSets, degUpper.size, nBg, nSig, query?.prose ?? ''].join('|'),
  )

  const top = orderedResults.slice(0, topN)
  const bars = [...top].reverse()
  const selected = orderedResults.find(r => r.id === termId) || top[0]

  const memberRows = (selected?.overlap || []).map(g => {
    const d = degMap.get(g)
    return { g, d, comb: d ? combinedScore(d.log2FoldChange, d.pvalue) : null, rank: rankMap.get(g) }
  }).sort((a, b) => (b.comb ?? -Infinity) - (a.comb ?? -Infinity))

  // Every set, every column, every overlapping gene — the figure shows fifteen.
  const downloadCsv = () => {
    const header = ['set', 'id', 'source', 'overlap', 'setSize', 'geneRatio',
      'foldEnrichment', 'pvalue', 'padj', 'genes']
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const lines = [header.join(',')]
    for (const r of orderedResults) {
      lines.push([
        esc(r.name), r.id, esc(r.source), String(r.count), String(r.setSize),
        (nDegInBg ? r.count / nDegInBg : 0).toFixed(5),
        r.foldEnrichment.toFixed(4),
        r.pvalue === 0 ? `1e-${r.nlp.toFixed(1)}` : r.pvalue.toExponential(4),
        r.padj === 0 ? `1e-${r.nlpAdj.toFixed(1)}` : r.padj.toExponential(4),
        esc(r.overlap.join(' ')),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = query
      ? `enrichment_${fileSlug(query.label)}.csv`
      : `enrichment_${contrast.id}_${direction}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        {/* Which collections are in play. They are a parameter of the analysis
            like the thresholds below them — switching GO:BP off changes what is
            tested and therefore what Benjamini–Hochberg is applied across — so
            they sit on the card that runs the test. */}
        {query && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm dark:border-indigo-500/40 dark:bg-indigo-500/10">
            <span className="pill bg-indigo-200 text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100">
              from Overlap
            </span>
            <span className="min-w-0 text-indigo-900 dark:text-indigo-200">
              Testing <b>{query.rows.length.toLocaleString()} genes</b> — {query.label} — against the{' '}
              {background.length.toLocaleString()} genes these {query.nSets} comparisons tested.
            </span>
            {selfExcluded && (
              <span className="w-full text-xs text-indigo-800/80 dark:text-indigo-300/80">
                This selection is also saved as a gene set. It is left out of its own test — a set
                that is the query cannot be enriched for it.
              </span>
            )}
            {onClearQuery && (
              <button className="btn ml-auto py-1 text-xs" onClick={onClearQuery}>
                ← back to {contrast.label} DEGs
              </button>
            )}
          </div>
        )}

        <LibraryPicker library={library} index={index} background={background}
          recorded={bundle.meta.species} />

        <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${query ? 'xl:grid-cols-3' : 'xl:grid-cols-6'}`}>
          {/* The cutoffs are hidden, not disabled, when a wedge is being tested:
              a greyed-out "padj ≤ 0.05" beside a list that was not selected by
              it still reads as a description of that list. */}
          {!query && <>
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
          </>}
          <Ctl label="set size">
            <div className="flex items-center gap-1">
              <input type="number" className="input w-16 py-1" value={minSize} min={1}
                aria-label="Minimum set size"
                onChange={e => setMinSize(Math.max(1, +e.target.value || 1))} />
              <span className="text-slate-400">–</span>
              <input type="number" className="input w-20 py-1" value={maxSize} min={1}
                aria-label="Maximum set size"
                onChange={e => setMaxSize(Math.max(1, +e.target.value || 1))} />
            </div>
          </Ctl>
          <Ctl label="bar shows">
            <select className="input w-full py-1" value={metric} aria-label="What the bar length shows"
              onChange={e => setMetric(e.target.value as BarMetric)}>
              <option value="ratio">gene ratio (k/n)</option>
              <option value="count">DEG count (k)</option>
              <option value="fold">fold enrichment</option>
            </select>
          </Ctl>
          <Ctl label="rank by / show">
            <div className="flex items-center gap-1">
              <select className="input w-full py-1" value={rankBy} aria-label="Rank terms by"
                onChange={e => setRankBy(e.target.value as any)}>
                <option value="padj">adj. p</option>
                <option value="count">count</option>
              </select>
              <input type="number" className="input w-16 py-1" value={topN} min={1} max={100}
                aria-label="Terms shown"
                onChange={e => setTopN(clamp(Math.round(+e.target.value), 1, 100))} />
            </div>
          </Ctl>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          <b>{degUpper.size.toLocaleString()}</b>{query ? ' genes in this selection' : ' DEGs at these thresholds'} ({nDegInBg.toLocaleString()} in the annotated background of {nBg.toLocaleString()}) ·
          <b> {results.length.toLocaleString()}</b> enriched sets (padj &lt; 0.05: {nSig.toLocaleString()})
        </p>
      </div>

      {results.length === 0 ? (
        /* The empty state names WHICH filter emptied it. "No sets pass — loosen
           the thresholds" was one sentence for five different situations, and
           four of them were not about the thresholds at all. */
        <div className="card p-10 text-center text-sm text-slate-400">
          {degUpper.size === 0
            ? query
              ? `This selection holds no genes, so there is nothing to test. Pick a wedge with
                 genes in it on the Overlap tab, or loosen the cutoffs there.`
              : `No gene passes padj ≤ ${padjMax} and |log2FC| ≥ ${lfcMin}, so there is nothing to
               test. Loosen the cutoffs above.`
            : inRange.of === 0
              ? 'No collection is loaded, so there was nothing to test against. Switch one on under Collections above.'
              : inRange.n === 0
                ? `${degUpper.size.toLocaleString()} DEGs, but none of the ${inRange.of.toLocaleString()} sets
                   fall between ${minSize} and ${maxSize} genes — so nothing was tested. Widen the
                   set-size window above.`
                : nDegInBg === 0
                  ? `None of the ${degUpper.size.toLocaleString()} DEGs is in any of the
                     ${inRange.n.toLocaleString()} sets tested, so there is nothing to be enriched.
                     On a collection of your own that usually means the species or the
                     capitalisation differs from this bundle — the set editor lists which genes
                     it could not find.`
                  : `${degUpper.size.toLocaleString()} genes against ${inRange.n.toLocaleString()} sets,
                     and no set overlaps them. ${query
                       ? 'Widen the set-size range, or switch more collections on.'
                       : 'Loosen padj / log2FC, or widen the set-size range.'}`}
        </div>
      ) : (
        <>
          <div className="card p-4">
            <div className="mb-1 flex justify-end">
              <button className="btn py-1 text-xs" onClick={downloadCsv}>⭳ Download CSV</button>
            </div>
            <Plot
              data={[barTrace(bars, metric, nDegInBg)]}
              layout={barLayout(bars.length, query ? query.label : contrast.label, metric)}
              onPointClick={p => p?.customdata && setTermId(p.customdata)}
              downloadName={query ? `ORA_${fileSlug(query.label)}` : `ORA_${contrast.id}_${direction}`}
            />
            <p className="mt-1 text-center text-xs text-slate-400">
              Live over-representation (hypergeometric + BH). Colour = −log10 p.adjust; the scale
              always reaches past padj 0.05, so a page where nothing is significant looks like one.
              Click a bar to list its DEGs.
            </p>
          </div>

          {/* The whole funnel, not just the last step of it. A reader who has
              added seven sets and sees two bars needs to know that one fell
              below the size floor and four contain no DEG from this list —
              which ORA drops silently, because a set with no overlap has
              nothing to report. */}
          <p className="px-1 font-mono text-xs text-slate-400">
            {inRange.of.toLocaleString()} sets contain a tested gene · {inRange.n.toLocaleString()} within{' '}
            {minSize}–{maxSize} genes · {results.length.toLocaleString()} contain one of the{' '}
            {nDegInBg.toLocaleString()} annotated DEGs · showing {top.length}. Gene ratio = k/n,
            fold = (k/n) ÷ (K/N). The CSV has every set.
          </p>

          {selected && (
            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {selected.name}<span className="ml-2 font-mono text-xs normal-case text-slate-400">{selected.id} · {selected.source} · {query ? query.label : contrast.label}</span>
                </h3>
                <span className="text-sm text-slate-500">
                  {selected.count}/{selected.setSize} DEGs · ratio {(nDegInBg ? selected.count / nDegInBg : 0).toFixed(3)} · fold {selected.foldEnrichment.toFixed(1)}× · padj {fmtP(selected.padj, selected.nlpAdj)}
                </span>
              </div>
              <GeneStatTable rows={memberRows} contrast={contrast} totalRanked={totalRanked} onSelectGene={onSelectGene} />
              <p className="mt-2 text-xs text-slate-400">
                {query
                  ? <>Overlapping genes from this selection. A wedge is assembled from several
                    comparisons and has no single fold change, so <b>log2FC</b> and <b>padj</b> are
                    the strongest evidence any of them gave the gene, and <b>rank</b> is its
                    position among the {totalRanked.toLocaleString()} genes of the selection. </>
                  : <>Overlapping DEGs (padj ≤ {padjMax}, |log2FC| ≥ {lfcMin}) — all significant by construction.
                    <b> Combined</b> = −log10(p)×log2FC; <b>rank</b> = position among all {totalRanked.toLocaleString()} tested genes by combined score. </>}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── shared bits ──────────────────────────────────────────────────────────────
/**
 * A row that MAY know which comparison it came from — one from a wedge does,
 * one from this contrast's own table does not need to.
 */
type MaybeSourced = DEGRow & Partial<Pick<QueryRow, 'from' | 'up' | 'down'>>

interface MemberRow { g: string; d: MaybeSourced | undefined; comb: number | null; rank: number | undefined }

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
                  ? <span
                      className={`pill ${d.log2FoldChange > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}
                      // A wedge's rows come from different comparisons, so the
                      // group a positive fold change points at is the SOURCE
                      // comparison's, never the one selected at the top of the
                      // page. The row knows; the table asks it.
                      title={d.from ? `from ${d.from}` : undefined}>
                      ↑ {d.log2FoldChange > 0
                        ? (d.up ?? contrast.numerator)
                        : (d.down ?? contrast.denominator)}
                    </span>
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

const METRIC_AXIS: Record<BarMetric, string> = {
  ratio: 'gene ratio (k/n)',
  count: 'DEG count (k)',
  fold: 'fold enrichment',
}

function barTrace(bars: ORAResult[], metric: BarMetric, nQuery: number) {
  const value = (r: ORAResult) =>
    metric === 'count' ? r.count
      : metric === 'fold' ? r.foldEnrichment
        : (nQuery ? r.count / nQuery : 0)
  /**
   * Colour from nlpAdj, not from −log10(padj).
   *
   * padj is a double, and a strongly enriched set against a 15 000-gene
   * background lands below what a double holds — it arrives as exactly 0, and
   * −log10(0) is Infinity, which Plotly renders by silently dropping the point
   * from the colour scale. `nlpAdj` is the same Benjamini–Hochberg step-up
   * carried in −log10 space precisely so those sets keep a number; see ora.ts.
   */
  const sig = bars.map(r => r.nlpAdj)
  const { lo, hi } = oraColorDomain(sig)
  return {
    type: 'bar', orientation: 'h',
    x: bars.map(value),
    // Full name, word-wrapped onto multiple lines so long MSigDB terms aren't cut off.
    y: bars.map(t => wrapLabel(t.name, 40)),
    customdata: bars.map(t => t.id),
    // Hover shows the complete, un-wrapped name plus every quantity, so the
    // three bar metrics are one selector rather than three separate figures.
    text: bars.map(r => `${r.name}<br>${r.count}/${r.setSize} genes`
      + ` · ratio ${(nQuery ? r.count / nQuery : 0).toFixed(3)}`
      + ` · fold ${r.foldEnrichment.toFixed(1)}×<br>padj ${fmtP(r.padj, r.nlpAdj)}`),
    hovertemplate: '%{text}<extra></extra>',
    // Hover only. `text` on a bar trace is drawn INSIDE the bar by default, so
    // three lines of statistics were being printed across every bar at four
    // point and the figure read as a smear.
    textposition: 'none',
    marker: {
      color: sig, cmin: lo, cmax: hi,
      // Plotly's own "YlOrRd" runs dark red at 0 to pale yellow at 1 — the
      // reverse of ColorBrewer's, and the reverse of what anybody reading an
      // enrichment figure expects. Unreversed, the most significant term in the
      // table came out the palest thing on the page.
      colorscale: 'YlOrRd', reversescale: true, showscale: true,
      colorbar: { title: '−log10<br>p.adjust', thickness: 12, len: 0.6 },
      line: { color: '#64748b', width: 0.5 },
    },
  }
}
function barLayout(n: number, label: string, metric: BarMetric) {
  return {
    title: contrastTitle(`Over-representation — ${label}`),
    margin: { t: 34, r: 20, b: 40, l: 300 }, height: Math.max(240, n * 26 + 80),
    xaxis: { title: METRIC_AXIS[metric] }, yaxis: { automargin: true, tickfont: { size: 11 } },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'system-ui, sans-serif' },
  }
}
function buildDegMap(rows: MaybeSourced[]) {
  const m = new Map<string, MaybeSourced>()
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

/** A wedge's name is prose; a filename is not. */
const fileSlug = (s: string) =>
  s.replace(/[^\w+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'selection'

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
/**
 * A p-value, and what to print when a double could not hold it.
 *
 * `nlp` is the −log10 the Benjamini–Hochberg step-up carried alongside, so an
 * underflowed p still prints as the number it is rather than as "<1e-300" —
 * which on the full MSigDB library is not a rare case but the top of the table.
 */
function fmtP(p: number | null | undefined, nlp?: number): string {
  if (p == null || Number.isNaN(p)) return '—'
  if (p === 0) return nlp != null && Number.isFinite(nlp) ? `1e-${nlp.toFixed(1)}` : '<1e-300'
  return p < 1e-3 ? p.toExponential(2) : p.toFixed(4)
}
