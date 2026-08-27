// The enrichment maths, after the library moved from the bundle to the studio.
//
// Two things changed and both are numerical, so both are pinned here rather
// than left to look right on screen: the hypergeometric tail is summed in log
// space, and there is a second, indexed implementation of the same test that
// has to agree with the reference exactly.

import { ORA_CUT, bh, bhNlp, hyperTail, logHyperTail, oraColorDomain, oraColorScale, oraIndexed, runORA, prepareSets } from '../src/lib/ora.ts'
import { indexFor, parseSets } from '../src/lib/msigdb.ts'
import { tickLabels, tickRows, wrapLabel } from '../src/lib/labels.ts'
import { detectSpecies, speciesOfMeta } from '../src/lib/species.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const near = (name, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${got}\n        want ${want} ± ${tol}`))
}

console.log('\nTHE TAIL, WHERE A DOUBLE RUNS OUT')
{
  // The defect the log-space form exists for. It was survivable while a bundle
  // carried five collections; across MSigDB's 35 361 the sets that underflow
  // are the ones a reader is looking for, and padj was the sort key.
  check('the double underflows to exactly zero', hyperTail(600, 700, 4000, 22000), 0)
  const lp = logHyperTail(600, 700, 4000, 22000)
  check('the log does not', Number.isFinite(lp) && lp < -700, true)
  near('and says how far past zero it is', -lp / Math.LN10, 345.41, 0.05)
  check('two underflowed sets are still ordered',
    -logHyperTail(700, 700, 4000, 22000) > -logHyperTail(600, 700, 4000, 22000), true)

  // Where the double holds the answer, the two must agree — this is one sum
  // rewritten, not a second opinion about it.
  for (const [k, K, n, N] of [[3, 10, 20, 100], [2, 5, 8, 20], [1, 1, 1, 2], [12, 40, 300, 5000]]) {
    near(`log and linear agree at k=${k},K=${K},n=${n},N=${N}`,
      Math.exp(logHyperTail(k, K, n, N)), hyperTail(k, K, n, N), 1e-12)
  }
  near('a known tail is unchanged', hyperTail(3, 10, 20, 100), 0.3187799361823111, 1e-9)
}

console.log('\nBH IN BOTH SPACES IS ONE STEP-UP')
{
  const ps = [1e-9, 2e-4, 0.03, 0.2, 0.5, 0.9, 0.011, 0.047]
  const adj = bh(ps)
  const adjN = bhNlp(ps.map(v => -Math.log10(v)))
  for (let i = 0; i < ps.length; i++) {
    near(`set ${i} agrees between bh and bhNlp`, adjN[i], -Math.log10(adj[i]), 1e-9)
  }
}

console.log('\nTHE INDEXED PATH EQUALS THE REFERENCE')
{
  // Same library, same query, two implementations: runORA walks every gene of
  // every set, oraIndexed walks the query. They must not merely rank the same.
  const defs = [
    { source: 'A', id: 's1', name: 'one', genes: ['G1', 'G2', 'G3', 'G4', 'G5'] },
    { source: 'A', id: 's2', name: 'two', genes: ['G4', 'G5', 'G6', 'G7'] },
    { source: 'B', id: 's3', name: 'three', genes: ['G8', 'G9', 'G10', 'G1', 'G2'] },
    { source: 'B', id: 's4', name: 'four', genes: ['G11', 'G12', 'G13'] },
  ]
  const bg = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'ZZ1', 'ZZ2']
  const query = ['G1', 'G2', 'G4', 'G8', 'G11']

  // A real GMT: name, a description column, then the members. The empty second
  // field is what marks it as a description rather than the first gene — see
  // looksLikeDescription in msigdb.ts, which is what lets the same parser read
  // a spreadsheet paste that has no description column at all.
  const gmt = defs.map(d => [d.id, '', ...d.genes].join('\t')).join('\n')
  const index = indexFor([parseSets(gmt, 'A')], bg)

  const { sets, universe } = prepareSets(defs)
  const bgSet = new Set()
  for (const g of bg) if (universe.has(g.toUpperCase())) bgSet.add(g.toUpperCase())
  const ref = runORA(new Set(query.map(g => g.toUpperCase())), sets, bgSet, { minSize: 1, maxSize: 100 })
  const idx = oraIndexed(query, index, { minSize: 1, maxSize: 100 })

  const key = r => [r.id, r.setSize, r.count, +r.pvalue.toFixed(12), +r.foldEnrichment.toFixed(12)].join('|')
  check('the same sets are reported', idx.length, ref.length)
  check('with the same numbers', idx.map(key).sort(), ref.map(key).sort())
  check('and every one has a real fold enrichment',
    idx.every(r => Number.isFinite(r.foldEnrichment) && r.foldEnrichment > 0), true)
}

