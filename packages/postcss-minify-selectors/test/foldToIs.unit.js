'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const parser = require('postcss-selector-parser');
const tryFold = require('../src/lib/foldToIs.js');
const {
  _internal: {
    tokenize,
    hasPseudoElementOrNesting,
    hasNthChildOfClause,
    specificityOf,
    specificityOfMiddle,
    maxChildSpecificity,
    compareSpecificity,
    sameSpecificity,
  },
} = require('../src/lib/foldToIs.js');

const parseSelector = (s) => parser().astSync(s).nodes[0];
const parseRoot = (s) => parser().astSync(s);
const nodesOf = (s) => parseSelector(s).nodes;

// Mirror the combinator-space normalisation that the plugin performs before
// calling `tryFold`. Without this, `>` carries leading/trailing spaces from
// the raw input, which `tryFold` faithfully preserves.
const parseRootNormalized = (s) => {
  const root = parser().astSync(s);
  root.walkCombinators((n) => {
    n.spaces.before = '';
    n.spaces.after = '';
    n.rawSpaceBefore = '';
    n.rawSpaceAfter = '';
    const v = n.value.trim();
    n.value = v.length ? v : ' ';
  });
  return root;
};

// ---------------------------------------------------------------------------
// specificityOf — exhaustive per-branch coverage
// ---------------------------------------------------------------------------

test('specificityOf: empty list', () => {
  assert.deepEqual(specificityOf([]), [0, 0, 0]);
});

test('specificityOf: tag', () => {
  assert.deepEqual(specificityOf(nodesOf('div')), [0, 0, 1]);
});

test('specificityOf: class', () => {
  assert.deepEqual(specificityOf(nodesOf('.foo')), [0, 1, 0]);
});

test('specificityOf: attribute', () => {
  assert.deepEqual(specificityOf(nodesOf('[data-x]')), [0, 1, 0]);
});

test('specificityOf: attribute with value', () => {
  assert.deepEqual(specificityOf(nodesOf('[role=combobox]')), [0, 1, 0]);
});

test('specificityOf: id', () => {
  assert.deepEqual(specificityOf(nodesOf('#foo')), [1, 0, 0]);
});

test('specificityOf: universal contributes 0', () => {
  assert.deepEqual(specificityOf(nodesOf('*')), [0, 0, 0]);
});

test('specificityOf: pseudo-class :hover counts as class', () => {
  assert.deepEqual(specificityOf(nodesOf(':hover')), [0, 1, 0]);
});

test('specificityOf: unknown pseudo-class falls back to class', () => {
  assert.deepEqual(specificityOf(nodesOf(':--custom')), [0, 1, 0]);
});

test('specificityOf: ::before pseudo-element counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf('::before')), [0, 0, 1]);
});

test('specificityOf: ::after counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf('::after')), [0, 0, 1]);
});

test('specificityOf: ::backdrop counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf('::backdrop')), [0, 0, 1]);
});

test('specificityOf: legacy :before counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf(':before')), [0, 0, 1]);
});

test('specificityOf: legacy :after counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf(':after')), [0, 0, 1]);
});

test('specificityOf: legacy :first-letter counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf(':first-letter')), [0, 0, 1]);
});

test('specificityOf: legacy :first-line counts as type', () => {
  assert.deepEqual(specificityOf(nodesOf(':first-line')), [0, 0, 1]);
});

test('specificityOf: :where() contributes zero', () => {
  assert.deepEqual(specificityOf(nodesOf(':where(#a, .b, c)')), [0, 0, 0]);
});

test('specificityOf: :is() takes max — class wins over tag', () => {
  assert.deepEqual(specificityOf(nodesOf(':is(.a, b)')), [0, 1, 0]);
});

test('specificityOf: :is(tag) propagates type up via recursion', () => {
  assert.deepEqual(specificityOf(nodesOf(':is(div)')), [0, 0, 1]);
});

test('specificityOf: :not(tag) propagates type up via recursion', () => {
  assert.deepEqual(specificityOf(nodesOf(':not(div)')), [0, 0, 1]);
});

test('specificityOf: :has(tag) propagates type up via recursion', () => {
  assert.deepEqual(specificityOf(nodesOf(':has(div)')), [0, 0, 1]);
});

test('specificityOf: :is() takes max — id wins over class', () => {
  assert.deepEqual(specificityOf(nodesOf(':is(.a, #x)')), [1, 0, 0]);
});

test('specificityOf: :matches() (webkit alias) takes max', () => {
  assert.deepEqual(specificityOf(nodesOf(':matches(.a, #x)')), [1, 0, 0]);
});

