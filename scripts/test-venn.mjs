// The set algebra and the geometry behind the Overlap tab.
//
// The geometry checks are the point of this file. A four-set Venn is only a Venn
// if all fifteen regions exist in the drawing, and nothing about the rendering
// code says whether they do — it is a property of four ellipse parameters, and
// nudging one makes a region vanish with no error anywhere. The first version of
// this layout was missing two of them and looked perfectly fine.

import {
  VENN_MAX, VENN_SHAPES, computeOverlap, maskMembers, overlapCsv, overlapSources,
  regionAnchors, regionLabel, shapeContains, significantGenes,
} from '../src/lib/venn.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}
const ok = (name, cond, detail = '') => check(name + (detail ? ` (${detail})` : ''), !!cond, true)

const THR = { padjMax: 0.05, lfcMin: 1, direction: 'both', concordantOnly: false }
const row = (id, lfc, padj, name = id) =>
  ({ gene_id: id, gene_name: name, baseMean: 100, log2FoldChange: lfc, lfcSE: 0.1, pvalue: padj / 10, padj })

console.log('\nEVERY REGION OF EVERY LAYOUT EXISTS')
{
  for (const n of [2, 3, VENN_MAX]) {
    const shapes = VENN_SHAPES[n]
    check(`a layout is defined for ${n} sets`, shapes?.length, n)
    const anchors = regionAnchors(shapes, 241)
    check(`all ${(1 << n) - 1} regions are drawable with ${n} sets`, anchors.size, (1 << n) - 1)

    // Existing is not enough — a region one pixel across cannot hold its count.
    // 0.4% of the figure is roughly a 30px square at the size this renders at.
    const areas = [...anchors.values()].map(a => a.area)
    ok(`no region is a sliver with ${n} sets`, Math.min(...areas) > 0.004,
      `smallest ${(Math.min(...areas) * 100).toFixed(2)}%`)
    // And the label goes at the deepest point, which has to be deep enough that
    // a two-line-high pill sits inside the region rather than across its edge.
    const depths = [...anchors.values()].map(a => a.depth)
    ok(`every count has room with ${n} sets`, Math.min(...depths) > 0.025,
      `shallowest ${Math.min(...depths).toFixed(3)}`)
    // Nothing may fall outside the unit box, or it renders off the figure.
    ok(`every anchor is inside the box with ${n} sets`,
      [...anchors.values()].every(a => a.x > 0 && a.x < 1 && a.y > 0 && a.y < 1))
  }
}

console.log('\nTHE ELLIPSE ROTATION GOES THE WAY SVG GOES')
{
  // rotate() in SVG turns clockwise, because y points down. Get the sign wrong
  // and the four-set figure mirrors — still a Venn, still all fifteen regions,
  // and the legend now names the circles in the wrong order.
  const e = { kind: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.05, rot: 45 }
  ok('the long axis runs down-right at +45°', shapeContains(e, 0.5 + 0.2, 0.5 + 0.2))
  ok('and not up-right', !shapeContains(e, 0.5 + 0.2, 0.5 - 0.2))
  const c = { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.25 }
  check('a circle is a circle', [shapeContains(c, 0.7, 0.5), shapeContains(c, 0.8, 0.5)], [true, false])
}

console.log('\nWHAT COUNTS AS SIGNIFICANT')
{
  const rows = [
    row('A', 2, 0.01),        // in
    row('B', -2, 0.01),       // in, down
    row('C', 0.5, 0.001),     // effect too small
    row('D', 3, 0.2),         // not significant
    row('E', 2, null),        // padj NA — DESeq2 filters these out itself
    row('F', 2, 0.05),        // exactly at the cutoff: padj < 0.05 is exclusive
  ]
  check('thresholds', [...significantGenes(rows, THR).keys()], ['A', 'B'])
  check('up only', [...significantGenes(rows, { ...THR, direction: 'up' }).keys()], ['A'])
  check('down only', [...significantGenes(rows, { ...THR, direction: 'down' }).keys()], ['B'])
  check('a looser effect cutoff lets C in',
    [...significantGenes(rows, { ...THR, lfcMin: 0.4 }).keys()], ['A', 'B', 'C'])

  // A results table can list the same gene twice. Whichever row is kept decides
  // the numbers shown for it, so it is the stronger one rather than the last.
  const dup = [row('A', 1.2, 0.04), row('A', 3.5, 0.001)]
  check('a duplicated gene keeps its strongest row',
    significantGenes(dup, THR).get('A').log2FoldChange, 3.5)
}

