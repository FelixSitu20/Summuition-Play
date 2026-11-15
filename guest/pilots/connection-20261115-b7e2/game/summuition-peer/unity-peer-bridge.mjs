import { HostMatch } from './engine.mjs';
import { LIMIT, round, validOrder, validatePuzzle } from './math.mjs';
import { PeerLink } from './transport.mjs';

// Deployment-owned public endpoint only; never place permanent credentials here.
export function connectionOptionsForOrigin(origin) {
  return origin === 'https://felixsitu20.github.io'
    ? { signalingBaseUrl: 'https://summuition-rendezvous.summuition-rendezvous.workers.dev',
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }
    : { signalingBaseUrl: '', iceServers: [] };
}
const NETWORK_OPTIONS = connectionOptionsForOrigin(globalThis.location?.origin);

// DOM-free adapter. Authority, arithmetic and transport remain in the existing modules.
const phases = new Set(['waiting', 'ready', 'loading', 'revealing', 'playing', 'result', 'finished', 'abandoned']);
// Keep the existing transport bytes intact while preventing an awaited response
// from constructing a connection after its Unity owner has already left.
class OwnedPeerLink extends PeerLink {
  async request(...args) {
    if (this.closed) throw new Error('Connection closed.');
    const result = await super.request(...args);
    if (this.closed) throw new Error('Connection closed.');
    return result;
  }
  makeConnection() {
    if (this.closed) throw new Error('Connection closed.');
    super.makeConnection();
  }
  watchOpening() { if (!this.closed) super.watchOpening(); }
}
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('Invalid peer data.');
}
function requireValue(valid) { if (!valid) throw new Error('Invalid peer data.'); }
export function peerProfile(noun, title) {
  requireValue(integer(noun, 0, 11) && integer(title, 0, 11));
  return { noun, title };
}
function puzzleCopy(value) {
  fields(value, ['id', 'difficulty', 'hand', 'goal', 'direction', 'margin', 'startValue', 'lowerGoal', 'upperGoal', 'integerBounds']);
  validatePuzzle(value);
  requireValue(typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.id) && integer(value.difficulty, 0, 3));
  const lower = value.integerBounds ? Math.floor(value.goal - value.margin) : round(value.goal - value.margin);
  const upper = value.integerBounds ? Math.ceil(value.goal + value.margin) : round(value.goal + value.margin);
  requireValue(value.lowerGoal === lower && value.upperGoal === upper);
  return { id: value.id, difficulty: value.difficulty,
    hand: value.hand.map(card => { fields(card, ['kind', 'operand']); return { kind: card.kind, operand: card.operand }; }),
    goal: value.goal, direction: value.direction, margin: value.margin, startValue: value.startValue,
    lowerGoal: lower, upperGoal: upper, integerBounds: value.integerBounds };
}
// Project every nested value; credentials and unknown fields never reach Unity.
export function sanitizePeerState(value) {
  fields(value, ['phase', 'revision', 'round', 'hp', 'ready', 'remainingSeconds', 'resultSeconds', 'timerSeconds', 'loaded', 'revealSeconds',
    'puzzle', 'lastResult', 'lastAttempts', 'winnerIndex', 'reason']);
  requireValue(phases.has(value.phase) && integer(value.revision, 0, 2147483647) && integer(value.round, 0, 1000) &&
    Array.isArray(value.hp) && value.hp.length === 2 && value.hp.every(hp => integer(hp, 0, 5)) &&
    Array.isArray(value.ready) && value.ready.length === 2 && value.ready.every(ready => typeof ready === 'boolean') &&
    Array.isArray(value.loaded) && value.loaded.length === 2 && value.loaded.every(loaded => typeof loaded === 'boolean') &&
    finite(value.revealSeconds, 0, 0.5) && finite(value.remainingSeconds, 0, 60) && finite(value.resultSeconds, 0, 1.5) && value.timerSeconds === 60 &&
    integer(value.winnerIndex, -2, 1) && Array.isArray(value.lastAttempts) && value.lastAttempts.length === 2 &&
    (value.reason === null || (typeof value.reason === 'string' && value.reason.length <= 180)));
  requireValue(value.puzzle !== null || value.phase === 'waiting' || value.phase === 'ready' || value.phase === 'abandoned');
  requireValue(value.phase !== 'ready' || value.puzzle === null);
  const puzzle = value.puzzle === null ? null : puzzleCopy(value.puzzle);
  const lastAttempts = value.lastAttempts.map(attempt => {
    if (attempt === null) return null;
    fields(attempt, ['requestId', 'round', 'correct', 'hasValue', 'value']);
    requireValue(typeof attempt.requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(attempt.requestId) &&
      integer(attempt.round, 1, value.round) && typeof attempt.correct === 'boolean' && typeof attempt.hasValue === 'boolean' &&
      finite(attempt.value, -LIMIT, LIMIT));
    return { requestId: attempt.requestId, round: attempt.round, correct: attempt.correct, hasValue: attempt.hasValue, value: attempt.value };
  });
  let lastResult = null;
  if (value.lastResult !== null) {
    const result = value.lastResult; fields(result, ['round', 'winnerIndex', 'timedOut', 'damage']);
    requireValue(integer(result.round, 1, value.round) && integer(result.winnerIndex, -1, 1) && typeof result.timedOut === 'boolean' &&
      Array.isArray(result.damage) && result.damage.length === 2 && result.damage.every(damage => integer(damage, 0, 1)));
    lastResult = { round: result.round, winnerIndex: result.winnerIndex, timedOut: result.timedOut, damage: [...result.damage] };
  }
  return { phase: value.phase, revision: value.revision, round: value.round, hp: [...value.hp], ready: [...value.ready],
    loaded: [...value.loaded], revealSeconds: value.revealSeconds, remainingSeconds: value.remainingSeconds, resultSeconds: value.resultSeconds, timerSeconds: 60,
    puzzle, lastResult, lastAttempts, winnerIndex: value.winnerIndex,
    reason: value.phase === 'abandoned' ? 'Connection ended. No win awarded.' : null };
}