test('specificityOf: :not() takes max', () => {
  assert.deepEqual(specificityOf(nodesOf(':not(.a, #x)')), [1, 0, 0]);
});

test('specificityOf: :has() takes max', () => {
  assert.deepEqual(specificityOf(nodesOf(':has(.a, #x)')), [1, 0, 0]);
});

test('specificityOf: nested :is(:not(#x)) recurses', () => {
  assert.deepEqual(specificityOf(nodesOf(':is(:not(#x))')), [1, 0, 0]);
});

test('specificityOf: :where wrapped in :is is still 0', () => {
  assert.deepEqual(specificityOf(nodesOf(':is(:where(#a, .b))')), [0, 0, 0]);
});

test('specificityOf: compound tag+class', () => {
  assert.deepEqual(specificityOf(nodesOf('div.foo')), [0, 1, 1]);
});

test('specificityOf: compound tag+attribute (issue #1784 case)', () => {
  assert.deepEqual(specificityOf(nodesOf('button[role=combobox]')), [0, 1, 1]);
});

test('specificityOf: compound id+class+tag', () => {
  assert.deepEqual(specificityOf(nodesOf('div.foo#bar')), [1, 1, 1]);
});

test('specificityOf: many of each adds up', () => {
  assert.deepEqual(specificityOf(nodesOf('a.b.c[d][e]:hover')), [0, 5, 1]);
});

// ---------------------------------------------------------------------------
// hasPseudoElementOrNesting
// ---------------------------------------------------------------------------

const compoundOf = (s) => ({
  kind: 'compound',
  str: s,
  nodes: nodesOf(s),
});

test('hasPseudoElementOrNesting: combinator returns false', () => {
  assert.equal(hasPseudoElementOrNesting({ kind: 'combinator', str: '>' }), false);
});

test('hasPseudoElementOrNesting: tag is fine', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('div')), false);
});

test('hasPseudoElementOrNesting: class is fine', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('.foo')), false);
});

test('hasPseudoElementOrNesting: pseudo-class :hover is fine', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('a:hover')), false);
});

test('hasPseudoElementOrNesting: ::before flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('a::before')), true);
});

test('hasPseudoElementOrNesting: ::after flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('a::after')), true);
});

test('hasPseudoElementOrNesting: ::backdrop flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('::backdrop')), true);
});

test('hasPseudoElementOrNesting: legacy :before flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('a:before')), true);
});

test('hasPseudoElementOrNesting: legacy :after flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('a:after')), true);
});

test('hasPseudoElementOrNesting: legacy :first-letter flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('p:first-letter')), true);
});

test('hasPseudoElementOrNesting: legacy :first-line flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('p:first-line')), true);
});

test('hasPseudoElementOrNesting: nesting & flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('&')), true);
});

test('hasPseudoElementOrNesting: compound with & flagged', () => {
  assert.equal(hasPseudoElementOrNesting(compoundOf('&.foo')), true);
});

// ---------------------------------------------------------------------------
// hasNthChildOfClause
// ---------------------------------------------------------------------------

test('hasNthChildOfClause: combinator returns false', () => {
  assert.equal(hasNthChildOfClause({ kind: 'combinator', str: '>' }), false);
});

test('hasNthChildOfClause: plain compound is false', () => {
  assert.equal(hasNthChildOfClause(compoundOf('div.foo')), false);
});

test('hasNthChildOfClause: :nth-child(2n+1) without of returns false', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':nth-child(2n+1)')), false);
});

test('hasNthChildOfClause: :nth-child(odd) without of returns false', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':nth-child(odd)')), false);
});

test('hasNthChildOfClause: :nth-child(2n of .a) flagged', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':nth-child(2n of .a)')), true);
});

test('hasNthChildOfClause: :nth-child(odd of div) flagged', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':nth-child(odd of div)')), true);
});

test('hasNthChildOfClause: :nth-last-child(2n of .a) flagged', () => {
  assert.equal(
    hasNthChildOfClause(compoundOf(':nth-last-child(2n of .a)')),
    true
  );
});

test('hasNthChildOfClause: :nth-of-type(2n) — not nth-child, false', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':nth-of-type(2n)')), false);
});

test('hasNthChildOfClause: :hover is false', () => {
  assert.equal(hasNthChildOfClause(compoundOf(':hover')), false);
});

