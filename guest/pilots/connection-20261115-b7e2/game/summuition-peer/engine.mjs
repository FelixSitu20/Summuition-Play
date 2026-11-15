import { evaluateOrder, validOrder, validatePuzzle } from './math.mjs';

// Only the hosting browser constructs this authority. Signaling has no access
// to its clock, puzzle selection, answer processing, Health or match results.
export class HostMatch {
  #now; #pickPuzzle; #onChange; #lastNow = 0; #deadline = 0; #resultUntil = 0;
  #loadUntil = 0; #revealUntil = 0;
  #receipts = [new Map(), new Map()]; #roundSeconds; #state;

  constructor({ now = () => performance.now(), pickPuzzle, onChange = () => {}, roundSeconds = 60 } = {}) {
    if (typeof now !== 'function' || typeof pickPuzzle !== 'function' || typeof onChange !== 'function')
      throw new TypeError('A clock, puzzle picker and state callback are required.');
    if (!Number.isInteger(roundSeconds) || roundSeconds < 1 || roundSeconds > 60)
      throw new RangeError('Round duration must be between 1 and 60 seconds.');
    this.#now = now; this.#pickPuzzle = pickPuzzle; this.#onChange = onChange; this.#roundSeconds = roundSeconds;
    this.#state = { phase: 'waiting', revision: 0, round: 0, hp: [5, 5], ready: [false, false], loaded: [false, false],
      remainingSeconds: 0, puzzle: null, lastResult: null, lastAttempts: [null, null], winnerIndex: -2,
      reason: null, timerSeconds: roundSeconds };
    this.#time();
  }

  #time() {
    const value = this.#now();
    if (!Number.isFinite(value) || value < 0) throw new RangeError('The host clock must be finite and nonnegative.');
    this.#lastNow = Math.max(this.#lastNow, value);
    return this.#lastNow;
  }
  #validSeat(seat) { return seat === 0 || seat === 1; }
  #notify() { this.#state.revision++; this.#onChange(this.snapshot()); }
  #deal(now, first = false) {
    const puzzle = structuredClone(validatePuzzle(this.#pickPuzzle(first ? this.#state.round : this.#state.round + 1)));
    if (!first) this.#state.round++;
    this.#state.puzzle = puzzle; this.#state.phase = 'loading';
    this.#state.loaded = [false, false]; this.#loadUntil = now + 30000;
    this.#state.ready = [true, true]; this.#state.lastAttempts = [null, null]; this.#state.reason = null;
    this.#deadline = 0; this.#resultUntil = 0;
  }
  #finishRound(winnerIndex, timedOut, now) {
    const damage = timedOut ? [1, 1] : winnerIndex === 0 ? [0, 1] : [1, 0];
    this.#state.hp = this.#state.hp.map((hp, index) => Math.max(0, hp - damage[index]));
    this.#state.lastResult = { round: this.#state.round, winnerIndex, timedOut, damage };
    this.#deadline = 0;
    if (this.#state.hp.some(hp => hp === 0)) {
      this.#state.phase = 'finished';
      this.#state.winnerIndex = this.#state.hp.every(hp => hp === 0) ? -1 : this.#state.hp[0] === 0 ? 1 : 0;
    } else {
      this.#state.phase = 'result'; this.#resultUntil = now + 1500;
    }
  }
  #advance(now) {
    if (this.#state.phase === 'loading' && now >= this.#loadUntil) {
      this.disconnect('A player did not finish loading. Start a new room.'); return;
    }
    if (this.#state.phase === 'revealing' && now >= this.#revealUntil) {
      this.#state.phase = 'playing'; this.#deadline = now + this.#roundSeconds * 1000; this.#notify();
    }
    if (this.#state.phase === 'playing' && now >= this.#deadline) {
      this.#finishRound(-1, true, now); this.#notify();
    } else if (this.#state.phase === 'result' && now >= this.#resultUntil) {
      this.#deal(now); this.#notify();
    }
  }

  connectGuest() {
    if (this.#state.phase !== 'waiting') return { ok: false, code: 'already_connected' };
    this.#state.round = 1; this.#state.phase = 'ready';
    this.#notify(); return { ok: true, code: 'connected' };
  }
  ready(seat, round) {
    if (!this.#validSeat(seat)) return { ok: false, code: 'invalid_seat' };
    const now = this.#time(); this.#advance(now);
    if (round !== this.#state.round || this.#state.phase !== 'ready') return { ok: false, code: 'state_changed' };
    if (this.#state.ready[seat]) return { ok: true, code: 'already_ready' };
    this.#state.ready[seat] = true;
    if (this.#state.ready.every(Boolean)) this.#deal(now, true);
    this.#notify(); return { ok: true, code: 'ready' };
  }
  loaded(seat, round) {
    if (!this.#validSeat(seat)) return { ok: false, code: 'invalid_seat' };
    const now = this.#time(); this.#advance(now);
    if (round !== this.#state.round || this.#state.phase !== 'loading') return { ok: false, code: 'state_changed' };
    if (this.#state.loaded[seat]) return { ok: true, code: 'already_loaded' };
    this.#state.loaded[seat] = true;
    if (this.#state.loaded.every(Boolean)) { this.#state.phase = 'revealing'; this.#revealUntil = now + 500; }
    this.#notify(); return { ok: true, code: 'loaded' };
  }
  answer(seat, request) {
    if (!this.#validSeat(seat)) return { ok: false, code: 'invalid_seat' };
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['requestId', 'round', 'order'].includes(key)) ||
        typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(request.requestId) ||
        !Number.isSafeInteger(request.round) || !validOrder(request.order)) return { ok: false, code: 'invalid_answer' };
    const now = this.#time(); this.#advance(now);
    const fingerprint = JSON.stringify([request.round, request.order]);
    const receipt = this.#receipts[seat].get(request.requestId);
    if (receipt) return receipt.fingerprint === fingerprint
      ? { ok: true, code: 'replayed', attempt: structuredClone(receipt.attempt) }
      : { ok: false, code: 'request_reused' };
    if (request.round !== this.#state.round || this.#state.phase !== 'playing') return { ok: false, code: 'state_changed' };
    if (this.#receipts[seat].size >= 1024) return { ok: false, code: 'attempt_limit' };
    const evaluated = evaluateOrder(this.#state.puzzle, request.order);
    const attempt = { requestId: request.requestId, round: request.round,
      correct: evaluated.correct, hasValue: evaluated.hasValue, value: evaluated.value };
    this.#state.lastAttempts[seat] = attempt;
    this.#receipts[seat].set(request.requestId, { fingerprint, attempt: structuredClone(attempt) });
    if (attempt.correct) this.#finishRound(seat, false, now);
    this.#notify(); return { ok: true, code: attempt.correct ? 'correct' : 'wrong', attempt: structuredClone(attempt) };
  }
  tick() { this.#advance(this.#time()); return this.snapshot(); }
  disconnect(reason = 'Connection lost. Start a new room to play again.') {
    if (this.#state.phase === 'finished' || this.#state.phase === 'abandoned') return { ok: true, code: 'closed' };
    this.#state.phase = 'abandoned'; this.#state.reason = typeof reason === 'string' ? reason.slice(0, 180) : 'Connection lost.';
    this.#state.winnerIndex = -2; this.#state.ready = [false, false]; this.#deadline = 0; this.#resultUntil = 0;
    this.#notify(); return { ok: true, code: 'abandoned' };
  }
  snapshot() {
    const now = this.#time();
    return structuredClone({ ...this.#state,
      remainingSeconds: this.#state.phase === 'playing' ? Math.max(0, (this.#deadline - now) / 1000)
        : ['ready', 'loading', 'revealing'].includes(this.#state.phase) ? this.#roundSeconds : 0,
      revealSeconds: this.#state.phase === 'revealing' ? Math.max(0, (this.#revealUntil - now) / 1000) : 0,
      resultSeconds: this.#state.phase === 'result' ? Math.max(0, (this.#resultUntil - now) / 1000) : 0 });
  }
}
