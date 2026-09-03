// The data space's contract with a hand-edited JSON file.
//
// The catalogue is meant to be editable by a person, which is the point of it
// and also the risk: a missing comma is a syntax error somebody sees, but a
// missing `url` is a row that renders and cannot be opened. So the parser is
// strict about the three fields a row cannot work without, lenient about the
// rest, and drops rather than throws — one bad entry must not cost the reader
// the other twenty.

import { formatBytes, parseCatalogue, searchDatasets, speciesIn } from '../src/lib/catalogue.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const entry = (o = {}) => ({ slug: 's', title: 'T', url: 'u.zip', species: 'mouse', ...o })

console.log('\nWHAT A ROW MUST CARRY')
{
  const full = {
    name: 'Atlas', updated: '2026-09-03',
    datasets: [entry({ slug: 'a', description: 'd', bytes: 1500, samples: 16, genes: 20000,
      conditions: ['WT', 'KO'], contrasts: ['KO vs WT'], source: 'Lin lab', published: '2026-08-14' })],
  }
  const { catalogue, dropped } = parseCatalogue(full)
  check('a complete entry survives whole', catalogue.datasets[0], {
    slug: 'a', title: 'T', url: 'u.zip', species: 'mouse', description: 'd', bytes: 1500,
    samples: 16, genes: 20000, conditions: ['WT', 'KO'], contrasts: ['KO vs WT'],
    source: 'Lin lab', published: '2026-08-14',
  })
  check('and the catalogue keeps its own fields', [catalogue.name, catalogue.updated], ['Atlas', '2026-09-03'])
  check('nothing was dropped', dropped, 0)

  // The three that make a row openable. Anything else missing is cosmetic.
  for (const [what, bad] of [
    ['no slug', { title: 'T', url: 'u' }],
    ['no url', { slug: 's', title: 'T' }],
    ['no title', { slug: 's', url: 'u' }],
    ['a blank slug', { slug: '   ', title: 'T', url: 'u' }],
  ]) {
    const r = parseCatalogue({ datasets: [bad] })
    check(`${what} is dropped, not rendered`, [r.catalogue.datasets.length, r.dropped], [0, 1])
  }

  // A duplicate slug is two rows with one React key and two URLs behind one id.
  const dup = parseCatalogue({ datasets: [entry({ url: 'a.zip' }), entry({ url: 'b.zip' })] })
  check('a repeated slug keeps the first only', dup.catalogue.datasets.map(d => d.url), ['a.zip'])
  check('and says one was dropped', dup.dropped, 1)

  check('one bad row does not cost the good ones',
    parseCatalogue({ datasets: [entry({ slug: 'a' }), { nonsense: true }, entry({ slug: 'b' })] })
      .catalogue.datasets.map(d => d.slug), ['a', 'b'])

  // A bare array is the shape people write first, before they know there is a
  // wrapper object. Refusing it would be pedantry.
  check('a bare array is accepted', parseCatalogue([entry()]).catalogue.datasets.length, 1)
  check('so is nothing at all', parseCatalogue(null).catalogue.datasets, [])
  check('and a wrong-typed datasets field', parseCatalogue({ datasets: 'no' }).catalogue.datasets, [])

  // Types are checked, not coerced: "16" samples would render as 16 and sort as
  // a string, and a negative size is a typo rather than a size.
  const junk = parseCatalogue({ datasets: [entry({ samples: '16', bytes: -3, conditions: 'WT' })] })
  check('a mistyped field is dropped, not coerced',
    [junk.catalogue.datasets[0].samples, junk.catalogue.datasets[0].bytes,
      junk.catalogue.datasets[0].conditions], [undefined, undefined, undefined])
  check('but the row still opens', junk.catalogue.datasets[0].slug, 's')
  check('species defaults rather than blanking the chip',
    parseCatalogue({ datasets: [{ slug: 's', title: 'T', url: 'u' }] }).catalogue.datasets[0].species,
    'unknown')
}

console.log('\nFINDING ONE')
{
  const ds = [
    entry({ slug: 'a', title: 'Brown adipose, cold exposure', species: 'mouse',
      conditions: ['WT_Cold', 'KO_Cold'], contrasts: ['KO vs WT (cold)'] }),
    entry({ slug: 'b', title: 'Liver, high-fat diet', species: 'mouse', conditions: ['Chow', 'HFD'] }),
    entry({ slug: 'c', title: 'PBMC, vaccine response', species: 'human', conditions: ['D0', 'D7'] }),
  ]
  check('everything, by default', searchDatasets(ds, '').length, 3)
  check('by title', searchDatasets(ds, 'liver').map(d => d.slug), ['b'])
  // The way somebody looks for a dataset is "the one with the cold knockouts",
  // and those words are in the design rather than in the name.
  check('by a condition nobody put in the title', searchDatasets(ds, 'KO_Cold').map(d => d.slug), ['a'])
  check('by a contrast label', searchDatasets(ds, 'cold)').map(d => d.slug), ['a'])
  check('two terms narrow rather than widen',
    searchDatasets(ds, 'cold adipose').map(d => d.slug), ['a'])
  check('and a term nothing has finds nothing', searchDatasets(ds, 'kidney'), [])
  check('case does not matter', searchDatasets(ds, 'BROWN').map(d => d.slug), ['a'])
  check('species filters', searchDatasets(ds, '', 'human').map(d => d.slug), ['c'])
  check('and combines with the query', searchDatasets(ds, 'diet', 'human'), [])
  check('the chips offer only what is present', speciesIn(ds), ['human', 'mouse'])
}

console.log('\nSIZES A PERSON READS')
{
  check('megabytes above a megabyte', formatBytes(1563282), '1.6 MB')
  check('kilobytes below one', formatBytes(48200), '48 KB')
  // A row that says "0 KB" reads as broken; the smallest honest answer is 1.
  check('never zero', formatBytes(120), '1 KB')
  check('and nothing when there is no size', formatBytes(undefined), '')
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll catalogue tests passed\n')
process.exit(failed ? 1 : 0)
