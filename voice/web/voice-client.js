/**
 * Browser client for the Interlock voice service.
 *
 * Dependency-free ES module. The Three.js frontend can import it directly
 * without adding a package:
 *
 *   import { VoiceClient } from '../../voice/web/voice-client.js';
 *   const voice = new VoiceClient({ baseUrl: 'http://127.0.0.1:8090' });
 *   voice.setContext(() => buildSceneContext());   // called on every question
 *   await voice.ask('How safe is the path to my school?');
 *
 * The ElevenLabs key lives only in the Python service. Nothing here ever
 * sees it, so no secret reaches the browser bundle.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8090';

export class VoiceClient {
  #baseUrl;
  #contextProvider;
  #audio = null;
  #recorder = null;
  #chunks = [];

  constructor({ baseUrl = DEFAULT_BASE_URL, contextProvider = () => ({}) } = {}) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#contextProvider = contextProvider;
  }

  /** Supply a function returning the current scene state for each question. */
  setContext(provider) {
    this.#contextProvider = typeof provider === 'function' ? provider : () => provider;
  }

  /** Is the service up, and can it actually produce audio? */
  async health() {
    const response = await fetch(`${this.#baseUrl}/health`);
    if (!response.ok) throw new Error(`Voice service unavailable (${response.status}).`);
    return response.json();
  }

  /**
   * Ask a grounded question about the map.
   * Resolves to { intent, text, grounded, missing, audioError }.
   * Audio plays automatically when `speak` is true and the service has a key.
   */
  async ask(question, { speak = true, voiceId = null, autoplay = true } = {}) {
    const response = await fetch(`${this.#baseUrl}/voice/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: this.#contextProvider() ?? {},
        speak,
        voice_id: voiceId,
      }),
    });
    if (!response.ok) throw new Error(await describeError(response));
    const result = await response.json();
    if (autoplay && result.audio_base64) {
      await this.#play(base64ToBlob(result.audio_base64, result.audio_content_type));
    }
    return {
      intent: result.intent,
      text: result.text,
      grounded: result.grounded,
      missing: result.missing ?? [],
      audioError: result.audio_error ?? null,
    };
  }

  /** Read arbitrary UI text aloud: a street name, a warning, a summary. */
  async speak(text, { voiceId = null } = {}) {
    const response = await fetch(`${this.#baseUrl}/voice/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });
    if (!response.ok) throw new Error(await describeError(response));
    await this.#play(await response.blob());
  }

  /** Stop any narration currently playing. */
  stop() {
    if (!this.#audio) return;
    this.#audio.pause();
    URL.revokeObjectURL(this.#audio.src);
    this.#audio = null;
  }

  /** True once the browser grants microphone access and recording starts. */
  async startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser has no microphone API.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.#chunks = [];
    this.#recorder = new MediaRecorder(stream);
    this.#recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    };
    this.#recorder.start();
    return true;
  }

  /**
   * Stop recording and run the full loop: transcribe, answer, speak.
   * Resolves to the same shape as `ask`, plus the `question` transcript.
   */
  async stopRecordingAndAsk({ speak = true, autoplay = true } = {}) {
    const recorder = this.#recorder;
    if (!recorder) throw new Error('Recording was never started.');
    this.#recorder = null;

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.#chunks, { type: 'audio/webm' }));
      recorder.stop();
    });
    recorder.stream.getTracks().forEach((track) => track.stop());

    const form = new FormData();
    form.append('file', blob, 'question.webm');
    form.append('context', JSON.stringify(this.#contextProvider() ?? {}));
    form.append('speak_reply', String(speak));

    const response = await fetch(`${this.#baseUrl}/voice/converse`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(await describeError(response));
    const result = await response.json();
    if (autoplay && result.audio_base64) {
      await this.#play(base64ToBlob(result.audio_base64, result.audio_content_type));
    }
    return {
      intent: result.intent,
      text: result.text,
      grounded: result.grounded,
      missing: result.missing ?? [],
      audioError: result.audio_error ?? null,
    };
  }

  async #play(blob) {
    this.stop();
    const audio = new Audio(URL.createObjectURL(blob));
    this.#audio = audio;
    try {
      await audio.play();
    } catch {
      // Autoplay policies block sound before a user gesture. The caller still
      // has the answer text, so a silent failure here is the right behavior.
    }
  }
}

function base64ToBlob(base64, contentType = 'audio/mpeg') {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

async function describeError(response) {
  try {
    const body = await response.json();
    return body.detail ?? `Voice request failed (${response.status}).`;
  } catch {
    return `Voice request failed (${response.status}).`;
  }
}

export default VoiceClient;
