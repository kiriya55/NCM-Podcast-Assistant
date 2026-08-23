'use strict'

// add some func

const MIN_SCORE = 3
const MAX_SCORE = 5
const MAX_PART_DELTA = 1

function clamp(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function randomIntInclusive(random, min, max) {
  // add some func
  const span = max - min + 1
  return Math.floor(random() * span) + min
}

// add some func
function createRandomBalancedStrategy({ random = Math.random } = {}) {
  if (typeof random !== 'function') {
    throw new TypeError('createRandomBalancedStrategy: random must be a function')
  }
  return {
    name: 'randomBalanced',
    score({ phase, songIndex, song, partNames, overallScore }) {
      const overall = Number.isInteger(overallScore) && overallScore >= MIN_SCORE && overallScore <= MAX_SCORE
        ? overallScore
        : randomIntInclusive(random, MIN_SCORE, MAX_SCORE)
      const parts = {}
      const names = Array.isArray(partNames) ? partNames : []
      for (const name of names) {
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('randomBalanced: partNames must be non-empty strings')
        }
        const delta = randomIntInclusive(random, -MAX_PART_DELTA, MAX_PART_DELTA)
        parts[name] = clamp(overall + delta, MIN_SCORE, MAX_SCORE)
      }
      return { overall, parts }
    },
  }
}

// add some func
function assertScoreResult(result, partNames) {
  if (!result || typeof result !== 'object') {
    throw new Error('assertScoreResult: result must be an object')
  }
  if (typeof result.overall !== 'number' || !Number.isInteger(result.overall)) {
    throw new Error('assertScoreResult: overall must be an integer')
  }
  if (result.overall < MIN_SCORE || result.overall > MAX_SCORE) {
    throw new Error('assertScoreResult: overall must be in [' + MIN_SCORE + ', ' + MAX_SCORE + ']')
  }
  if (!result.parts || typeof result.parts !== 'object' || Array.isArray(result.parts)) {
    throw new Error('assertScoreResult: parts must be an object')
  }
  const expected = Array.isArray(partNames) ? partNames : []
  const actualKeys = Object.keys(result.parts)
  const expectedKeys = expected.slice().sort()
  const sortedActual = actualKeys.slice().sort()
  if (sortedActual.length !== expectedKeys.length ||
      !sortedActual.every((k, i) => k === expectedKeys[i])) {
    throw new Error('assertScoreResult: parts keys must match partNames exactly')
  }
  for (const name of expected) {
    const v = result.parts[name]
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new Error('assertScoreResult: part ' + name + ' must be an integer')
    }
    if (v < MIN_SCORE || v > MAX_SCORE) {
      throw new Error('assertScoreResult: part ' + name + ' must be in [' + MIN_SCORE + ', ' + MAX_SCORE + ']')
    }
    if (Math.abs(v - result.overall) > MAX_PART_DELTA) {
      throw new Error('assertScoreResult: part ' + name + ' must differ from overall by at most ' + MAX_PART_DELTA)
    }
  }
}

module.exports = {
  MIN_SCORE,
  MAX_SCORE,
  MAX_PART_DELTA,
  createRandomBalancedStrategy,
  assertScoreResult,
}
