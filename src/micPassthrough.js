// Live mic -> chosen speaker passthrough (e.g. a USB adapter feeding a prop's
// earpiece). Can run continuously, or gated so it's only audible while the
// mic is within SpeechBridge's proximity-gate limits (the same condition
// under which it would actually transcribe something) — see setGated() and
// setGateOpen(). Gating matters because an ungated passthrough risks sound
// leaving the speaker and reaching the mic again in a continuous loop.
//
// This is a second, independent getUserMedia(audio) stream (micVolume.js
// already opened its own for level metering) — Web Audio has no supported
// way to hand one MediaStreamAudioSourceNode between two AudioContexts, and
// keeping this self-contained is simpler than threading a shared stream
// through both modules.

const GAIN_RAMP_SEC = 0.05; // quick fade on gate open/close, to avoid clicks
const VOLUME_RAMP_SEC = 0.02; // faster — a slider drag shouldn't feel laggy

export async function listAudioOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput');
}

export class MicPassthrough {
  constructor() {
    this.audioCtx = null;
    this.stream = null;
    this.volumeGain = null; // user-controlled multiplier, see setVolume()
    this.gateGain = null; // 0/1 mute from the proximity gate, see setGateOpen()
    this.audioEl = null; // carries the processed stream to a chosen output device
    this.state = 'off'; // off | starting | live | error
    this.error = null;
    this.gateOpen = false; // last known value from SpeechBridge, kept even while gated is false
    this.gated = false; // see setGated() — false plays continuously regardless of gateOpen
    this.volume = 1; // remembered across start()/stop() so a pre-set value sticks
    this.generation = 0; // bumped by stop(), so a late-resolving start() can tell it was superseded
  }

  async start() {
    this.state = 'starting';
    this.error = null;
    const generation = this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia unavailable (page must be on localhost or https)');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) {
        // stop() ran while the permission prompt was pending — this attempt
        // is stale, so undo it instead of reviving a feature that was
        // deliberately turned back off.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx({ latencyHint: 'interactive' });
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.volumeGain = this.audioCtx.createGain();
      this.volumeGain.gain.value = this.volume;
      this.gateGain = this.audioCtx.createGain();
      this.gateGain.gain.value = this.gated ? (this.gateOpen ? 1 : 0) : 1;
      const dest = this.audioCtx.createMediaStreamDestination();
      source.connect(this.volumeGain).connect(this.gateGain).connect(dest);

      this.audioEl = new Audio();
      this.audioEl.srcObject = dest.stream;
      this.audioEl.autoplay = true;
      await this.audioEl.play();
      if (generation !== this.generation) {
        // Stopped during that last await too — tear back down rather than
        // leaving a live audio graph behind a 'off' state.
        this._teardown();
        return;
      }
      this.state = 'live';
    } catch (e) {
      if (generation !== this.generation) return; // superseded by a stop(); not a real error anymore
      this.state = 'error';
      this.error = e.message;
      throw e;
    }
  }

  // open: whether the mic level is currently within the proximity gate's
  // limits (SpeechBridge's live gate state). Always recorded even when
  // gated is false, so flipping gating on mid-show applies the current
  // state immediately rather than waiting for the next change.
  setGateOpen(open) {
    this.gateOpen = open;
    if (this.gated) this._applyGate();
  }

  // enabled: true confines passthrough to moments the mic is within the
  // proximity gate's limits (muted otherwise); false plays continuously
  // regardless of gate state. Takes effect immediately if live; otherwise
  // just remembered for the next start().
  setGated(enabled) {
    this.gated = enabled;
    this._applyGate();
  }

  _applyGate() {
    if (!this.gateGain) return;
    const now = this.audioCtx.currentTime;
    this.gateGain.gain.cancelScheduledValues(now);
    this.gateGain.gain.setTargetAtTime(this.gated ? (this.gateOpen ? 1 : 0) : 1, now, GAIN_RAMP_SEC);
  }

  // multiplier: 0 (silent) and up — 1 is unity/pass-through level, >1 boosts.
  // Takes effect immediately if live; otherwise just remembered for the next
  // start() (so setting it before enabling passthrough works as expected).
  setVolume(multiplier) {
    this.volume = multiplier;
    if (!this.volumeGain) return;
    const now = this.audioCtx.currentTime;
    this.volumeGain.gain.cancelScheduledValues(now);
    this.volumeGain.gain.setTargetAtTime(multiplier, now, VOLUME_RAMP_SEC);
  }

  // deviceId: a MediaDeviceInfo.deviceId from listAudioOutputDevices(), or
  // '' for the system default. No-ops quietly if the browser doesn't
  // support output selection (setSinkId is Chrome-only).
  async setOutputDevice(deviceId) {
    if (!this.audioEl?.setSinkId) return;
    try {
      await this.audioEl.setSinkId(deviceId || '');
    } catch (e) {
      this.error = 'Output device: ' + e.message;
    }
  }

  stop() {
    this.generation++; // invalidates any start() still in flight
    this._teardown();
    this.state = 'off';
  }

  _teardown() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.volumeGain = null;
    this.gateGain = null;
  }
}
