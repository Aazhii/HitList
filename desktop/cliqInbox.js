'use strict';

const TYPES = new Set(['create', 'list', 'edit', 'complete']);
const PAGE_SIZE = 20;
const MAX_PAGES = 10;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function identityOf(link) {
  if (!link || !link.enabled || typeof link.accountId !== 'string' || !link.accountId
    || typeof link.deviceId !== 'string' || !SAFE_ID.test(link.deviceId)
    || !Number.isSafeInteger(link.generation) || link.generation < 1) return null;
  return { accountId: link.accountId, deviceId: link.deviceId, generation: link.generation };
}

function sameIdentity(left, right) {
  return !!left && !!right && left.accountId === right.accountId
    && left.deviceId === right.deviceId && left.generation === right.generation;
}

function validCommand(command, identity) {
  return !!command && typeof command.id === 'string' && SAFE_ID.test(command.id)
    && sameIdentity(command, identity) && command.schemaVersion === 1 && TYPES.has(command.type)
    && Number.isSafeInteger(command.expiresAt) && command.expiresAt > 0
    && !!command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload);
}

function createCliqInbox({ getLink, subscribe, fetchPending, execute, acknowledge, onApplied = () => {}, now = Date.now }) {
  let session = null;
  let lastResult = 'stopped';

  const current = (candidate) => session === candidate && sameIdentity(candidate.identity, identityOf(getLink()));

  function stop() {
    const previous = session;
    session = null;
    if (previous) {
      previous.controller.abort();
      if (previous.unsubscribe) previous.unsubscribe();
    }
    lastResult = 'stopped';
  }

  async function drain(candidate) {
    let processed = 0;
    let pages = 0;
    try {
      do {
        candidate.requested = false;
        if (!current(candidate)) return { result: 'inactive', processed };
        const commands = await fetchPending(candidate.identity, { limit: PAGE_SIZE, signal: candidate.controller.signal });
        if (!current(candidate)) return { result: 'inactive', processed };
        if (!Array.isArray(commands) || commands.length > PAGE_SIZE
          || commands.some((command) => !validCommand(command, candidate.identity))) {
          lastResult = 'invalid-inbox';
          return { result: lastResult, processed };
        }
        for (const command of commands) {
          if (!current(candidate)) return { result: 'inactive', processed };
          const outcome = command.expiresAt <= now()
            ? { status: 'expired' }
            : await execute(command, { ...candidate.identity, signal: candidate.controller.signal });
          if (!current(candidate)) return { result: 'inactive', processed };
          if (!outcome || !['applied', 'failed', 'expired'].includes(outcome.status)) {
            lastResult = 'invalid-result';
            return { result: lastResult, processed };
          }
          if (outcome.status === 'applied' && command.type !== 'list') {
            try { onApplied({ commandId: command.id, ...candidate.identity }); } catch { }
          }
          await acknowledge(command.id, outcome, { ...candidate.identity, signal: candidate.controller.signal });
          if (!current(candidate)) return { result: 'inactive', processed };
          processed += 1;
        }
        pages += 1;
        if (pages >= MAX_PAGES) {
          lastResult = 'batch-limit';
          return { result: lastResult, processed };
        }
        if (commands.length > 0) candidate.requested = true;
      } while (candidate.requested);
      lastResult = 'idle';
      return { result: lastResult, processed };
    } catch {
      if (!current(candidate)) return { result: 'inactive', processed };
      lastResult = 'retry-needed';
      return { result: lastResult, processed };
    }
  }

  function requestDrain(candidate) {
    if (!current(candidate)) return Promise.resolve({ result: 'inactive', processed: 0 });
    candidate.requested = true;
    if (!candidate.ready) return Promise.resolve({ result: 'connecting', processed: 0 });
    if (!candidate.running) candidate.running = drain(candidate).finally(() => { candidate.running = null; });
    return candidate.running;
  }

  async function start() {
    const identity = identityOf(getLink());
    if (session && sameIdentity(session.identity, identity)) return session.started;
    stop();
    if (!identity) return { result: 'inactive', processed: 0 };
    const candidate = { identity, controller: new AbortController(), ready: false, requested: false, running: null, unsubscribe: null };
    session = candidate;
    lastResult = 'connecting';
    candidate.started = (async () => {
      try {
        const unsubscribe = await subscribe(identity, {
          signal: candidate.controller.signal,
          onSignal: () => requestDrain(candidate),
          onReconnect: () => requestDrain(candidate),
        });
        if (typeof unsubscribe !== 'function') throw new Error('Invalid subscription');
        if (!current(candidate)) {
          unsubscribe();
          return { result: 'inactive', processed: 0 };
        }
        candidate.unsubscribe = unsubscribe;
        candidate.ready = true;
        return await requestDrain(candidate);
      } catch {
        if (session === candidate) {
          stop();
          lastResult = 'connection-error';
        }
        return { result: 'connection-error', processed: 0 };
      }
    })();
    return candidate.started;
  }

  function fetchNow() {
    if (!session) return Promise.resolve({ result: 'inactive', processed: 0 });
    if (!current(session)) {
      stop();
      return Promise.resolve({ result: 'inactive', processed: 0 });
    }
    return requestDrain(session);
  }

  return { start, stop, fetchNow, status: () => ({ active: !!session && current(session), lastResult }) };
}

module.exports = { createCliqInbox };