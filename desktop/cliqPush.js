'use strict';

function createCliqPush({ requestToken, createRealtime = (options) => new (require('ably').Realtime)(options) }) {
  async function subscribe(identity, { signal, onSignal, onReconnect }) {
    let client;
    let channel;
    let closed = false;
    let attached = false;
    let expectedChannel;
    let rejectAbort;
    const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', cancel);
      if (channel) {
        channel.off('attached', reattached);
        channel.unsubscribe('inbox-changed', changed);
      }
      if (client) client.close();
    };
    const cancel = () => {
      cleanup();
      rejectAbort(new Error('Push subscription cancelled'));
    };
    const changed = () => { if (!closed && !signal.aborted) void onSignal(); };
    const reattached = () => { if (attached && !closed && !signal.aborted) void onReconnect(); };

    async function issueToken() {
      if (closed || signal.aborted) throw new Error('Push subscription cancelled');
      const result = await requestToken(identity, { signal });
      if (closed || signal.aborted) throw new Error('Push subscription cancelled');
      if (!result || result.accountId !== identity.accountId || result.deviceId !== identity.deviceId
        || result.generation !== identity.generation || typeof result.channel !== 'string'
        || !/^hitlist:inbox:[a-zA-Z0-9_-]{16,128}$/.test(result.channel)
        || typeof result.token !== 'string' || !result.token || result.token.length > 8192
        || expectedChannel && result.channel !== expectedChannel) {
        throw new Error('Invalid push authorization');
      }
      expectedChannel = result.channel;
      return result.token;
    }

    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) throw new Error('Push subscription cancelled');
      const token = await Promise.race([issueToken(), aborted]);
      client = createRealtime({
        autoConnect: false,
        token,
        logLevel: 0,
        authCallback: (_params, callback) => {
          void issueToken().then((freshToken) => callback(null, freshToken), () => callback(new Error('Push authorization unavailable')));
        },
      });
      channel = client.channels.get(expectedChannel);
      channel.on('attached', reattached);
      client.connect();
      await Promise.race([channel.subscribe('inbox-changed', changed), aborted]);
      if (closed || signal.aborted) throw new Error('Push subscription cancelled');
      attached = true;
      return cleanup;
    } catch {
      cleanup();
      throw new Error('Push connection unavailable');
    }
  }

  return { subscribe };
}

module.exports = { createCliqPush };