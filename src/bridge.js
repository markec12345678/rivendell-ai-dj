// Rivendell AI DJ Bridge — main orchestration
//
// This script polls Rivendell's RDXport API for "now playing" changes,
// generates a DJ link between the current and next track using an LLM,
// synthesizes speech with TTS, and imports the result back into Rivendell
// as a voice track cart that gets inserted into the log.
//
// Polling strategy:
//   - Poll /rd-bin/rdnowplaying every 5 seconds
//   - When the cart number changes, a track transition just happened
//   - Look ahead in the log to find the next track
//   - Generate DJ link + TTS
//   - Import as a new cart into the "AI_DJ" group
//   - (Optional) Insert into the active log via RDXport
//
// The bridge is read-only on Rivendell state until a transition is detected,
// then it does one write (import) per transition.

import { RDXportClient } from './rdxport-client.js';
import { AIDJEngine } from './ai-dj.js';

export class RivendellAIDJBridge {
  constructor(config) {
    this.config = config;
    this.rdxport = new RDXportClient(config.rivendell);
    this.dj = new AIDJEngine(config.ai);
    this.currentCartNumber = null;
    this.currentTrack = null;
    this.nextTrack = null;
    this.pollInterval = (config.pollIntervalSec || 5) * 1000;
    this.lastTransitionAt = 0;
    this.minTransitionGap = (config.minTransitionGapSec || 30) * 1000;
    this.running = false;
    this.stats = {
      transitions: 0,
      introsGenerated: 0,
      importSuccesses: 0,
      importFailures: 0,
      llmFailures: 0,
      ttsFailures: 0,
    };
  }

  async start() {
    this.running = true;
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════════╗');
    console.log('  ║          Rivendell AI DJ Bridge — starting                   ║');
    console.log('  ╠══════════════════════════════════════════════════════════════╣');
    console.log(`  ║  Rivendell:   ${this.config.rivendell.baseUrl.padEnd(45)} ║`);
    console.log(`  ║  LLM:         ${this.config.ai.llmBaseUrl.padEnd(45)} ║`);
    console.log(`  ║  Model:       ${this.config.ai.llmModel.padEnd(45)} ║`);
    console.log(`  ║  TTS:         ${this.config.ai.ttsEngine.padEnd(45)} ║`);
    console.log(`  ║  Persona:     ${this.dj.persona.name.padEnd(45)} ║`);
    console.log(`  ║  Poll:        every ${(this.pollInterval / 1000).toString().padEnd(43)}s     ║`);
    console.log('  ╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    // Initial state
    await this.refreshNowPlaying();
    await this.refreshNextTrack();

    // Poll loop
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (err) {
        console.error('[bridge] poll error:', err.message);
      }
      await sleep(this.pollInterval);
    }
  }

  stop() {
    this.running = false;
    console.log('[bridge] stopping...');
  }

  async pollOnce() {
    const prevCart = this.currentCartNumber;
    await this.refreshNowPlaying();

    // Detect transition
    if (this.currentCartNumber && this.currentCartNumber !== prevCart) {
      const now = Date.now();
      if (now - this.lastTransitionAt < this.minTransitionGap) {
        return; // too soon after last transition
      }
      this.lastTransitionAt = now;
      this.stats.transitions++;
      console.log(`[bridge] transition detected: ${prevCart || 'start'} → ${this.currentCartNumber}`);

      // The track that just ended is what we knew as "next" before
      const justPlayed = this.currentTrack;
      await this.refreshNextTrack();

      if (this.nextTrack) {
        await this.handleTransition(justPlayed, this.nextTrack);
      }
    }
  }

  async refreshNowPlaying() {
    const np = await this.rdxport.getNowPlaying();
    if (np && np.cartNumber && np.cartNumber !== this.currentCartNumber) {
      this.currentCartNumber = np.cartNumber;
      this.currentTrack = { title: np.title, artist: np.artist, cartNumber: np.cartNumber };
      console.log(`[bridge] now playing: ${np.title || 'unknown'} (cart ${np.cartNumber})`);
    }
  }

  async refreshNextTrack() {
    if (!this.config.rivendell.logName) return;
    try {
      const entries = await this.rdxport.listLog(this.config.rivendell.logName);
      // Find the next playable entry after the current one
      const currentIdx = entries.findIndex(e => parseInt(e.cartNumber) === this.currentCartNumber);
      for (let i = currentIdx + 1; i < entries.length; i++) {
        const e = entries[i];
        if (e.cartType === 'audio' && e.cartNumber) {
          this.nextTrack = {
            title: e.cartTitle,
            artist: e.cartArtist,
            cartNumber: parseInt(e.cartNumber),
            duration: null,
          };
          return;
        }
      }
      this.nextTrack = null;
    } catch (err) {
      console.warn('[bridge] could not fetch log:', err.message);
    }
  }

  async handleTransition(justPlayed, nextTrack) {
    console.log(`[bridge] generating DJ link: "${justPlayed?.title || 'start'}" → "${nextTrack.title}"`);

    // 1. Generate DJ text
    let djText;
    try {
      djText = await this.dj.generateLink({
        currentTrack: justPlayed,
        nextTrack,
        mood: 'neutral',
      });
      this.stats.introsGenerated++;
      console.log(`[dj] intro: "${djText}"`);
    } catch (err) {
      console.error('[dj] LLM failed:', err.message);
      this.stats.llmFailures++;
      return;
    }

    // 2. Synthesize TTS
    let audioBuffer;
    try {
      audioBuffer = await this.dj.synthesize(djText);
      console.log(`[tts] synthesized ${audioBuffer.length} bytes`);
    } catch (err) {
      console.error('[tts] synthesis failed:', err.message);
      this.stats.ttsFailures++;
      return;
    }

    // 3. Import into Rivendell
    try {
      const result = await this.rdxport.importAudio({
        group: this.config.rivendell.aiGroup || 'AI_DJ',
        title: `DJ: ${nextTrack.title.slice(0, 40)}`,
        audioBuffer,
        filename: `ai-dj-${Date.now()}.mp3`,
      });
      if (result.success) {
        this.stats.importSuccesses++;
        console.log(`[rivendell] imported as cart #${result.cartNumber}`);
      } else {
        this.stats.importFailures++;
        console.error(`[rivendell] import failed: ${result.error}`);
      }
    } catch (err) {
      this.stats.importFailures++;
      console.error('[rivendell] import error:', err.message);
    }
  }

  getStats() {
    return { ...this.stats, currentCart: this.currentCartNumber, uptime: process.uptime() };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
