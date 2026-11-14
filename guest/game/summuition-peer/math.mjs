// Browser port of ArithmeticRules.cs. The offline C# exporter supplies the
// canonical puzzle bank and permutation vectors used by tests/math.test.mjs.
export const LIMIT = 9999;
export const EPSILON = 0.000001;
const MACHINE_EPSILON = 2.2204460492503131e-16;

function awayFromZero(value) {
  if (!Number.isFinite(value) || Math.abs(value) >= 4503599627370496) return value;
  const absolute = Math.abs(value), integer = Math.floor(absolute);
  const result = integer + (absolute - integer >= 0.5 ? 1 : 0);
  return value < 0 ? -result : result;
}

export function cleanRoundoff(value, previous = 0) {
  if (!Number.isFinite(value)) return value;
  const candidate = Math.abs(value) < 1e16 ? awayFromZero(value * 1e10) / 1e10 : value;
  const tolerance = 16 * MACHINE_EPSILON * Math.max(1, Math.abs(value), Math.abs(previous));
  return Math.abs(value - candidate) <= tolerance ? candidate : value;
}

export function round(value) {
  if (!Number.isFinite(value)) return value;
  let scaled = value * 100;
  if (!Number.isFinite(scaled)) return value;
  const half = awayFromZero(scaled * 2) / 2;
  if (Math.abs(scaled - half) <= 16 * MACHINE_EPSILON * Math.max(1, Math.abs(scaled))) scaled = half;
  const result = awayFromZero(scaled) / 100;
  return result === 0 ? 0 : result;
}

export function apply(operation, value) {
  let next = value;
  const skipped = operation.kind === 4 && value < 0;
  if (!skipped) {
    switch (operation.kind) {
      case 0: next += operation.operand; break;
      case 1: next -= operation.operand; break;
      case 2: next *= operation.operand; break;
      case 3: next *= next; break;
      case 4: next = Math.sqrt(next); break;
      case 5: next = Math.abs(next); break;
      case 6: next = next * next * next; break;
      case 7: next = Math.sign(next) * Math.pow(Math.abs(next), 1 / 3); break;
      default: throw new TypeError('Unknown operation.');
    }
  }
  return { before: value, after: skipped ? value : cleanRoundoff(next, value), skipped };
}

export function resolve(cards, startValue = 0) {
  let value = startValue;
  return cards.map(card => {
    const step = apply(card, value);
    value = step.after;
    return step;
  });
}

export function accepts(puzzle, result) {
  if (!Number.isFinite(result)) return false;
  result = round(result);
  const lower = puzzle.integerBounds ? Math.floor(puzzle.goal - puzzle.margin) : round(puzzle.goal - puzzle.margin);
  const upper = puzzle.integerBounds ? Math.ceil(puzzle.goal + puzzle.margin) : round(puzzle.goal + puzzle.margin);
  return puzzle.direction === 2
    ? result + EPSILON >= lower && result - EPSILON <= upper
    : Math.abs(result - puzzle.goal) <= EPSILON;
}

export function validOrder(order) {
  return Array.isArray(order) && order.length === 5 && new Set(order).size === 5 &&
    order.every(index => Number.isInteger(index) && index >= 0 && index < 5);
}

export function evaluateOrder(puzzle, order) {
  if (!validOrder(order)) throw new TypeError('Use each of the five cards exactly once.');
  const steps = resolve(order.map(index => puzzle.hand[index]), puzzle.startValue);
  const hasValue = steps.every(step => Number.isFinite(step.after) && Math.abs(step.after) <= LIMIT);
  const value = hasValue ? round(steps.at(-1).after) : 0;
  return { value, hasValue, correct: hasValue && accepts(puzzle, value), steps };
}

export function validatePuzzle(puzzle) {
  const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMIT;
  if (!puzzle || !Array.isArray(puzzle.hand) || puzzle.hand.length !== 5 ||
      !Number.isInteger(puzzle.direction) || puzzle.direction < 0 || puzzle.direction > 2 ||
      !finite(puzzle.goal) || !finite(puzzle.margin) || puzzle.margin < 0 || !finite(puzzle.startValue) ||
      typeof puzzle.integerBounds !== 'boolean' || puzzle.hand.some(card => !card ||
        !Number.isInteger(card.kind) || card.kind < 0 || card.kind > 7 || !finite(card.operand))) {
    throw new TypeError('Invalid shared puzzle.');
  }
  return puzzle;
}
