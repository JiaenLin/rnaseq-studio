// The gene-set library: the shipped collections, and the sets a reader brings.
//
// Two things are pinned here that cannot be checked by looking at the screen.
//
// The MANIFEST and the ASSETS have to agree. They are produced by two different
// scripts — fetch-genesets.mjs packs the .gs files and writes the manifest,
// derive-metabolic.mjs assembles the Metabolic library out of the others — and
// the app trusts the manifest's counts before it has downloaded anything. A
// collection whose file says 2 610 sets while the manifest says 2 600 is a
// number on a chip that is quietly wrong.
//
// And the PARSER has to read what people actually paste. It replaced a
// GMT-only reader, so its whole value is in the shapes GMT is not.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'fflate'
import { collectionToText, indexFor, parse, parseSets } from '../src/lib/msigdb.ts'
import { oraIndexed } from '../src/lib/ora.ts'
import { MSIGDB_COLLECTIONS } from '../src/lib/methods.ts'

const DIR = 'public/genesets'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const readCollection = file =>
  parse(new TextDecoder().decode(gunzipSync(readFileSync(join(DIR, file)))))

console.log('\nTHE MANIFEST DESCRIBES THE FILES ON DISK')
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))
{
  const listed = new Set()
  for (const [sp, spec] of Object.entries(manifest.species)) {
    for (const s of spec.sources) {
      listed.add(s.file)
      const at = join(DIR, s.file)
      if (!existsSync(at)) { failed++; console.log(`  FAIL ${sp} ${s.source}: ${s.file} is missing`); continue }
      const c = readCollection(s.file)
      check(`${sp} ${s.source}: ${s.nSets} sets`, c.sets.length, s.nSets)
      check(`${sp} ${s.source}: ${s.nGenes} symbols`, c.symbols.length, s.nGenes)
    }
  }
  // The other direction, which is the one that fails silently: a collection
  // packed into public/ but never named in the manifest is downloaded by
  // nobody and offered nowhere. That is how a collection goes missing.
  const onDisk = readdirSync(DIR).filter(f => f.endsWith('.gs'))
  check('every packed collection is offered', onDisk.filter(f => !listed.has(f)), [])
}

console.log('\nTHE METABOLIC LIBRARY STANDS ON ITS OWN')
{
  // Assembled from the pathway collections and GO rather than published by
  // MSigDB, so it carries its own ids — which is the whole reason it is a
  // collection rather than a fold of the others. If the prefix were dropped,
  // `indexFor`'s one-id-one-test rule would delete it wherever a parent was on.
  for (const sp of ['human', 'mouse']) {
    const src = manifest.species[sp].sources.find(s => s.source === 'Metabolic')
    check(`${sp} offers Metabolic`, !!src, true)
    if (!src) continue
    check(`${sp} Metabolic names its parents`, src.derived.length > 0, true)
    check(`${sp} Metabolic is off by default`, src.on, false)
    const c = readCollection(src.file)
    check(`${sp} Metabolic ids are all its own`,
      c.sets.every(s => s.id.startsWith('METABOLIC_')), true)
    // The parent id is recoverable, so a hit stays citable as the pathway it is.
    check(`${sp} Metabolic keeps the parent id readable`,
      c.sets.some(s => s.id.slice('METABOLIC_'.length).startsWith('KEGG')
        || s.id.slice('METABOLIC_'.length).startsWith('REACTOME')), true)
  }
}

console.log('\nONE ID, ONE TEST')
{
  // What the guard in indexFor is for: not MSigDB, whose collections never
  // share an id, but a reader whose own paste repeats a set MSigDB already has.
  // Without it the same pathway is tested twice and enters the
  // Benjamini–Hochberg correction twice, for one biological statement.
  const mine = parseSets('HALLMARK_GLYCOLYSIS: G1, G2, G3\nMy own: G4, G5', 'Mine')
  const theirs = parseSets('HALLMARK_GLYCOLYSIS: G1, G2, G3, G6', 'Theirs')
  const bg = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'ZZ']
  const idx = indexFor([mine, theirs], bg)
  check('a repeated id is indexed once', idx.sets.filter(s => s.id === 'HALLMARK_GLYCOLYSIS').length, 1)
  check('and it is the first collection\'s copy',
    idx.sets.find(s => s.id === 'HALLMARK_GLYCOLYSIS').source, 'Mine')
  check('the sets that are not repeated all survive', idx.sets.length, 2)
  // And it reaches the test: a doubled set would appear twice in the results.
  const res = oraIndexed(['G1', 'G2', 'G3'], idx, { minSize: 1, maxSize: 100 })
  check('so ORA reports it once', res.filter(r => r.id === 'HALLMARK_GLYCOLYSIS').length, 1)
}

