// The helper exchanges SDP only. Every game message uses this RTCDataChannel.
export class PeerLink {
  constructor({ onRoom = () => {}, onOpen = () => {}, onMessage = () => {}, onClose = () => {}, signalingBaseUrl = '', iceServers = [] } = {}) {
    Object.assign(this, { onRoom, onOpen, onMessage, onClose });
    // Deployment-owned configuration only. No service or external ICE is enabled by default.
    this.signalingBaseUrl = '';
    if (signalingBaseUrl) {
      const url = new URL(signalingBaseUrl);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
          url.username || url.password || url.search || url.hash)
        throw new Error('Signaling requires HTTPS (or local loopback) without URL credentials.');
      this.signalingBaseUrl = url.href.replace(/\/$/, '');
    }
    if (!Array.isArray(iceServers)) throw new Error('Invalid ICE configuration.');
    this.iceServers = structuredClone(iceServers);
    this.role = null; this.code = null; this.token = null;
    this.pc = null; this.channel = null; this.closed = false;
    this.sentMessages = this.receivedMessages = this.gameMessagesSent = this.gameMessagesReceived = this.signalingRequests = 0;
    this.abort = new AbortController(); this.lastReceived = performance.now();
  }
  signalUrl(path) { return this.signalingBaseUrl + path; }
  async request(path, body, authenticated = true) {
    this.signalingRequests++;
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated && this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(this.signalUrl(path), {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: this.abort.signal,
    });
    if (!response.ok) {
      const messages = { 400: 'Enter a four-digit room code.', 403: 'This connection is no longer available.',
        404: 'Room not found. Ask the host for a new code.', 409: 'That room already has two players.',
        503: 'The local helper is full. Try again shortly.' };
      const error = new Error(messages[response.status] || 'The local connection helper could not complete this request.');
      error.status = response.status; throw error;
    }
    return response.json();
  }
  makeConnection() {
    // Only explicitly supplied, deployment-approved ICE servers are used.
    this.pc = new RTCPeerConnection({ iceServers: this.localMode ? [] : this.iceServers });
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.closed) return;
      const state = this.pc.connectionState;
      if (state === 'connected') { clearTimeout(this.disconnectTimer); this.disconnectTimer = null; }
      else if (state === 'disconnected' && !this.disconnectTimer) {
        // ICE disconnected can recover after a brief Wi-Fi/mobile transition.
        this.disconnectTimer = setTimeout(() => {
          if (!this.closed && this.pc.connectionState === 'disconnected')
            this.close('Network interrupted. No win awarded.', false);
        }, 8000);
      } else if (state === 'failed') this.close('Direct connection failed. Relay may be needed. No win awarded.', false);
      else if (state === 'closed') this.close('Connection lost. Match ended without a win.', false);
    });
    this.pc.addEventListener('datachannel', event => {
      if (this.role !== 'guest' || this.channel || event.channel.label !== 'summuition-peer-v1') {
        event.channel.close(); return;
      }
      this.attachChannel(event.channel);
    });
  }
  attachChannel(channel) {
    this.channel = channel;
    channel.addEventListener('open', () => {
      if (this.closed) return;
      this.lastReceived = performance.now();
      this.heartbeat = setInterval(() => {
        if (performance.now() - this.lastReceived > 12000) {
          this.close('Connection lost. Match ended without a win.', false); return;
        }
        this.sendFrame({ kind: 'ping' });
      }, 1000);
      this.onOpen();
    });
    channel.addEventListener('message', event => {
      if (this.closed || typeof event.data !== 'string' || event.data.length > 32768) {
        this.close('Invalid peer message. Match ended without a win.', false); return;
      }
      try {
        const message = JSON.parse(event.data);
        if (!message || typeof message !== 'object' || message.version !== 1) throw new Error('Protocol');
        this.receivedMessages++; this.lastReceived = performance.now();
        if (message.kind === 'ping') this.sendFrame({ kind: 'pong' });
        else if (message.kind === 'pong') { /* Keepalive only; no match authority. */ }
        else if (message.kind === 'bye') this.close('The other player left. Match ended without a win.', false);
        else if (message.kind === 'game') { this.gameMessagesReceived++; this.onMessage(message.payload); }
        else throw new Error('Protocol');
      } catch { this.close('Invalid peer message. Match ended without a win.', false); }
    });
    channel.addEventListener('close', () => this.close('Connection lost. Match ended without a win.', false));
    channel.addEventListener('error', () => this.close('Connection lost. Match ended without a win.', false));
  }
  sendFrame(message) {
    if (this.closed || this.channel?.readyState !== 'open') return false;
    const value = JSON.stringify({ ...message, version: 1 });
    if (value.length > 32768 || this.channel.bufferedAmount > 131072) {
      this.close('Connection stalled. Match ended without a win.', false); return false;
    }
    try { this.channel.send(value); this.sentMessages++; return true; }
    catch { this.close('Connection lost. Match ended without a win.', false); return false; }
  }
  send(payload) {
    const sent = this.sendFrame({ kind: 'game', payload });
    if (sent) this.gameMessagesSent++;
    return sent;
  }
  async gather() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', changed);
        this.abort.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const changed = () => { if (this.pc.iceGatheringState === 'complete') finish(); };
      const aborted = () => finish(new Error('Connection closed.'));
      const timer = setTimeout(() => finish(new Error('Local connection discovery timed out.')), 12000);
      this.pc.addEventListener('icegatheringstatechange', changed);
      this.abort.signal.addEventListener('abort', aborted, { once: true }); changed();
    });
  }
  async pollFor(field) {
    const until = performance.now() + 60000;
    while (!this.closed && performance.now() < until) {
      const reply = await this.request(`/signal/poll?code=${encodeURIComponent(this.code)}`);
      if (reply[field]) return reply[field];
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error(this.closed ? 'Connection closed.' : 'No peer connected. Create a new room to try again.');
  }
  async host() {
    let room;
    try { room = await this.request('/signal/create', {}, false); }
    catch (error) {
      if (!this.signalingBaseUrl && [404, 405, 501].includes(error.status) && !this.closed) return this.hostSameBrowser();
      throw error;
    }
    this.role = 'host'; this.code = room.code; this.token = room.token; this.onRoom(this.code, this.role);
    this.makeConnection(); this.attachChannel(this.pc.createDataChannel('summuition-peer-v1', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gather();
    await this.request('/signal/offer', { code: this.code, sdp: this.pc.localDescription.sdp });
    const answer = await this.pollFor('answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
    this.watchOpening();
  }
  async join(code) {
    let room;
    try { room = await this.request('/signal/join', { code }, false); }
    catch (error) {
      if (!this.signalingBaseUrl && [404, 405, 501].includes(error.status) && !this.closed) return this.joinSameBrowser(code);
      throw error;
    }
    this.role = 'guest'; this.code = room.code; this.token = room.token; this.onRoom(this.code, this.role);
    this.makeConnection();
    const offer = await this.pollFor('offer');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gather();
    await this.request('/signal/answer', { code: this.code, sdp: this.pc.localDescription.sdp });
    this.watchOpening();
  }
  // Static hosting has no /signal API. Exchange only SDP between tabs on the
  // same origin/profile; the existing RTCDataChannel still carries gameplay.
  // Web Locks gives each four-digit code one live owner, released on tab exit.
  requireSameBrowser() {
    if (typeof BroadcastChannel !== 'function' || !globalThis.navigator?.locks)
      throw new Error('Local rooms need a browser with same-device tab support.');
    if (this.closed) throw new Error('Connection closed.');
    this.localMode = true;
  }
  async reserveLocalCode() {
    for (let i = 0; i < 32 && !this.closed; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
      const acquired = await new Promise((resolve, reject) => {
        navigator.locks.request('summuition-room-v1-' + code, { ifAvailable: true }, lock => {
          if (!lock || this.closed) { resolve(false); return; }
          return new Promise(release => { this.releaseLocalRoom = release; resolve(true); });
        }).catch(reject);
      });
      if (acquired) return code;
    }
    throw new Error('Could not reserve a local room. Try again.');
  }
  localSignal(message) {
    if (!this.closed && this.localBus) this.localBus.postMessage({ version: 1, ...message });
  }
  async hostSameBrowser() {
    this.requireSameBrowser();
    this.role = 'host'; this.code = await this.reserveLocalCode();
    if (this.closed) { this.releaseLocalRoom?.(); return; }
    this.localBus = new BroadcastChannel('summuition-room-v1-' + this.code);
    this.makeConnection(); this.attachChannel(this.pc.createDataChannel('summuition-peer-v1', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gather();
    if (this.closed) return;
    const offer = this.pc.localDescription.sdp;
    this.localBus.onmessage = async ({ data: message }) => {
      if (this.closed || !message || message.version !== 1 ||
          typeof message.guest !== 'string' || !/^[a-f0-9-]{36}$/.test(message.guest)) return;
      if (message.kind === 'join') {
        if (this.localGuest && this.localGuest !== message.guest) {
          this.localSignal({ kind: 'full', guest: message.guest }); return;
        }
        this.localGuest = message.guest;
        this.localSignal({ kind: 'offer', guest: message.guest, sdp: offer });
      } else if (message.kind === 'answer' && message.guest === this.localGuest && !this.localAnswered &&
                 typeof message.sdp === 'string' && message.sdp.length < 32768) {
        this.localAnswered = true; clearTimeout(this.localWaitTimer);
        try { await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }); this.watchOpening(); }
        catch { if (!this.closed) this.close('Local connection failed. Create another room.', false); }
      }
    };
    this.localWaitTimer = setTimeout(() => this.close('No local player joined. Create another room.', false), 120000);
    this.onRoom(this.code, this.role);
  }
  async joinSameBrowser(code) {
    this.requireSameBrowser();
    if (!/^\d{4}$/.test(code)) throw new Error('Enter a four-digit room code.');
    this.role = 'guest'; this.code = code;
    this.localGuest = crypto.randomUUID();
    this.localBus = new BroadcastChannel('summuition-room-v1-' + code);
    this.makeConnection();
    await new Promise((resolve, reject) => {
      let accepted = false, settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        clearTimeout(this.localWaitTimer); clearInterval(this.localJoinTimer);
        this.abort.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const aborted = () => finish(new Error('Connection closed.'));
      this.abort.signal.addEventListener('abort', aborted, { once: true });
      this.localBus.onmessage = async ({ data: message }) => {
        if (this.closed || settled || !message || message.version !== 1 || message.guest !== this.localGuest) return;
        if (message.kind === 'full') { finish(new Error('That room already has two players.')); return; }
        if (message.kind !== 'offer' || accepted || typeof message.sdp !== 'string' || message.sdp.length >= 32768) return;
        accepted = true; clearInterval(this.localJoinTimer);
        try {
          await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
          await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gather();
          if (this.closed) return;
          this.localSignal({ kind: 'answer', guest: this.localGuest, sdp: this.pc.localDescription.sdp });
          this.onRoom(this.code, this.role); this.watchOpening(); finish();
        } catch (error) { finish(error); }
      };
      this.localWaitTimer = setTimeout(() => finish(new Error('No room found in this browser. Open both tabs on the same device.')), 10000);
      const join = () => this.localSignal({ kind: 'join', guest: this.localGuest });
      this.localJoinTimer = setInterval(join, 300); join();
    });
  }
  watchOpening() {
    this.openingTimer = setTimeout(() => {
      if (this.channel?.readyState !== 'open') this.close('Direct connection timed out. Relay may be needed. No win awarded.', false);
    }, 30000);
  }
  close(reason = 'You left the match.', notifyPeer = true, cleanupSignal = notifyPeer) {
    if (this.closed || this.closing) return;
    // Sending the goodbye can itself fail and try to close this link.
    // Keep one owner for resource cleanup and the completion callback.
    this.closing = true;
    if (notifyPeer) this.sendFrame({ kind: 'bye' });
    this.closed = true; clearInterval(this.heartbeat); clearTimeout(this.openingTimer); clearTimeout(this.disconnectTimer);
    this.abort.abort(); this.channel?.close(); this.pc?.close();
    clearTimeout(this.localWaitTimer); clearInterval(this.localJoinTimer);
    this.localBus?.close(); this.localBus = null;
    this.releaseLocalRoom?.(); this.releaseLocalRoom = null;
    // Best-effort signaling cleanup is not a match result or game message.
    // The departing tab owns cleanup. A peer reacting to its bye/close must
    // not issue a second deletion against the already removed room.
    if (cleanupSignal && this.token && this.code) fetch(this.signalUrl('/signal/leave'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ code: this.code }), keepalive: true, credentials: 'omit', redirect: 'error',
    }).catch(() => {});
    this.onClose(reason);
  }
  async diagnostics() {
    let selectedCandidatePair = null;
    if (this.pc && !this.closed) {
      const stats = await this.pc.getStats();
      const transport = [...stats.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
      const pair = transport ? stats.get(transport.selectedCandidatePairId) :
        [...stats.values()].find(item => item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded');
      if (pair) selectedCandidatePair = {
        state: pair.state, nominated: pair.nominated, bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived,
        localType: stats.get(pair.localCandidateId)?.candidateType,
        remoteType: stats.get(pair.remoteCandidateId)?.candidateType,
      };
    }
    return { role: this.role, code: this.code, connectionState: this.pc?.connectionState || 'new',
      channelState: this.channel?.readyState || 'new', sentMessages: this.sentMessages, receivedMessages: this.receivedMessages,
      gameMessagesSent: this.gameMessagesSent, gameMessagesReceived: this.gameMessagesReceived,
      signalingRequests: this.signalingRequests, signalingMode: this.localMode ? 'same-browser' : 'service', selectedCandidatePair, iceServers: this.localMode ? 0 : this.iceServers.length };
  }
}