console.log('\nREGIONS ARE EXCLUSIVE, AND THEY ADD UP')
{
  const mk = (label, rows) => ({ key: label, label, numerator: 'T', denominator: 'C', origin: 'bundle', rows })
  const sources = [
    mk('A', [row('g1', 2, 0.01), row('g2', 2, 0.01), row('g3', 2, 0.01)]),
    mk('B', [row('g2', 2, 0.01), row('g3', 2, 0.01), row('g4', 2, 0.01)]),
    mk('C', [row('g3', 2, 0.01), row('g4', 2, 0.01), row('g5', 2, 0.01)]),
  ]
  const r = computeOverlap(sources, THR)
  check('each set keeps its own size', r.sizes, [3, 3, 3])
  check('the union is every gene once', r.union, 5)
  check('all 7 regions are reported, empty ones included', r.regions.length, 7)
  check('the exclusive counts sum to the union',
    r.regions.reduce((a, x) => a + x.count, 0), 5)
  check('g3 is in all three', r.byMask.get(0b111).genes.map(g => g.gene), ['g3'])
  check('g1 is A alone', r.byMask.get(0b001).genes.map(g => g.gene), ['g1'])
  check('g4 is B and C but not A', r.byMask.get(0b110).genes.map(g => g.gene), ['g4'])
  check('nothing is in A and C without B', r.byMask.get(0b101).count, 0)
  check('a region nobody occupies is still listed',
    r.regions.some(x => x.mask === 0b101 && x.count === 0), true)
  check('members are indices, ascending', maskMembers(0b1011, 4), [0, 1, 3])
}

console.log('\nA GENE THAT GOES UP HERE AND DOWN THERE')
{
  // The reason `concordantOnly` exists. On a 2x2, "significant in both" merges
  // the genes a treatment raises in one background with the ones it lowers in
  // the other — opposite biology, same wedge.
  const mk = (label, rows) => ({ key: label, label, numerator: 'T', denominator: 'C', origin: 'bundle', rows })
  const sources = [
    mk('cold', [row('shared', 2, 0.01), row('flip', 2.5, 0.01)]),
    mk('warm', [row('shared', 1.8, 0.01), row('flip', -2.2, 0.01)]),
  ]
  const loose = computeOverlap(sources, THR)
  check('both land in the intersection by default', loose.byMask.get(0b11).count, 2)
  check('and nothing is set aside', loose.discordant, 0)

  const strict = computeOverlap(sources, { ...THR, concordantOnly: true })
  check('asking for one direction leaves only the concordant gene',
    strict.byMask.get(0b11).genes.map(g => g.gene), ['shared'])
  check('the discordant one is counted, not silently dropped', strict.discordant, 1)
  check('and it is gone from the per-set sizes too', strict.sizes, [1, 1])

  // A gene significant in ONE comparison has nothing to disagree with.
  const single = computeOverlap(
    [mk('a', [row('solo', -3, 0.01)]), mk('b', [row('other', 3, 0.01)])],
    { ...THR, concordantOnly: true })
  check('a gene in one set only is never discordant', single.discordant, 0)
  check('and it keeps its region', single.union, 2)
}

console.log('\nGENE IDENTITY IS THE ACCESSION, NOT THE SYMBOL')
{
  // A run performed here comes back with gene_name === gene_id until the symbols
  // are put back; the pipeline's table has them. Keying on the symbol would make
  // those two tables share nothing at all.
  const mk = (label, rows) => ({ key: label, label, numerator: 'T', denominator: 'C', origin: 'bundle', rows })
  const r = computeOverlap([
    mk('pipeline', [row('ENSG01', 2, 0.01, 'TP53')]),
    mk('run here', [row('ENSG01', 2.1, 0.02, 'ENSG01')]),
  ], THR)
  check('the same accession is one gene', r.union, 1)
  check('it is in both', r.byMask.get(0b11).count, 1)
  check('and the symbol is the one somebody knows', r.genes[0].label, 'TP53')
}

