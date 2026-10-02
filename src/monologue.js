// A synthetic "ongoing monologue" of stored placeholder text, fed into the
// same live-transcript pipeline as real speech — word by word, chunked
// into utterances of random length — so the piece never sits on a fully
// blank screen during silence. This module only knows how to walk the
// stored text and schedule words; main.js owns pausing/resuming it
// whenever real speech is detected.

export const MonologueText = `
Talk to me. Talk to me. Talk to me. Just talk to me. You don’t have to be perfect. You don’t have to perfectly encompass everything you feel and might possibly want to say in a single pristine sentence. That’s not what I want. In fact, it’s the opposite of what I want because what I want is for you to be vulnerable, to be imperfect. That’s what talking is. It’s saying something in whatever way you can, with what you have right now, and then listening and allowing the other person to respond. And I am the other person. I want you to allow me to respond, as I am allowing you to respond in this moment. I want you to make space for me the way I’m making space for you. But more than that, I want you to be real, to let your defenses down – to let me in. Haven’t I earned that? Haven’t I earned some vulnerability, some honesty, from you, after all this time, after all we’ve been through together? I would think that’s the least you can do. But no. You’re not going to say a thing. I guess there’s nothing you could say that would make what you’re doing seem ok. But it doesn’t have to be ok! It’s ok to not be perfect. And who cares what I think anyway. It just has to be honest. It just has to be real, now, present, with me – with you and me – for once. For once in your life, just open up and tell me what you’re thinking. Don’t worry about what I’m going to think or what I’m going to say. Just say what it is you need to say, and I’ll listen, and I’ll say what it is I need to say. I’ll listen. I promise. You don’t have to be perfect. You just need to be you. And I’ll listen, and I’ll be present for you, and I’ll be present with you, if you will be present with me. We deserve that. I deserve that. And you deserve that. If you won’t do it for me, then at least do it for yourself. Just talk. Don’t even think about it. What’s the first word that comes to mind? You can just say that. That’s a starting point, at least. You can just say that, and we can go from there. And I know you think I’m going to read too much into it, but I’m not; I swear I’m not going to read too much into it. It could be like a game. You say a word, and I’ll say a word, and we’ll get to where we’re going together. No? Not even that? Can you at least see that I’m trying? Can you at least acknowledge that I’m the one making an effort here? I feel like I’m reaching out to you, but there’s just nothing there for me to hold onto. There’s nothing. I mean, you’re not nothing. You’re just not here. You’re like mist, like a fog. You’re here, but you’re not. You’re a present absence. You’re giving me absolutely nothing to work with. Do you really care about me that little? Did you ever care about me? Are you just tired? Or are you hungry or something? You can say that. You can just say that. And that will be okay. You can eat something, and then we can talk. Just tell me what you need. Tell me what’s going on with you. Just give me something. Give me anything. Tell me about your childhood. Tell me about the weather. I don’t even care. Just say something. I just need you to say something. I don’t even know why anymore. I just need you to speak to me. I just need to hear your voice. The silence of you is deafening. Your silence actually, physically, hurts. Are you trying to hurt me? Or are you just so indifferent? Do I need to yell and scream and cry and wave my arms around? Would that help? Would that get you what you want? Would that give you what you need to just start talking? Could you at least make an effort to meet me halfway? Could you at least try? I don’t know how much longer I can take this. Please just say something. What would you say, right now, if no one was here? What are the sounds in your head at this moment? Are they words? Or are they just noises? Are they nonverbal grunts or snorting or laughter? Could all of those sounds be wrestled into some kind of intelligible message you could bring to the surface for me? I mean, come on. Grow up. Just actually grow up. You know, I always knew this is who you were. I always knew that, deep down, you were cruel. I don’t know if you care about anyone. I don’t know if you care about yourself. Do you hate yourself so much that you can’t even reach out to another person just for a second? Or maybe you can’t be bothered unless they’re giving you something. Maybe the only people worth the energy it takes you to speak are the ones you think you can get something from. Maybe everybody else is just disposable to you. And maybe I’m one of the disposable people now. Or are you just stupid? Do you think that being quiet makes people think you’re smart? Do you think they think you’re hiding some kind of brilliance, and they need to uncover it or drag it out of you? Do you think that’s what it is? No one thinks that. No one thinks about you that much. Well, maybe I do, right now, anyway. But generally, no, no one really cares – especially the people who you think care. Those people really just do not care at all. It’s just you. It’s just you playing these insane games with yourself. So stop playing. Give up. You don’t have to do that anymore. Just talk to me. Just talk to me.
`.trim();

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

