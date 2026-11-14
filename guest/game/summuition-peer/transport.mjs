// The helper exchanges SDP only. Every game message uses this RTCDataChannel.
export class PeerLink {
  constructor({ onRoom = () => {}, onOpen = () => {}, onMessage = () => {}, onClose = () => {} } = {}) {
    Object.assign(this, { onRoom, onOpen, onMessage, onClose });
    this.role = null; this.code = null; this.token = null;
    this.pc = null; this.channel = null; this.closed = false;
    this.sentMessages = this.receivedMessages = this.gameMessagesSent = this.gameMessagesReceived = this.signalingRequests = 0;
    this.abort = new AbortController(); this.lastReceived = performance.now();
  }
  async request(path, body, authenticated = true) {
    this.signalingRequests++;
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated && this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: this.abort.signal,
    });
    if (!response.ok) {
      const messages = { 400: 'Enter a four-digit room code.', 403: 'This connection is no longer available.',
        404: 'Room not found. Ask the host for a new code.', 409: 'That room already has two players.',
        503: 'The local helper is full. Try again shortly.' };
      throw new Error(messages[response.status] || 'The local connection helper could not complete this request.');
    }
    return response.json();
  }
  makeConnection() {
    // Local proof only: no external STUN, TURN, telemetry or account service.
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'disconnected', 'closed'].includes(this.pc.connectionState))
        this.close('Connection lost. Match ended without a win.', false);
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
    const room = await this.request('/signal/create', {}, false);
    this.role = 'host'; this.code = room.code; this.token = room.token; this.onRoom(this.code, this.role);
    this.makeConnection(); this.attachChannel(this.pc.createDataChannel('summuition-peer-v1', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer()); await this.gather();
    await this.request('/signal/offer', { code: this.code, sdp: this.pc.localDescription.sdp });
    const answer = await this.pollFor('answer');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
    this.watchOpening();
  }
  async join(code) {
    const room = await this.request('/signal/join', { code }, false);
    this.role = 'guest'; this.code = room.code; this.token = room.token; this.onRoom(this.code, this.role);
    this.makeConnection();
    const offer = await this.pollFor('offer');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer()); await this.gather();
    await this.request('/signal/answer', { code: this.code, sdp: this.pc.localDescription.sdp });
    this.watchOpening();
  }
  watchOpening() {
    this.openingTimer = setTimeout(() => {
      if (this.channel?.readyState !== 'open') this.close('Peer connection timed out. Create a new room.', false);
    }, 20000);
  }
  close(reason = 'You left the match.', notifyPeer = true, cleanupSignal = notifyPeer) {
    if (this.closed || this.closing) return;
    // Sending the goodbye can itself fail and try to close this link.
    // Keep one owner for resource cleanup and the completion callback.
    this.closing = true;
    if (notifyPeer) this.sendFrame({ kind: 'bye' });
    this.closed = true; clearInterval(this.heartbeat); clearTimeout(this.openingTimer);
    this.abort.abort(); this.channel?.close(); this.pc?.close();
    // Best-effort signaling cleanup is not a match result or game message.
    // The departing tab owns cleanup. A peer reacting to its bye/close must
    // not issue a second deletion against the already removed room.
    if (cleanupSignal && this.token && this.code) fetch('/signal/leave', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ code: this.code }), keepalive: true,
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
      signalingRequests: this.signalingRequests, selectedCandidatePair, iceServers: 0 };
  }
}
