'use strict';

/**
 * The live "something changed" signal for shared workspaces, over Ably. One connection listens on every workspace's
 * channel; the message carries only a sequence number, so a signal is a prompt to pull, never trusted as data.
 * The token comes from the cloud (POST /ws/token), is subscribe-only, and is renewed by Ably itself when it expires.
 * Nothing here polls: when the connection drops, Ably reconnects on its own and `onReconnect` makes the engine catch up.
 */
const CHANNEL = /^hitlist:ws:[a-f0-9]{64}$/;
const WORKSPACE = /^[A-Za-z0-9_-]{43}$/;
const EVENT = 'workspace-changed';

function createWorkspacePush({ requestToken, createRealtime = (options) => new (require('ably').Realtime)(options) }) {
  /**
   * Starts listening. `onSignal(workspaceId, seq)` for each doorbell; `onReconnect()` after every re-attach.
   * Resolves a stop() function, or null when there is nothing to listen to yet (no workspaces).
   */
  async function subscribe({ signal, onSignal, onReconnect, onUnavailable = () => {} }) {
    if (signal.aborted) throw new Error('Push subscription cancelled');
    let first = await requestToken({ signal });
    const valid = (auth) => auth && typeof auth.channels === 'object' && auth.channels
      && Object.entries(auth.channels).every(([id, channel]) => WORKSPACE.test(id) && CHANNEL.test(channel))
      && (Object.keys(auth.channels).length === 0 || (typeof auth.token === 'string' && auth.token && auth.token.length <= 8192));
    if (!valid(first)) throw new Error('Invalid push authorization');
    if (Object.keys(first.channels).length === 0) return null;
    const expected = { ...first.channels };

    let client;
    let closed = false;
    let attachedOnce = 0;
    let ready = false;
    const channels = [];
    let lastReason = '';
    const unavailable = (change) => {
      if (change && change.reason && change.reason.message) lastReason = String(change.reason.message);
      if (closed || signal.aborted) return;
      stop();
      if (ready) onUnavailable(lastReason);
    };
    const stop = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', stop);
      for (const { channel, handlers } of channels) {
        channel.off('attached', handlers.attached);
        channel.off('failed', unavailable);
        channel.off('suspended', unavailable);
        channel.unsubscribe(EVENT, handlers.message);
      }
      if (client) {
        client.connection?.off('failed', unavailable);
        client.connection?.off('suspended', unavailable);
        client.close();
      }
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      client = createRealtime({
        autoConnect: false,
        token: first.token,
        logLevel: 0,
        authCallback: (_params, callback) => {
          void requestToken({ signal }).then((fresh) => {
            // A different set of workspaces needs a fresh connection (the engine restarts us); keep the old rights meanwhile.
            if (!valid(fresh) || !fresh.token) throw new Error('bad');
            callback(null, fresh.token);
          }).catch(() => callback(new Error('Push authorization unavailable')));
        },
      });
      client.connection?.on('failed', unavailable);
      client.connection?.on('suspended', unavailable);
      for (const [workspaceId, name] of Object.entries(expected)) {
        const channel = client.channels.get(name);
        const handlers = {
          message: (message) => {
            const seq = message && message.data && Number.isSafeInteger(message.data.seq) ? message.data.seq : null;
            if (!closed && !signal.aborted) void onSignal(workspaceId, seq);
          },
          attached: () => { attachedOnce += 1; if (attachedOnce > channels.length && !closed && !signal.aborted) void onReconnect(); },
        };
        channel.on('attached', handlers.attached);
        channel.on('failed', unavailable);
        channel.on('suspended', unavailable);
        channels.push({ channel, handlers });
      }
      client.connect();
      await Promise.all(channels.map(({ channel, handlers }) => channel.subscribe(EVENT, handlers.message)));
      if (closed || signal.aborted) throw new Error('Push subscription cancelled');
      first = null;
      ready = true;
      return stop;
    } catch (cause) {
      stop();
      // The reason is kept (the connection's own, else the error's) so the app can say why the live signal is down.
      throw new Error('Push connection unavailable', { cause: lastReason ? new Error(lastReason) : cause });
    }
  }
  return { subscribe };
}

module.exports = { createWorkspacePush };