test('hasNthChildOfClause: tag named `of` outside :nth-child is false', () => {
  // Make sure the inner-tag check is properly scoped to :nth-child / :nth-last-child.
  assert.equal(hasNthChildOfClause(compoundOf(':is(of)')), false);
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

test('tokenize: single compound', () => {
  const t = tokenize(parseSelector('div.foo'));
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'compound');
  assert.equal(t[0].str, 'div.foo');
});

test('tokenize: descendant combinator', () => {
  const t = tokenize(parseSelector('.a .b'));
  assert.deepEqual(
    t.map((x) => [x.kind, x.str]),
    [
      ['compound', '.a'],
      ['combinator', ' '],
      ['compound', '.b'],
    ]
  );
});

test('tokenize: child combinator (preserves raw spacing)', () => {
  const t = tokenize(parseSelector('.a > .b'));
  assert.equal(t.length, 3);
  assert.equal(t[0].kind, 'compound');
  assert.equal(t[0].str, '.a');
  assert.equal(t[1].kind, 'combinator');
  assert.match(t[1].str, />/);
  assert.equal(t[2].kind, 'compound');
  assert.equal(t[2].str, '.b');
});

test('tokenize: multiple combinators', () => {
  const t = tokenize(parseSelector('.a > .b + .c ~ .d'));
  assert.equal(t.length, 7);
  assert.equal(t[0].str, '.a');
  assert.equal(t[2].str, '.b');
  assert.equal(t[4].str, '.c');
  assert.equal(t[6].str, '.d');
  assert.equal(t[1].kind, 'combinator');
  assert.equal(t[3].kind, 'combinator');
  assert.equal(t[5].kind, 'combinator');
});

test('tokenize: empty selector returns empty list', () => {
  const empty = parser.selector({ value: '' });
  assert.deepEqual(tokenize(empty), []);
});

// ---------------------------------------------------------------------------
// specificityOfMiddle — sums per-token specificity
// ---------------------------------------------------------------------------

test('specificityOfMiddle: sums compound specificities', () => {
  const middle = tokenize(parseSelector('.a div.foo'));
  // .a (0,1,0) + descendant (0) + div.foo (0,1,1) = (0,2,1)
  assert.deepEqual(specificityOfMiddle(middle), [0, 2, 1]);
});

test('specificityOfMiddle: combinator tokens contribute zero', () => {
  const middle = tokenize(parseSelector('.a > .b + .c'));
  assert.deepEqual(specificityOfMiddle(middle), [0, 3, 0]);
});

test('specificityOfMiddle: id contributes', () => {
  const middle = tokenize(parseSelector('#x .y'));
  assert.deepEqual(specificityOfMiddle(middle), [1, 1, 0]);
});

test('specificityOfMiddle: type contributes', () => {
  const middle = tokenize(parseSelector('div > span'));
  assert.deepEqual(specificityOfMiddle(middle), [0, 0, 2]);
});

// ---------------------------------------------------------------------------
// compareSpecificity / sameSpecificity
// ---------------------------------------------------------------------------

test('compareSpecificity: id outranks any number of classes', () => {
  assert.equal(compareSpecificity([1, 0, 0], [0, 99, 99]) > 0, true);
});

test('compareSpecificity: classes outrank any number of types', () => {
  assert.equal(compareSpecificity([0, 1, 0], [0, 0, 99]) > 0, true);
});

test('compareSpecificity: equal returns 0', () => {
  assert.equal(compareSpecificity([1, 2, 3], [1, 2, 3]), 0);
});

test('compareSpecificity: type tiebreak', () => {
  assert.equal(compareSpecificity([0, 0, 2], [0, 0, 1]) > 0, true);
});

test('sameSpecificity: identical', () => {
  assert.equal(sameSpecificity([1, 2, 3], [1, 2, 3]), true);
});

test('sameSpecificity: differ in id', () => {
  assert.equal(sameSpecificity([1, 0, 0], [0, 0, 0]), false);
});

test('sameSpecificity: differ in class', () => {
  assert.equal(sameSpecificity([0, 1, 0], [0, 0, 0]), false);
});

test('sameSpecificity: differ in type', () => {
  assert.equal(sameSpecificity([0, 0, 1], [0, 0, 0]), false);
});

// ---------------------------------------------------------------------------
// maxChildSpecificity
// ---------------------------------------------------------------------------

test('maxChildSpecificity: picks largest child', () => {
  const pseudo = parseRoot(':is(.a, #x, b)').nodes[0].nodes[0];
  assert.deepEqual(maxChildSpecificity(pseudo), [1, 0, 0]);
});

test('maxChildSpecificity: empty pseudo returns zero', () => {
  const pseudo = parseRoot(':is()').nodes[0].nodes[0];
  assert.deepEqual(maxChildSpecificity(pseudo), [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// tryFold — direct calls to exercise defensive guards
// ---------------------------------------------------------------------------

test('tryFold: returns null for single selector', () => {
  assert.equal(tryFold(parseRoot('.a .b')), null);
});

test('tryFold: returns null for two selectors with no shared prefix/suffix', () => {
  assert.equal(tryFold(parseRoot('.a, .b')), null);
});

test('tryFold: returns null when fold would not be shorter', () => {
  // 2 selectors with same-spec middle; folded form is longer than original
  assert.equal(tryFold(parseRoot('.x .a,.x .b')), null);
});

test('tryFold: folds when result is strictly shorter', () => {
  const out = tryFold(parseRoot('.x .a,.x .b,.x .c,.x .d'));
  assert.equal(out, '.x :is(.a,.b,.c,.d)');
});

test('tryFold: rejects mixed-specificity middles (issue #1784)', () => {
  const out = tryFold(parseRoot(
    '.x input,.x button[role=combobox],.x select,.x textarea'
  ));
  assert.equal(out, null);
});

test('tryFold: prefix only — folds shared prefix', () => {
  const out = tryFold(parseRoot('section h1,article h1,aside h1,nav h1'));
  assert.equal(out, ':is(section,article,aside,nav) h1');
});

test('tryFold: suffix only — folds shared suffix', () => {
  const out = tryFold(parseRoot('a .x,b .x,c .x,d .x'));
  assert.equal(out, ':is(a,b,c,d) .x');
});

test('tryFold: both prefix and suffix', () => {
  const out = tryFold(
    parseRoot('.nav .a .item,.nav .b .item,.nav .c .item,.nav .d .item')
  );
  assert.equal(out, '.nav :is(.a,.b,.c,.d) .item');
});

test('tryFold: dedupes identical middles', () => {
  const out = tryFold(parseRoot('.x .a .y,.x .a .y,.x .b .y,.x .c .y'));
  assert.equal(out, '.x :is(.a,.b,.c) .y');
});

test('tryFold: rejects when all middles are identical (after dedup < 2)', () => {
  // After dedup these are 1 unique middle
  assert.equal(tryFold(parseRoot('.x .a .y,.x .a .y')), null);
});

test('tryFold: rejects pseudo-element ::before in middle', () => {
  // Same-spec wouldn't fold because ::before sits in compound — guarded out.
  assert.equal(
    tryFold(parseRoot('.x ::before .y,.x ::after .y,.x ::backdrop .y,.x ::marker .y')),
    null
  );
});

test('tryFold: rejects nesting `&` in middle', () => {
  assert.equal(
    tryFold(parseRoot('.x & .y,.x .a .y,.x .b .y,.x .c .y')),
    null
  );
});

test('tryFold: prefix boundary backoff — does not split a compound', () => {
  // Both selectors begin with `.a` then diverge mid-compound.
  // No combinator boundary exists, so prefix should back off to 0.
  assert.equal(tryFold(parseRoot('.a.b,.a.c')), null);
});

test('tryFold: suffix boundary backoff — does not split a compound', () => {
  assert.equal(tryFold(parseRoot('.b.a,.c.a')), null);
});

test('tryFold: :where() middles all spec 0 — folds', () => {
  const out = tryFold(
    parseRoot(
      '.x :where(.a) .y,.x :where(.b) .y,.x :where(.c) .y,.x :where(.d) .y'
    )
  );
  assert.equal(out, '.x :is(:where(.a),:where(.b),:where(.c),:where(.d)) .y');
});

test('tryFold: :is(.a) vs :is(#x) differ in spec — rejects', () => {
  assert.equal(
    tryFold(parseRoot('.x :is(.a) .y,.x :is(#z) .y,.x :is(.b) .y,.x :is(.c) .y')),
    null
  );
});

// ---------------------------------------------------------------------------
// Edge-case coverage from review checklist
// ---------------------------------------------------------------------------

test(':nth-child(an+b of S): conservatively rejected even when middles match', () => {
  // The selector parser flattens `An+B` and `of S` into one child, so we
  // cannot compute S's specificity reliably. Reject all `of S` cases.
  const out = tryFold(
    parseRoot(
      '.x :nth-child(2n of #a) y,.x :nth-child(2n of #b) y,' +
        '.x :nth-child(2n of #c) y,.x :nth-child(2n of #d) y'
    )
  );
  assert.equal(out, null);
});

test(':nth-child(an+b of S): mixed-spec inside `of` — rejects (cascade-safe)', () => {
  // Without the new guard, our code undercounts and folds: shifts cascade.
  const out = tryFold(
    parseRoot(
      '.x :nth-child(2n of #a) y,.x :nth-child(2n of .b) y,' +
        '.x :nth-child(2n of .c) y,.x :nth-child(2n of .d) y'
    )
  );
  assert.equal(out, null);
});

test(':nth-child(2n+1) without `of` clause still folds normally', () => {
  // Plain :nth-child without `of` keeps the existing fallback (cls=1).
  // All four have the same spec — fold is safe.
  const out = tryFold(
    parseRoot(
      '.x :nth-child(1) y,.x :nth-child(2) y,' +
        '.x :nth-child(3) y,.x :nth-child(4) y'
    )
  );
  assert.equal(
    out,
    '.x :is(:nth-child(1),:nth-child(2),:nth-child(3),:nth-child(4)) y'
  );
});

test(':nth-last-child(of S) also rejected', () => {
  const out = tryFold(
    parseRoot(
      '.x :nth-last-child(2n of .a) y,.x :nth-last-child(2n of .b) y,' +
        '.x :nth-last-child(2n of .c) y,.x :nth-last-child(2n of .d) y'
    )
  );
  assert.equal(out, null);
});

test(':not(.a &): nesting inside pseudo — same spec across middles, folds', () => {
  // Each middle has class+nesting in :not. spec(:not(.x &)) = max child = (0,1,0).
  const out = tryFold(
    parseRoot(
      '.x :not(.a &) y,.x :not(.b &) y,.x :not(.c &) y,.x :not(.d &) y'
    )
  );
  assert.equal(out, '.x :is(:not(.a &),:not(.b &),:not(.c &),:not(.d &)) y');
});

test(':is(::before): pseudo-element inside pseudo-class', () => {
  // Same spec on both sides (each (0,0,1) via :is recursion);
  // fold guard at the outer compound only flags top-level pseudo-elements.
  // CSS-spec-wise `:is(::before)` has no matching elements but is parsed.
  const out = tryFold(
    parseRoot(
      '.x :is(::before) y,.x :is(::after) y,' +
        '.x :is(::backdrop) y,.x :is(::marker) y'
    )
  );
  assert.notEqual(out, null);
  assert.match(out, /:is\(:is\(::before\)/);
});

test('universal in middle — folds when all are spec 0', () => {
  // Prefix `* `, middles diverge but all are tag → spec (0,0,1). Folds.
  const out = tryFold(parseRoot('* a,* b,* c,* d'));
  assert.equal(out, '* :is(a,b,c,d)');
});

test('universal-only middle (all `*`) — no divergent middle, rejects', () => {
  // After dedup, only one unique middle remains → middleStrs.length < 2.
  assert.equal(tryFold(parseRoot('.a *,.b *,.c *,.d *')), ':is(.a,.b,.c,.d) *');
});

test('selector starting with combinator (nesting context)', () => {
  // 4-entry version is exactly equal length so guard rejects; need 6+ to
  // make :is() overhead pay off.
  const out = tryFold(
    parseRootNormalized('> .a,> .b,> .c,> .d,> .e,> .f,> .g,> .h')
  );
  assert.equal(out, '>:is(.a,.b,.c,.d,.e,.f,.g,.h)');
});

test('selector ending with combinator (nesting context)', () => {
  const out = tryFold(
    parseRootNormalized('.a >,.b >,.c >,.d >,.e >,.f >,.g >,.h >')
  );
  assert.equal(out, ':is(.a,.b,.c,.d,.e,.f,.g,.h)>');
});

test('case-insensitive attribute middles fold (same spec)', () => {
  const out = tryFold(
    parseRoot(
      '.x [type="text" i],.x [type="email" i],' +
        '.x [type="search" i],.x [type="url" i]'
    )
  );
  assert.equal(
    out,
    '.x :is([type="text" i],[type="email" i],[type="search" i],[type="url" i])'
  );
});

test('namespaced attributes fold (same spec)', () => {
  const out = tryFold(
    parseRoot(
      '.x [xlink|href],.x [xlink|title],.x [xlink|role],.x [xlink|type]'
    )
  );
  assert.equal(
    out,
    '.x :is([xlink|href],[xlink|title],[xlink|role],[xlink|type])'
  );
});

test('custom-property pseudo-classes (:--state) fold (same spec)', () => {
  const out = tryFold(
    parseRoot('.x :--open,.x :--closed,.x :--hover,.x :--focus')
  );
  assert.equal(out, '.x :is(:--open,:--closed,:--hover,:--focus)');
});

test('mixed: tag vs *|tag (namespaced wildcard) — same spec, folds', () => {
  // Both contribute type=1; same spec.
  const out = tryFold(parseRoot('.x svg|a,.x svg|b,.x svg|c,.x svg|d'));
  assert.equal(out, '.x :is(svg|a,svg|b,svg|c,svg|d)');
});