console.log('\nTHE PARSER READS WHAT PEOPLE ACTUALLY PASTE')
{
  const names = c => c.sets.map(s => s.name)
  const genes = (c, i) => Array.from(c.sets[i].genes, g => c.symbols[g])

  // 1. A Python dict out of a notebook — trailing comma, a variable name in
  //    front, newlines inside the lists. Not JSON, and nobody should be told so.
  const py = parseSets(`pathway_genes = {
    "TCA cycle": ["Cs", "Aco2",
                  "Idh2"],
    'Glycolysis': ['Hk1', 'Pkm'],   # the ones we care about
}`)
  check('python dict: both sets', names(py), ['TCA cycle', 'Glycolysis'])
  check('python dict: members across a line break', genes(py, 0), ['Cs', 'Aco2', 'Idh2'])

  // 2. R, where the members come wrapped in c().
  const r = parseSets('sets <- list("BCAA" = c("Bcat2", "Bckdha"), "TCA" = c(Cs, Aco2))')
  check('R list: both sets', names(r), ['BCAA', 'TCA'])
  check('R list: c() is the function, not a gene', genes(r, 1), ['Cs', 'Aco2'])

  // 3. Strict JSON, in the record shape as well as the dict shape.
  const j = parseSets('[{"name":"A","genes":["X","Y"]},{"name":"B","genes":["Z"]}]')
  check('JSON records', [names(j), genes(j, 0)], [['A', 'B'], ['X', 'Y']])

  // 4. A GMT, and a spreadsheet paste, which differ only in whether the second
  //    column is a description.
  const gmt = parseSets('SET_ONE\thttp://example.org\tA\tB\nSET_TWO\t\tC\tD')
  check('GMT: the description column is dropped', [genes(gmt, 0), genes(gmt, 1)], [['A', 'B'], ['C', 'D']])
  const xls = parseSets('Set one\tA\tB\nSet two\tC\tD')
  check('spreadsheet: the second column is a gene', genes(xls, 0), ['A', 'B'])

  // 5. What people type, which is what the Gene sets tab has always accepted.
  const lines = parseSets('Inflammation: TP53, IL6, TNF\nProliferation: MYC MKI67')
  check('typed lines', [names(lines), genes(lines, 1)], [['Inflammation', 'Proliferation'], ['MYC', 'MKI67']])

  // 6. No names at all — one set out of a pasted gene list.
  const bare = parseSets('TP53\nIL6\nTNF', 'From the paper')
  check('a bare list is one set', [names(bare), genes(bare, 0)], [['From the paper'], ['TP53', 'IL6', 'TNF']])

  // Duplicates resolve the way the languages the input was written in resolve
  // them: JSON.parse has already taken the last one before we are called, so
  // every other path has to agree with that or the same input gives two
  // different answers depending on its syntax.
  const dup = parseSets('A: X, Y\nA: Z')
  check('a repeated name replaces', [names(dup), genes(dup, 0)], [['A'], ['Z']])

  // Members are deduplicated within a set, because K is a count of distinct
  // genes and a repeat would inflate it.
  const rep = parseSets('A: X, X, Y')
  check('a repeated member is one member', genes(rep, 0), ['X', 'Y'])

  let threw = ''
  try { parseSets('   ') } catch (e) { threw = e.message }
  check('an empty paste says so', threw.includes('nothing to read'), true)
}

console.log('\nTHE EDITOR READS ITS OWN OUTPUT BACK')
{
  // The round trip is what makes a custom collection editable rather than
  // delete-and-retype: the chip opens the collection as text, and what comes
  // back has to be the same sets with the same members in the same order.
  const src = parseSets(`{"TCA cycle": ["Cs", "Aco2"], "Glycolysis": ["Hk1", "Pkm", "Gpi1"]}`, 'Mine')
  const back = parseSets(collectionToText(src), 'Mine')
  const shape = c => c.sets.map(s => [s.name, Array.from(s.genes, g => c.symbols[g])])
  check('same sets, same members, same order', shape(back), shape(src))
}

console.log('\nTHE METHODS TEXT KNOWS EVERY COLLECTION')
{
  // sourceRef falls through to no citation for a source it does not recognise,
  // which is right for a collection the reader brought and wrong for one this
  // app ships — a shipped collection uncited is a gap in a Methods section
  // nobody is told about. So the two lists have to agree.
  const offered = new Set()
  for (const spec of Object.values(manifest.species)) for (const s of spec.sources) offered.add(s.source)
  check('every offered collection is citable', [...offered].filter(s => !MSIGDB_COLLECTIONS.has(s)), [])
  check('and nothing is claimed that is not offered',
    [...MSIGDB_COLLECTIONS].filter(s => !offered.has(s)), [])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll gene set tests passed\n')
process.exit(failed ? 1 : 0)