console.log('\nTHE SPECIES A BUNDLE RECORDS')
{
  check('Mus musculus', speciesOfMeta('Mus musculus'), 'mouse')
  check('mouse (GRCm39)', speciesOfMeta('mouse (GRCm39)'), 'mouse')
  check('Homo sapiens', speciesOfMeta('Homo sapiens'), 'human')
  check('human, GRCh38', speciesOfMeta('human, GRCh38'), 'human')
  // Not guessed. A bundle that did not record it falls through to detection
  // from the gene names, which is a different and weaker kind of evidence.
  check('unknown is not an answer', speciesOfMeta('unknown'), null)
  check('nor is nothing', speciesOfMeta(undefined), null)
  check('nor is something unmappable', speciesOfMeta('Danio rerio'), null)
}

console.log('\nTHE OVERLAP COLUMN IS SPELLED THE LIBRARY\u2019S WAY')
{
  // The whole reason this needs pinning: MSigDB spells one gene two ways, GFAP
  // for human and Gfap for mouse, and the index keeps the LIBRARY's spelling so
  // a mouse result reads as mouse. Every consumer therefore has to match case-
  // insensitively — and the enrichment drill-down did not, so on any mouse
  // bundle it looked up "Cyld" in a map keyed "CYLD", missed every gene, and
  // rendered a table in which every log2FC was a dash and every gene "n.s.".
  // Human hid it completely: there the two spellings are the same string.
  const gmt = 'MOUSE_SET\tM\tCyld\tIl10\tIl2\tStat5a\nOTHER\tM\tCyld\tPnp\n'
  // A bundle whose exporter upper-cased its symbols, which is common and legal.
  const bg = ['CYLD', 'IL10', 'IL2', 'STAT5A', 'PNP', 'ACTB', 'GAPDH']
  const index = indexFor([parseSets(gmt, 'Mouse sets')], bg)
  const res = oraIndexed(['CYLD', 'IL10', 'IL2'], index, { minSize: 1, maxSize: 100 })

  check('the gene matched despite the casing', res.length > 0, true)
  const set = res.find(r => r.id === 'MOUSE_SET')
  check('and the set counts all three', set.count, 3)
  // The point of the test: what comes OUT is the library's spelling, not the
  // query's. A consumer that assumes otherwise is broken for mouse only.
  check('the overlap carries the library spelling', set.overlap, ['Cyld', 'Il10', 'Il2'])
  check('which is not what the query said',
    set.overlap.some(g => g === g.toUpperCase()), false)
  // The contract the components must honour.
  check('upper-casing it recovers the bundle\u2019s key',
    set.overlap.map(g => g.toUpperCase()), ['CYLD', 'IL10', 'IL2'])
}

console.log('\nTHE SPECIES A BUNDLE CAN BE READ FROM')
{
  // The evidence App was throwing away. `detectSpecies` takes the accession
  // column as its second argument and has since it was written; App passed
  // `gene_name || gene_id` — one collapsed list — so a bundle displayed by
  // symbol hid its own accessions and detection fell back to the casing vote.
  const ids = Array.from({ length: 40 }, (_, i) => `ENSMUSG${String(10000000 + i).padStart(11, '0')}`)
  const upper = ['ABCA1', 'GFAP', 'MKI67', 'ACADL'].concat(
    Array.from({ length: 36 }, (_, i) => `GENE${i}`))

  const namesOnly = detectSpecies(upper)
  check('upper-cased symbols alone read as human', [namesOnly.species, namesOnly.from],
    ['human', 'symbols'])
  const withIds = detectSpecies(upper, ids)
  check('the same object with its accessions is mouse', [withIds.species, withIds.from],
    ['mouse', 'accession'])
  check('and says what settled it', withIds.why, 'ENSMUSG accessions in this object')
  check('confidently', withIds.support, 1)

  // Human accessions carry no species letters — ENSG, not ENSHSAG — so the
  // table is a prefix list and the mouse pattern has to be tried first.
  const hs = detectSpecies(upper, ids.map(i => i.replace('ENSMUSG', 'ENSG')))
  check('human accessions are read too', [hs.species, hs.from], ['human', 'accession'])

  // Too few accessions to vote on falls back rather than deciding on three.
  check('a handful of accessions is not evidence',
    detectSpecies(upper, ids.slice(0, 4)).from, 'symbols')

  // Identifiers with no casing to read — a bundle keyed by number, or by an
  // accession this app does not know — are not a vote for human by default.
  // (7SK is deliberately NOT in this list: it has two capitals and it IS an
  // upper-case symbol, so counting it as evidence is right.)
  const mute = detectSpecies(['1E5', '12345', 'A1', '9'])
  check('nothing to read is not a vote', mute.from, 'default')
  check('and it says so', mute.support, 0)
}

