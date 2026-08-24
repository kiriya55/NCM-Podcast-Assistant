'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  createRandomBalancedStrategy,
  assertScoreResult,
} = require('../../electron/musicPartner/scoreStrategy')

function sequence(values) {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('random sequence exhausted at index ' + i)
    return values[i++]
  }
}

test('randomBalanced: low sequence yields overall 3 with parts pinned to 3', () => {
  // floor(0.0 * 3) + 3 = 3; per part: floor(0.0 * 3) + (3 - 1) clamp -> 3
  const strategy = createRandomBalancedStrategy({ random: sequence([0, 0, 0, 0]) })
  const result = strategy.score({ phase: 'daily', songIndex: 0, song: {}, partNames: ['旋律', '演唱', '歌词'] })
  assert.deepEqual(result, { overall: 3, parts: { 旋律: 3, 演唱: 3, 歌词: 3 } })
})

test('randomBalanced: high sequence yields overall 5 with parts pinned to 5', () => {
  // floor(0.999 * 3) + 3 = 5; per part: floor(0.999 * 3) + (5 - 1) clamp -> 5
  const strategy = createRandomBalancedStrategy({ random: sequence([0.999, 0.999, 0.999, 0.999]) })
  const result = strategy.score({ phase: 'daily', songIndex: 0, song: {}, partNames: ['旋律', '演唱', '歌词'] })
  assert.deepEqual(result, { overall: 5, parts: { 旋律: 5, 演唱: 5, 歌词: 5 } })
})

test('randomBalanced: keeps each visible part within one point of overall', () => {
  // overall 4 (0.5 -> floor(1.5) + 3 = 4)
  // parts use deltas [-1, 0, +1] -> 3, 4, 5
  const strategy = createRandomBalancedStrategy({ random: sequence([0.5, 0, 0.5, 0.999]) })
  const result = strategy.score({ phase: 'daily', songIndex: 1, song: {}, partNames: ['旋律', '演唱', '歌词'] })
  assert.deepEqual(result, { overall: 4, parts: { 旋律: 3, 演唱: 4, 歌词: 5 } })
})

test('randomBalanced: handles single part', () => {
  const strategy = createRandomBalancedStrategy({ random: sequence([0.5, 0.5]) })
  const result = strategy.score({ phase: 'extra', songIndex: 7, song: {}, partNames: ['旋律'] })
  assert.equal(result.overall, 4)
  assert.equal(result.parts['旋律'], 4)
  assert.equal(Object.keys(result.parts).length, 1)
})

test('randomBalanced: preserves an already selected overall while scoring revealed parts', () => {
  const strategy = createRandomBalancedStrategy({ random: sequence([0]) })

  const result = strategy.score({ partNames: ['旋律'], overallScore: 4 })

  assert.equal(result.overall, 4)
  assert.deepEqual(result.parts, { 旋律: 3 })
})

test('randomBalanced: handles two parts', () => {
  const strategy = createRandomBalancedStrategy({ random: sequence([0.5, 0.5, 0.5]) })
  const result = strategy.score({ phase: 'extra', songIndex: 0, song: {}, partNames: ['演唱', '歌词'] })
  assert.equal(result.overall, 4)
  assert.equal(Object.keys(result.parts).length, 2)
  assert.equal(result.parts['演唱'], 4)
  assert.equal(result.parts['歌词'], 4)
})

test('randomBalanced: only emits keys present in partNames, no extras', () => {
  const strategy = createRandomBalancedStrategy({ random: sequence([0.5, 0.5, 0.5, 0.5, 0.5]) })
  const result = strategy.score({ phase: 'daily', songIndex: 0, song: {}, partNames: ['旋律', '演唱'] })
  assert.deepEqual(Object.keys(result.parts).sort(), ['旋律', '演唱'])
})

test('randomBalanced: empty partNames returns no parts, overall still 3-5', () => {
  const strategy = createRandomBalancedStrategy({ random: sequence([0.5]) })
  const result = strategy.score({ phase: 'daily', songIndex: 0, song: {}, partNames: [] })
  assert.equal(result.overall, 4)
  assert.deepEqual(result.parts, {})
})

test('randomBalanced: default Math.random stays within 3-5 and within ±1 of overall', () => {
  const strategy = createRandomBalancedStrategy()
  for (let i = 0; i < 50; i++) {
    const result = strategy.score({ phase: 'daily', songIndex: i, song: {}, partNames: ['旋律', '演唱', '歌词'] })
    assert.ok(result.overall >= 3 && result.overall <= 5, 'overall in 3..5, got ' + result.overall)
    for (const name of ['旋律', '演唱', '歌词']) {
      const v = result.parts[name]
      assert.ok(v >= 3 && v <= 5, name + ' in 3..5, got ' + v)
      assert.ok(Math.abs(v - result.overall) <= 1, name + ' within 1 of overall')
    }
  }
})

test('assertScoreResult: accepts valid result', () => {
  assertScoreResult({ overall: 4, parts: { 旋律: 3, 演唱: 4, 歌词: 5 } }, ['旋律', '演唱', '歌词'])
  assertScoreResult({ overall: 3, parts: {} }, [])
})

test('assertScoreResult: rejects missing part', () => {
  assert.throws(() => assertScoreResult({ overall: 4, parts: { 旋律: 3, 演唱: 4 } }, ['旋律', '演唱', '歌词']))
})

test('assertScoreResult: rejects extra part', () => {
  assert.throws(() => assertScoreResult({ overall: 4, parts: { 旋律: 3, 演唱: 4, 歌词: 4, 作曲: 4 } }, ['旋律', '演唱', '歌词']))
})

test('assertScoreResult: rejects non-integer score', () => {
  assert.throws(() => assertScoreResult({ overall: 4.5, parts: { 旋律: 3 } }, ['旋律']))
  assert.throws(() => assertScoreResult({ overall: 4, parts: { 旋律: 3.5 } }, ['旋律']))
})

test('assertScoreResult: rejects score outside 3-5', () => {
  assert.throws(() => assertScoreResult({ overall: 2, parts: {} }, []))
  assert.throws(() => assertScoreResult({ overall: 6, parts: {} }, []))
  assert.throws(() => assertScoreResult({ overall: 4, parts: { 旋律: 2 } }, ['旋律']))
  assert.throws(() => assertScoreResult({ overall: 4, parts: { 旋律: 6 } }, ['旋律']))
})

test('assertScoreResult: rejects part/overall delta greater than 1', () => {
  assert.throws(() => assertScoreResult({ overall: 3, parts: { 旋律: 5 } }, ['旋律']))
  assert.throws(() => assertScoreResult({ overall: 5, parts: { 旋律: 3 } }, ['旋律']))
})

test('assertScoreResult: rejects wrong shape', () => {
  assert.throws(() => assertScoreResult(null, []))
  assert.throws(() => assertScoreResult({ overall: 4 }, []))
  assert.throws(() => assertScoreResult({ overall: '4', parts: {} }, []))
  assert.throws(() => assertScoreResult({ overall: 4, parts: null }, []))
})