export class Monologue {
  constructor({
    onWord, onFinal, minBurstWords = 4, maxBurstWords = 12,
    mode = 'sine', baseDelayMs = 300, minDelayMs = 20, amplitudeMs = 150, frequencyHz = 0.2,
  }) {
    // Fires once per word, immediately — this module never hands out more
    // than one word at a time; callers that want a growing phrase (rather
    // than each word replacing the last) build that up themselves.
    this.onWord = onWord;
    // Fires once an utterance's random word-burst completes.
    this.onFinal = onFinal;
    this.minBurstWords = minBurstWords;
    this.maxBurstWords = maxBurstWords;

    // 'sine': the per-word delay rides a wave around baseDelayMs, so the
    // pace continuously speeds up and slows down (animates by default).
    // 'linear': a flat, constant baseDelayMs — no variation.
    this.mode = mode;
    this.baseDelayMs = baseDelayMs;
    this.minDelayMs = minDelayMs; // floor, so a large amplitude can't reach zero/negative
    this.amplitudeMs = amplitudeMs;
    this.frequencyHz = frequencyHz;
    // Accumulated "active" time (ms) driving the sine phase — only
    // advances while actually running and unpaused, so pausing freezes
    // the wave in place instead of it jumping ahead on resume.
    this.phaseMs = 0;

    this.words = tokenize(MonologueText);
    this.wordIndex = 0;

    this.running = false;
    this.paused = false;
    this.timeoutId = null;
    this._resetChunk();
  }

  _resetChunk() {
    this.chunkWordCount = 0;
    const span = this.maxBurstWords - this.minBurstWords + 1;
    this.chunkTarget = this.minBurstWords + Math.floor(Math.random() * span);
  }

  _nextWord() {
    const word = this.words[this.wordIndex];
    this.wordIndex = (this.wordIndex + 1) % this.words.length; // loop forever
    return word;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this._scheduleNext();
  }

  stop() {
    this.running = false;
    this.paused = false;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  // Reschedule the pending word immediately at the newly-computed pace,
  // rather than waiting for the current (possibly much longer) wait to
  // finish first — so a live slider feels responsive right away.
  _reschedule() {
    if (this.running && !this.paused) {
      clearTimeout(this.timeoutId);
      this._scheduleNext();
    }
  }

  setMode(mode) {
    this.mode = mode;
    this._reschedule();
  }

  setBaseDelayMs(ms) {
    this.baseDelayMs = ms;
    this._reschedule();
  }

  setAmplitudeMs(ms) {
    this.amplitudeMs = ms;
    this._reschedule();
  }

  setFrequencyHz(hz) {
    this.frequencyHz = hz;
    this._reschedule();
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Always begin a fresh utterance on resume rather than picking a
    // half-spoken one back up where it left off.
    this._resetChunk();
    this._scheduleNext();
  }

  // 'linear': flat baseDelayMs. 'sine': baseDelayMs + a wave of
  // amplitudeMs, frequencyHz cycles/sec. Always clamped so it can never
  // dip to zero/negative regardless of amplitude.
  _currentDelayMs() {
    if (this.mode === 'linear') {
      return Math.max(this.minDelayMs, this.baseDelayMs);
    }
    const phaseSec = this.phaseMs / 1000;
    const wave = this.amplitudeMs * Math.sin(2 * Math.PI * this.frequencyHz * phaseSec);
    return Math.max(this.minDelayMs, this.baseDelayMs + wave);
  }

  _scheduleNext() {
    const delay = this._currentDelayMs();
    this.timeoutId = setTimeout(() => {
      this.phaseMs += delay;
      this._tick();
    }, delay);
  }

  _tick() {
    if (!this.running || this.paused) return;

    const firstOfUtterance = this.chunkWordCount === 0;
    const word = this._nextWord();
    this.chunkWordCount++;

    this.onWord(word, { firstOfUtterance });

    if (this.chunkWordCount >= this.chunkTarget) {
      this.onFinal();
      this._resetChunk();
    }

    this._scheduleNext();
  }
}