console.log('\nA BAR CHART\u2019S TICK LABELS')
{
  // The name that broke it. Wrapped to as many lines as it needed, in a row
  // sized for one, it printed straight through the two names above and below.
  const monster = 'Adaptive immune response based on somatic recombination of immune '
    + 'receptors built from immunoglobulin superfamily domains'
  const wrapped = wrapLabel(monster)
  check('a long name is capped at two lines', wrapped.split('<br>').length, 2)
  check('and says it was cut', wrapped.endsWith('\u2026'), true)
  check('a short name is left alone', wrapLabel('B cell mediated immunity'),
    'B cell mediated immunity')
  check('a medium one wraps rather than being cut',
    wrapLabel('Adaptive immune response based on somatic recombination').split('<br>').length, 2)

  // The row height is derived from the tallest label DRAWN, so a chart of short
  // names does not get two-line spacing it has no use for.
  check('short names need one row', tickRows(tickLabels(['Trachea development', 'Rrna transcription'])), 1)
  check('a long one takes the whole chart to two', tickRows(tickLabels(['Protein folding', monster])), 2)

  // The silent one. Plotly's category axis is keyed by the label string, so two
  // names that elide to the same text become ONE category and one bar vanishes.
  const twins = [
    'Regulation of transcription from RNA polymerase II promoter in response to hypoxia',
    'Regulation of transcription from RNA polymerase II promoter in response to stress',
  ]
  const ticks = tickLabels(twins)
  check('two names that elide the same way stay two labels',
    new Set(ticks).size, 2)
  check('and the difference is invisible',
    ticks.map(t => t.replace(/\u200B/g, '')), [ticks[0], ticks[0]])
  check('a name repeated outright is still two categories',
    new Set(tickLabels(['Cell cycle', 'Cell cycle'])).size, 2)
}

console.log('\nEVERY BAR ON THE FIGURE GETS ITS OWN COLOUR')
{
  // The measurement that prompted this. Fifteen real terms, padj 6e-19 down to
  // 1e-115: on a linear ramp between the weakest and the strongest, THIRTEEN of
  // them landed in the bottom fifth and came out the same yellow. A colour axis
  // rendering three colours.
  const skewed = [18.20, 18.29, 19.21, 19.37, 19.70, 19.93, 20.34, 20.49,
    23.40, 25.15, 25.33, 29.00, 35.82, 80.50, 114.89]
  const { lo, hi } = oraColorDomain(skewed)
  check('the domain still spans exactly the drawn terms', [lo, hi], [18.20, 114.89])
  const linear = skewed.filter(v => (v - lo) / (hi - lo) < 0.2).length
  check('and a linear ramp would still crush them', linear, 13)

  const stops = oraColorScale(skewed)
  check('one stop per distinct value', stops.length, skewed.length)
  check('the palest is the largest p-value', stops[0][1], 'rgb(255, 255, 204)')
  check('the darkest is the smallest', stops[stops.length - 1][1], 'rgb(128, 0, 38)')
  check('every colour differs from its neighbour',
    new Set(stops.map(s => s[1])).size, stops.length)

  // The stops are an AXIS, so they have to be a valid one: inside [0,1] and
  // never going backwards, or Plotly renders nothing at all.
  check('positions are inside the bar', stops.every(([p]) => p >= 0 && p <= 1), true)
  check('and never go backwards',
    stops.every(([p], i) => i === 0 || p > stops[i - 1][0]), true)
  check('it starts at the bottom and ends at the top',
    [stops[0][0], stops[stops.length - 1][0]], [0, 1])

  // Colour is still monotonic in the value — the stop for a stronger term sits
  // higher up the bar than the stop for a weaker one. That is what keeps the
  // colour bar a true axis rather than a rank key.
  const at = v => stops.find(([p]) => Math.abs(p - (v - lo) / (hi - lo)) < 1e-9)
  check('a stronger term sits higher on the bar',
    at(80.50)[0] > at(29.00)[0], true)

  // Degenerate inputs must not produce an invalid scale.
  check('one term is a scale of one colour', oraColorScale([5]).length, 2)
  check('and all-equal terms too', oraColorScale([3, 3, 3]).map(s => s[0]), [0, 1])
  check('nothing at all still gives Plotly something', oraColorScale([]).length, 2)
  // Two terms sharing a p-value are one stop; the darker wins, so the ramp
  // still ends where it should.
  const dup = oraColorScale([2, 2, 9])
  check('a repeated value collapses to one stop',
    dup.every(([p], i) => i === 0 || p > dup[i - 1][0]), true)
  check('and the ramp still reaches the dark end',
    dup[dup.length - 1][1], 'rgb(128, 0, 38)')
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll ORA tests passed\n')
process.exit(failed ? 1 : 0)
