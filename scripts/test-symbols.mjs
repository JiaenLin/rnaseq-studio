// Accession -> symbol, for a bundle that carries only accessions.
//
// The risk here is not the lookup, it is what the lookup is allowed to do to
// somebody's data. Renaming every gene in a matrix is a large act, and two of
// the ways it can go wrong are silent: merging two genes under one symbol, and
// losing the accession so a row can no longer be found by the only identifier
// that is stable. Most of what follows is about those.

import { applySymbols, parseSymbols, symbolNeed } from '../src/lib/symbols.ts'
import { pack } from './fetch-symbols.mjs'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const ens = (n, mouse = false) => `ENS${mouse ? 'MUS' : ''}G${String(n).padStart(11, '0')}`

/** The real packer, so the parser is tested against the format that ships. */
const mapOf = (pairs, species = 'human') => parseSymbols(
  pack(pairs, { species, prefix: species === 'mouse' ? 'ENSMUSG' : 'ENSG', release: 'Ensembl 116' }).text)

console.log('\nTHE PACKED MAP')
{
  const m = mapOf([[ens(141510), 'TP53'], [ens(136997), 'MYC'], ['LRG_321', 'TP53-LRG']])
  check('species and release survive the round trip', [m.species, m.release], ['human', 'Ensembl 116'])
  check('every entry is counted', m.size, 3)
  check('a canonical id maps', m.get(ens(141510)), 'TP53')
  // Version suffixes are routine in a counts matrix and are not part of the
  // identifier: ENSG00000141510.17 is TP53.
  check('a versioned id maps', m.get(`${ens(141510)}.17`), 'TP53')
  check('and whitespace does not stop it', m.get(` ${ens(136997)} `), 'MYC')
  check('a non-canonical id is kept in its own section', m.get('LRG_321'), 'TP53-LRG')
  check('case-insensitively', m.get('lrg_321'), 'TP53-LRG')
  check('an id the map does not have is undefined', m.get(ens(999)), undefined)
  check('a mouse id is not a human one', m.get(ens(141510, true)), undefined)

  const mm = mapOf([[ens(59552, true), 'Trp53']], 'mouse')
  check('the mouse map reads mouse ids', mm.get(ens(59552, true)), 'Trp53')
  check('and rejects a human one', mm.get(ens(141510)), undefined)

  let threw = ''
  try { parseSymbols('NOPE\thuman\tx\t0\t0\n') } catch (e) { threw = e.message }
  check('an unknown format says so', threw.includes('unknown symbol map format'), true)
  try { parseSymbols('SYM1\thuman\tx\t5\t0\n1\tA\n#\n') } catch (e) { threw = e.message }
  check('a truncated map is an error, not half a genome', threw.includes('carries'), true)
}

/** A bundle just complete enough for these functions. */
function mk(ids, names) {
  const index = new Map()
  ids.forEach((id, i) => { index.set(id.toUpperCase(), i); if (names[i]) index.set(names[i].toUpperCase(), i) })
  const counts = { geneIds: ids, geneNames: names, samples: ['s1'], values: new Float64Array(ids.length), index }
  return {
    meta: { conditions: [], contrasts: [] }, samples: [], counts,
    degByContrast: { c1: ids.map((id, i) => ({ gene_id: id, gene_name: names[i] || id, baseMean: 1, log2FoldChange: 0, lfcSE: 0, pvalue: 1, padj: 1 })) },
    enrichmentByContrast: {},
  }
}

