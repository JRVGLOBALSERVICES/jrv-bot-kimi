const config = require('../config');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Phone Bridge - Voice calls via SIP/VoIP.
 * Enables JARVIS to answer and make actual phone calls.
 *
 * Architecture:
 * Phone Call → SIP Server → Asterisk/FreeSWITCH → WebSocket → JARVIS
 *
 * For the Jetson deployment, we use:
 * - FreeSWITCH (open source PBX) running on the Jetson
 * - SIP trunk from a Malaysian VoIP provider (e.g., MyTelco, CXIP)
 * - Audio streamed via WebSocket for real-time processing
 *
 * For laptop dev mode, this module is a stub that logs calls.
 */
class PhoneBridge {
  constructor() {
    this.enabled = config.sip.enabled;
    this.activeCalls = new Map();
    this.onIncomingCall = null;
    this.onCallAudio = null;
  }

  async init(handlers = {}) {
    this.onIncomingCall = handlers.onIncomingCall || null;
    this.onCallAudio = handlers.onCallAudio || null;

    if (!this.enabled) {
      console.log('[Phone] SIP not configured — phone bridge disabled');
      return;
    }

    if (config.mode === 'laptop') {
      console.log('[Phone] Running in laptop mode — calls will be simulated');
      return;
    }

    // In Jetson mode, connect to FreeSWITCH Event Socket
    await this._connectToFreeSWITCH();
  }

  async _connectToFreeSWITCH() {
    try {
      // FreeSWITCH Event Socket Library (ESL)
      // This connects to the local FreeSWITCH instance
      const WebSocket = require('ws');
      const ws = new WebSocket('ws://localhost:8021/ws');

      ws.on('open', () => {
        console.log('[Phone] Connected to FreeSWITCH');
        // Authenticate
        ws.send(JSON.stringify({ command: 'auth', data: 'ClueCon' }));
        // Subscribe to events
        ws.send(JSON.stringify({ command: 'event', data: 'CHANNEL_CREATE CHANNEL_HANGUP DTMF' }));
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data);
          this._handleEvent(event);
        } catch {
          // Binary audio data
          if (this.onCallAudio) {
            this.onCallAudio(data);
          }
        }
      });

      ws.on('error', (err) => {
        console.error('[Phone] FreeSWITCH error:', err.message);
      });

      ws.on('close', () => {
        console.warn('[Phone] FreeSWITCH disconnected — retrying in 5s');
        setTimeout(() => this._connectToFreeSWITCH(), 5000);
      });
    } catch (err) {
      console.error('[Phone] Failed to connect to FreeSWITCH:', err.message);
    }
  }

  _handleEvent(event) {
    if (event.event === 'CHANNEL_CREATE') {
      const callId = event.uuid;
      const callerNumber = event.caller_id_number;

      this.activeCalls.set(callId, {
        id: callId,
        from: callerNumber,
        startTime: new Date(),
        status: 'ringing',
      });

      console.log(`[Phone] Incoming call from ${callerNumber}`);

      if (this.onIncomingCall) {
        this.onIncomingCall({
          callId,
          from: callerNumber,
          answer: () => this.answerCall(callId),
          hangup: () => this.hangupCall(callId),
        });
      }
    }

    if (event.event === 'CHANNEL_HANGUP') {
      const callId = event.uuid;
      this.activeCalls.delete(callId);
      console.log(`[Phone] Call ended: ${callId}`);
    }
  }

  // ─── Call Control ─────────────────────────────────────

  async makeCall(phoneNumber) {
    if (!this.enabled) {
      console.log(`[Phone] SIMULATED: Calling ${phoneNumber}`);
      return { callId: `sim_${Date.now()}`, status: 'simulated' };
    }

    // Originate call via FreeSWITCH
    const callId = `call_${Date.now()}`;
    this.activeCalls.set(callId, {
      id: callId,
      to: phoneNumber,
      startTime: new Date(),
      status: 'dialing',
    });

    console.log(`[Phone] Dialing ${phoneNumber}...`);
    return { callId, status: 'dialing' };
  }

  async answerCall(callId) {
    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = 'active';
      console.log(`[Phone] Answered call ${callId}`);
    }
  }

  async hangupCall(callId) {
    this.activeCalls.delete(callId);
    console.log(`[Phone] Hung up call ${callId}`);
  }

  /**
   * Send audio to an active call.
   * @param {string} callId
   * @param {string} audioPath - Path to audio file
   */
  async playAudio(callId, audioPath) {
    const call = this.activeCalls.get(callId);
    if (!call || call.status !== 'active') {
      throw new Error(`No active call ${callId}`);
    }

    console.log(`[Phone] Playing audio to call ${callId}: ${audioPath}`);
    // In production, stream audio to FreeSWITCH channel
  }

  getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  isEnabled() {
    return this.enabled;
  }

  async destroy() {
    for (const [id] of this.activeCalls) {
      await this.hangupCall(id);
    }
    this.activeCalls.clear();
  }
}

module.exports = new PhoneBridge();