async function loadPublicBank(signal) {
  const response = await fetch(new URL('./puzzles.json', import.meta.url), { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Puzzle bank unavailable.');
  const text = await response.text();
  if (text.length > 1048576) throw new Error('Puzzle bank too large.');
  return JSON.parse(text);
}

export function createUnityPeerBridge({ generation, onEvent }, dependencies = {}) {
  if (!integer(generation, 1, 2147483647) || typeof onEvent !== 'function') throw new TypeError('Invalid bridge owner.');
  const now = dependencies.now ?? (() => performance.now());
  const loadBank = dependencies.loadBank ?? loadPublicBank;
  const makeLink = dependencies.makeLink ?? (callbacks => new OwnedPeerLink({ ...NETWORK_OPTIONS, ...callbacks }));
  const interval = dependencies.setInterval ?? ((callback, delay) => setInterval(callback, delay));
  const clear = dependencies.clearInterval ?? (handle => clearInterval(handle));
  const random = dependencies.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const requestId = dependencies.requestId ?? (() => crypto.randomUUID());
  let active = null, disposed = false;
  const current = session => !disposed && active === session;
  function emit(session, kind, extra = {}) {
    if (!current(session)) return;
    const envelope = { version: 1, generation, kind, roomCode: session.code, playerIndex: session.seat,
      selfProfile: { ...session.profile }, opponentProfile: session.remote ? { ...session.remote } : null, ...extra };
    // No callback receives the internal session, engine or transport objects.
    onEvent(structuredClone(envelope));
  }
  function apply(session, raw, force = false) {
    if (!current(session)) return;
    const next = sanitizePeerState(raw);
    if (session.state && next.revision < session.state.revision) return;
    if (session.state && next.round < session.state.round) throw new Error('Invalid peer round.');
    if (['loading', 'revealing', 'playing', 'result', 'finished'].includes(next.phase)) session.frozen = true;
    if (!session.state || next.round !== session.state.round) { session.readySubmitted = false; session.loadedSubmitted = false; }
    session.state = next;
    const timestamp = now();
    if (force || next.revision !== session.emittedRevision || timestamp - session.lastEmit >= 200) {
      session.emittedRevision = next.revision; session.lastEmit = timestamp;
      emit(session, 'snapshot', { state: next });
    }
  }
  function publish(session, next) {
    if (!current(session) || session.closed) return;
    apply(session, next); session.lastBroadcast = now();
    session.link?.send({ type: 'state', state: next });
  }
  function stopResources(session) {
    if (session.timer !== null) { clear(session.timer); session.timer = null; }
    session.abort.abort();
  }
  function closed(session) {
    if (!current(session) || session.closed) return;
    session.closed = true; stopResources(session);
    if (session.engine) { session.engine.disconnect(); apply(session, session.engine.snapshot(), true); }
    else if (session.state) {
      if (session.state.phase !== 'finished') apply(session, { ...session.state, revision: session.state.revision + 1,
        phase: 'abandoned', winnerIndex: -2, ready: [false, false], remainingSeconds: 0, resultSeconds: 0,
        reason: 'Connection ended. No win awarded.' }, true);
      else apply(session, session.state, true);
    }
    emit(session, 'closed', { message: session.state?.phase === 'finished' ? 'Final result kept.' : 'Connection ended. No win awarded.' });
  }
  function closeOwned(session) {
    if (session.link && !session.link.closed) session.link.close();
    closed(session);
  }
  function incomingProfile(session, message) {
    const timestamp = now(); session.profileTimes = session.profileTimes.filter(at => timestamp - at < 10000);
    if (session.profileTimes.length >= 6) return;
    session.profileTimes.push(timestamp);
    if (session.frozen) return;
    try {
      fields(message, ['type', 'noun', 'title']);
      requireValue(Object.keys(message).length === 3);
      session.remote = peerProfile(message.noun, message.title);
    } catch { return; } // Optional nickname data never ends a valid match.
    emit(session, 'profile'); if (session.state) apply(session, session.state, true);
  }
  function receive(session, message) {
    if (!current(session) || session.closed) return;
    requireValue(message && typeof message === 'object' && !Array.isArray(message));
    if (message.type === 'profile') { incomingProfile(session, message); return; }
    fields(message, ['type', 'state', 'round', 'requestId', 'order']);
    if (session.role === 'guest') {
      fields(message, ['type', 'state']); requireValue(message.type === 'state'); apply(session, message.state); return;
    }
    const timestamp = now(); session.commandTimes = session.commandTimes.filter(at => timestamp - at < 1000);
    requireValue(session.commandTimes.length < 30); session.commandTimes.push(timestamp);
    requireValue(integer(message.round, 1, 1000));
    if (message.type === 'ready') { fields(message, ['type', 'round']); session.engine.ready(1, message.round); }
    else if (message.type === 'loaded') { fields(message, ['type', 'round']); session.engine.loaded(1, message.round); }
    else if (message.type === 'answer') {
      fields(message, ['type', 'round', 'requestId', 'order']);
      requireValue(validOrder(message.order) && typeof message.requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.requestId));
      session.engine.answer(1, { requestId: message.requestId, round: message.round, order: message.order });
    } else throw new Error('Invalid command.');
    publish(session, session.engine.snapshot());
  }
  async function begin(role, difficulty, code, noun, title) {
    if (disposed || (active && !active.closed)) return false;
    let profile;
    try { profile = peerProfile(noun, title); requireValue(role === 'host' ? integer(difficulty, 0, 3) : /^\d{4}$/.test(code)); }
    catch { return false; }
    const session = { role, seat: role === 'host' ? 0 : 1, code: '', profile, remote: null,
      frozen: false, readySubmitted: false, loadedSubmitted: false, profileTimes: [], changedTimes: [], commandTimes: [],
      state: null, engine: null, link: null, timer: null, abort: new AbortController(), closed: false,
      lastBroadcast: 0, lastEmit: -Infinity, emittedRevision: -1 };
    active = session; emit(session, 'status', { message: role === 'host' ? 'Creating room.' : 'Joining room.' });
    try {
      if (role === 'host') {
        const source = await loadBank(session.abort.signal);
        if (!current(session) || session.closed) return false;
        requireValue(Array.isArray(source) && source.length >= 4 && source.length <= 1024);
        const bank = source.map(puzzleCopy).filter(puzzle => puzzle.difficulty === difficulty);
        requireValue(bank.length >= 2); let previous = -1;
        session.engine = new HostMatch({ now, pickPuzzle() {
          const candidates = bank.map((puzzle, index) => ({ puzzle, index })).filter(item => item.index !== previous);
          const selected = candidates[random() % candidates.length]; previous = selected.index; return selected.puzzle;
        }, onChange: next => publish(session, next) });
        session.state = sanitizePeerState(session.engine.snapshot());
      }
      if (!current(session) || session.closed) return false;
      session.link = makeLink({
        onRoom(roomCode, assignedRole) {
          if (!current(session) || session.closed) return;
          requireValue(/^\d{4}$/.test(roomCode) && assignedRole === role); session.code = roomCode;
          emit(session, 'room'); if (session.state) apply(session, session.state, true);
        },
        onOpen() {
          if (!current(session) || session.closed) return;
          session.link.send({ type: 'profile', ...session.profile });
          if (!current(session) || session.closed) return;
          emit(session, 'status', { message: 'Both players choose Ready to begin.' });
          if (role === 'host') {
            session.engine.connectGuest();
            if (!current(session) || session.closed) return;
            session.timer = interval(() => {
              if (!current(session) || session.closed) return;
              const next = session.engine.tick(); apply(session, next);
              if (current(session) && !session.closed && now() - session.lastBroadcast >= 250) {
                session.lastBroadcast = now(); session.link.send({ type: 'state', state: next });
              }
            }, 100);
          }
        },
        onMessage: message => receive(session, message), onClose: () => closed(session),
      });
      if (role === 'host') await session.link.host(); else await session.link.join(code);
      return current(session) && !session.closed;
    } catch {
      if (current(session) && !session.closed) {
        emit(session, 'error', { message: 'Unable to connect. Check the room code and try again.' }); closeOwned(session);
      }
      return false;
    }
  }
  function commandSession(number, phase) {
    return active && !disposed && !active.closed && integer(number, 1, 1000) && active.state?.round === number && active.state?.phase === phase ? active : null;
  }
  return Object.freeze({
    host: (difficulty, noun, title) => begin('host', difficulty, '', noun, title),
    join: (code, noun, title) => begin('guest', 0, code, noun, title),
    ready(number) {
      const session = commandSession(number, 'ready');
      if (!session || session.readySubmitted || session.state.ready[session.seat]) return false;
      session.readySubmitted = true;
      if (session.role === 'host') session.engine.ready(0, number); else session.link.send({ type: 'ready', round: number });
      return true;
    },
    loaded(number) {
      const session = commandSession(number, 'loading');
      if (!session || session.loadedSubmitted || session.state.loaded[session.seat]) return false;
      session.loadedSubmitted = true;
      if (session.role === 'host') session.engine.loaded(0, number); else session.link.send({ type: 'loaded', round: number });
      return true;
    },
    answer(number, order) {
      const session = commandSession(number, 'playing'); if (!session || !validOrder(order)) return false;
      const request = { requestId: requestId(), round: number, order: [...order] };
      if (session.role === 'host') session.engine.answer(0, request); else session.link.send({ type: 'answer', ...request });
      return true;
    },
    profile(noun, title) {
      const session = active; if (!session || disposed || session.closed || session.frozen || session.readySubmitted || session.state?.ready[session.seat]) return false;
      let choice; try { choice = peerProfile(noun, title); } catch { return false; }
      if (choice.noun === session.profile.noun && choice.title === session.profile.title) return false;
      const timestamp = now(); session.changedTimes = session.changedTimes.filter(at => timestamp - at < 10000);
      if (session.changedTimes.length >= 5) return false;
      session.changedTimes.push(timestamp); session.profile = choice;
      session.link?.send({ type: 'profile', ...choice }); emit(session, 'profile');
      if (session.state) apply(session, session.state, true); return true;
    },
    leave() { if (active && !active.closed) closeOwned(active); },
    dispose() {
      if (disposed) return; disposed = true;
      if (active) { stopResources(active); if (active.link && !active.link.closed) active.link.close(); }
      active = null;
    },
  });
}