console.log('\nHOW A WEDGE READS')
{
  const s = [{ label: 'KO vs WT (cold)' }, { label: 'KO vs WT (warm)' }, { label: 'cold vs warm' }]
  check('one set', regionLabel([1], s), 'only KO vs WT (warm)')
  check('two of three', regionLabel([0, 2], s), 'KO vs WT (cold) ∩ cold vs warm, and no other')
  check('all of them', regionLabel([0, 1, 2], s), 'shared by all 3')
}

console.log('\nTHE EXPORT SAYS WHAT IS MISSING WITHOUT SAYING ZERO')
{
  const mk = (label, rows) => ({ key: label, label, numerator: 'T', denominator: 'C', origin: 'bundle', rows })
  const sources = [
    mk('A, at 4°C', [row('g1', 2, 0.01), row('g2', -1.5, 0.002)]),
    mk('B', [row('g2', -1.4, 0.003)]),
  ]
  const r = computeOverlap(sources, THR)
  const csv = overlapCsv(sources, r.genes).trim().split('\n')
  check('a label with a comma is quoted',
    csv[0], 'gene_id,gene_name,region,n_comparisons,"A, at 4°C log2FC","A, at 4°C padj",B log2FC,B padj')
  // Compared whole rather than split on commas — the region cell contains one.
  check('a comparison that did not call the gene leaves the cells blank',
    csv.find(l => l.startsWith('g1')), 'g1,g1,"A, at 4°C",1,2.0000,0.01000,,')
  check('a shared gene names both comparisons and carries both sets of numbers',
    csv.find(l => l.startsWith('g2')), 'g2,g2,"A, at 4°C ∩ B",2,-1.5000,0.002000,-1.4000,0.003000')
  check('widest agreement is exported first', csv[1].slice(0, 2), 'g2')
}

console.log('\nWHAT THE TAB IS ALLOWED TO OFFER')
{
  const contrasts = [
    { id: 'c1', label: 'KO vs WT (cold)', numerator: 'KO_Cold', denominator: 'WT_Cold' },
    { id: 'c2', label: 'KO vs WT (warm)', numerator: 'KO_Warm', denominator: 'WT_Warm' },
    { id: 'c3', label: 'interaction', numerator: 'KO:Warm', denominator: 'interaction' },
    { id: 'c4', label: 'never exported', numerator: 'X', denominator: 'Y' },
  ]
  const deg = { c1: [row('g1', 2, 0.01)], c2: [row('g1', 2, 0.01)], c3: [row('g2', 2, 0.01)], c4: [] }
  const plain = overlapSources(contrasts, deg)
  check('a contrast with no table is not offered', plain.map(s => s.key), ['c1', 'c2', 'c3'])
  // An interaction coefficient cannot be tied to samples, which is a rule about
  // per-sample plots. This figure draws no samples.
  check('an interaction term is offered like any other', plain[2].label, 'interaction')

  const withRuns = overlapSources(contrasts, deg,
    { 'KO_Cold+KO_Warm|WT_Cold+WT_Warm': [row('g3', 2, 0.01)] },
    { 'KO_Cold+KO_Warm|WT_Cold+WT_Warm': { test: ['KO_Cold', 'KO_Warm'], control: ['WT_Cold', 'WT_Warm'], excluded: [] } })
  check('a run performed here joins the list', withRuns.length, 4)
  check('named by what it compared', withRuns[3].label, 'KO_Cold + KO_Warm vs WT_Cold + WT_Warm')
  check('and marked as a run', withRuns[3].origin, 'computed')

  // Two runs of the same pair with different samples dropped are different
  // results. A legend calling them both "KO vs WT" is uninterpretable.
  const excl = overlapSources([], {},
    { k1: [row('g', 2, 0.01)], k2: [row('g', 2, 0.01)] },
    {
      k1: { test: ['KO'], control: ['WT'], excluded: ['KO_3'] },
      k2: { test: ['KO'], control: ['WT'], excluded: ['KO_1', 'KO_2', 'KO_3'] },
    })
  check('the exclusions are part of the name',
    excl.map(s => s.label), ['KO vs WT — without KO_3', 'KO vs WT — without 3 samples'])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll Venn/overlap tests passed\n')
process.exit(failed ? 1 : 0)