console.log('\nWHICH BUNDLES NEED IT')
{
  const ids = Array.from({ length: 40 }, (_, i) => ens(i + 1))
  check('accessions with no names do', symbolNeed(mk(ids, ids.map(() => ''))).needed, true)
  check('and the species comes from the accessions',
    symbolNeed(mk(ids, ids.map(() => ''))).species, 'human')
  check('mouse accessions too',
    symbolNeed(mk(ids.map(x => x.replace('ENSG', 'ENSMUSG')), ids.map(() => ''))).species, 'mouse')

  // NOT "does it contain accessions". A bundle that carries symbols already is
  // fine however its ids are spelled, and replacing the exporter's own names
  // with Ensembl's would be a change nobody asked for.
  check('a bundle that already has symbols does not',
    symbolNeed(mk(ids, ids.map((_, i) => `GENE${i}`))).needed, false)
  // gene_name repeating gene_id is the shape an exporter writes when it has no
  // symbols, and is not a name.
  check('nor does gene_name repeating gene_id count as a name',
    symbolNeed(mk(ids, ids)).needed, true)
  check('a symbol-keyed bundle does not',
    symbolNeed(mk(['TP53', 'MYC', 'ACTB'], ['TP53', 'MYC', 'ACTB'])).needed, false)
}

console.log('\nWHAT THE CONVERSION IS ALLOWED TO DO')
{
  const ids = [ens(1), ens(2), ens(3), ens(4)]
  const b = mk(ids, ['', '', '', ''])
  // Two accessions on one symbol — which really happens — and one Ensembl has
  // no name for at all.
  const map = mapOf([[ens(1), 'TP53'], [ens(2), 'MYC'], [ens(3), 'MYC']])
  const { bundle: out, report } = applySymbols(b, map)

  check('named rows are named', out.counts.geneNames, ['TP53', 'MYC', 'MYC', ''])
  check('the report counts them', [report.mapped, report.unmapped, report.total], [3, 1, 4])
  check('and counts the collision rather than hiding it', report.duplicated, 2)
  check('the release is carried through for the banner', report.release, 'Ensembl 116')

  // NOTHING IS MERGED. Both rows survive, in their own place, with their own
  // measurements — the failure this test exists for is one of them vanishing.
  check('no row is lost', out.counts.geneIds, ids)
  check('and the DEG table keeps all four', out.degByContrast.c1.length, 4)
  check('with their symbols', out.degByContrast.c1.map(r => r.gene_name),
    ['TP53', 'MYC', 'MYC', ens(4)])

  // THE ACCESSION IS NEVER LOST. A symbol is not a stable identifier, and after
  // a rename the accession is the only thing that still names one exact row.
  check('every accession still finds its own row',
    ids.map(id => out.counts.index.get(id.toUpperCase())), [0, 1, 2, 3])
  check('a symbol finds a row', out.counts.index.get('TP53'), 0)
  // A symbol naming two rows resolves to one of them, and it must be the first
  // rather than whichever happened to be written last.
  check('a shared symbol resolves to the first of them', out.counts.index.get('MYC'), 1)
  check('an unmapped row keeps its accession as its name', out.counts.geneNames[3], '')

  // The raw matrix is renamed too, or a DESeq2 run performed here would come
  // back in accessions while the rest of the app spoke symbols.
  const withRaw = { ...b, rawCounts: b.counts }
  check('raw counts are renamed as well',
    applySymbols(withRaw, map).bundle.rawCounts.geneNames, ['TP53', 'MYC', 'MYC', ''])
}

console.log('\nA BUNDLE THAT WAS ALREADY FINE IS LEFT ALONE')
{
  const b = mk([ens(1), ens(2)], ['Tp53', 'Myc'])
  const map = mapOf([[ens(1), 'SOMETHING_ELSE']])
  const { bundle: out } = applySymbols(b, map)
  // applySymbols is only reached when symbolNeed said so; if it is called
  // anyway, Ensembl wins for the rows it knows — but symbolNeed is what keeps
  // that from happening to a named bundle.
  check('symbolNeed is the guard, and it says no', symbolNeed(b).needed, false)
  check('the untouched row keeps the exporter’s name', out.counts.geneNames[1], 'Myc')
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll symbol tests passed\n')
process.exit(failed ? 1 : 0)
