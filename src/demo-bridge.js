// Demo mode — simulates a Rivendell station for the AI DJ bridge.
//
// When DEMO_MODE=true, this generates fake "now playing" transitions every
// ~60 seconds, picks a fake next track from a built-in library, and runs the
// full AI DJ pipeline (LLM intro + browser TTS). Serves a web dashboard
// at /admin showing live intros, stats, and audio playback.
//
// This lets anyone demo the AI DJ without needing a real Rivendell install
// (which requires MySQL, Apache, ALSA, Qt5 — too heavy for free hosting).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { AIDJEngine } from './ai-dj.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEMO_LIBRARY = [
  { number: 1001, title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354 },
  { number: 1002, title: 'Stairway to Heaven', artist: 'Led Zeppelin', duration: 482 },
  { number: 1003, title: 'Hotel California', artist: 'Eagles', duration: 391 },
  { number: 1004, title: 'Sweet Child O Mine', artist: "Guns N' Roses", duration: 356 },
  { number: 1005, title: 'Smells Like Teen Spirit', artist: 'Nirvana', duration: 301 },
  { number: 1006, title: 'Imagine', artist: 'John Lennon', duration: 183 },
  { number: 1007, title: 'Yesterday', artist: 'The Beatles', duration: 125 },
  { number: 1008, title: 'Hey Jude', artist: 'The Beatles', duration: 431 },
  { number: 1009, title: 'Like a Rolling Stone', artist: 'Bob Dylan', duration: 371 },
  { number: 1010, title: 'What a Wonderful World', artist: 'Louis Armstrong', duration: 137 },
  { number: 1011, title: 'Cosmic Drift', artist: 'Generative Archives', duration: 60 },
  { number: 1012, title: 'Neon Memory', artist: 'Generative Archives', duration: 60 },
  { number: 1013, title: 'Late Night Static', artist: 'Generative Archives', duration: 60 },
  { number: 1014, title: 'Deep Current', artist: 'Generative Archives', duration: 60 },
  { number: 1015, title: 'Morning Static', artist: 'Generative Archives', duration: 60 },
];

export class DemoBridge {
  constructor(config) {
    this.config = config;
    this.dj = new AIDJEngine(config.ai);
    this.currentTrack = null;
    this.nextTrack = null;
    this.intros = []; // last 20 intros
    this.stats = {
      transitions: 0,
      introsGenerated: 0,
      llmPrimaryUsed: 0,
      llmFallbackUsed: 0,
      startTime: Date.now(),
    };
    this.listeners = new Set();
    this.transitionIntervalSec = config.transitionIntervalSec || 60;
  }

  async start() {
    const port = this.config.port || 7701;
    const primaryModel = this.dj.providers[0]?.model || 'unknown';
    const fallbackModel = this.dj.providers[1]?.model || 'unknown';
    const hasGroq = this.dj.providers.length > 2;
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════════╗');
    console.log('  ║       Rivendell AI DJ — DEMO MODE (simulated station)        ║');
    console.log('  ╠══════════════════════════════════════════════════════════════╣');
    console.log(`  ║  Dashboard:    http://localhost:${String(port).padEnd(40)}       ║`);
    console.log(`  ║  LLM primary:  ${primaryModel.padEnd(46)}       ║`);
    console.log(`  ║  LLM fallback: ${fallbackModel.padEnd(46)}       ║`);
    if (hasGroq) {
      console.log(`  ║  LLM groq:     ${this.dj.providers[2].model.padEnd(46)}       ║`);
    }
    console.log(`  ║  Persona:      ${this.dj.persona.name.padEnd(46)}       ║`);
    console.log(`  ║  Library:      ${String(DEMO_LIBRARY.length).padEnd(46)}       ║`);
    console.log(`  ║  Transition:   every ${String(this.transitionIntervalSec).padEnd(37)}s      ║`);
    console.log('  ╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    // Pick initial tracks
    this.currentTrack = this.pickRandom();
    this.nextTrack = this.pickRandom();
    console.log(`[demo] starting — now playing: ${this.currentTrack.title}`);

    // Start HTTP server
    await this.startHttpServer(port);

    // Start transition loop
    this.startTransitionLoop();
  }

  pickRandom(exclude) {
    const pool = DEMO_LIBRARY.filter(t => !exclude || t.number !== exclude.number);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  startTransitionLoop() {
    const loop = async () => {
      while (true) {
        // Wait for "track duration" (capped at transitionIntervalSec for demo speed)
        const waitMs = Math.min(this.currentTrack.duration, this.transitionIntervalSec) * 1000;
        await sleep(waitMs);

        // Transition: current → next, pick new next
        const justPlayed = this.currentTrack;
        this.currentTrack = this.nextTrack;
        this.nextTrack = this.pickRandom(this.currentTrack);
        this.stats.transitions++;

        console.log(`[demo] transition: "${justPlayed.title}" → "${this.currentTrack.title}"`);

        // Generate AI DJ intro
        try {
          const { text, model } = await this.dj.generateLink({
            currentTrack: justPlayed,
            nextTrack: this.currentTrack,
            mood: 'neutral',
          });

          // Track which provider was used (provider name, not model)
          const providerName = model; // 'primary' | 'secondary' | 'groq' | 'static'
          if (providerName === 'primary') this.stats.llmPrimaryUsed++;
          else if (providerName === 'secondary') this.stats.llmFallbackUsed++;
          else if (providerName === 'groq') this.stats.llmGroqUsed = (this.stats.llmGroqUsed || 0) + 1;
          this.stats.introsGenerated++;

          const intro = {
            id: Math.random().toString(36).slice(2, 10),
            text,
            model,
            fromTrack: justPlayed.title,
            toTrack: this.currentTrack.title,
            ts: Date.now(),
          };
          this.intros.unshift(intro);
          this.intros = this.intros.slice(0, 20);

          console.log(`[dj] (${model}) intro: "${text}"`);

          // Broadcast to all WS clients
          this.broadcast({ type: 'transition', current: this.currentTrack, intro, stats: this.getStats() });
        } catch (err) {
          console.error('[dj] intro generation failed:', err.message);
        }
      }
    };
    loop().catch(err => console.error('[demo] loop error:', err));
  }

  async startHttpServer(port) {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === '/' || url.pathname === '/admin') {
        try {
          const html = await readFile(path.join(__dirname, 'demo-dashboard.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch {
          res.writeHead(500);
          res.end('Dashboard not found');
        }
        return;
      }

      if (url.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          current: this.currentTrack,
          next: this.nextTrack,
          intros: this.intros,
          stats: this.getStats(),
          persona: this.dj.persona,
        }));
        return;
      }

      if (url.pathname === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getStats()));
        return;
      }

      if (url.pathname === '/api/library') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tracks: DEMO_LIBRARY }));
        return;
      }

      // Force a transition (for demo/testing)
      if (url.pathname === '/api/force-transition' && req.method === 'POST') {
        // Trigger immediate transition
        this.nextTrack = this.pickRandom(this.currentTrack);
        // The loop will pick this up; or we can short-circuit
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Transition queued' }));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // WebSocket server for live updates
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.listeners.add(ws);
      // Send initial state
      ws.send(JSON.stringify({
        type: 'welcome',
        current: this.currentTrack,
        next: this.nextTrack,
        intros: this.intros,
        stats: this.getStats(),
        persona: this.dj.persona,
      }));
      ws.on('close', () => this.listeners.delete(ws));
    });

    server.listen(port, () => {
      console.log(`[http] dashboard listening on :${port}`);
    });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.listeners) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  getStats() {
    const djStats = this.dj.getStats();
    const providerStats = {};
    for (const c of djStats.calls) {
      providerStats[c.name] = { success: c.success, failure: c.failure };
    }
    return {
      ...this.stats,
      providers: providerStats,
      staticFallbackUsed: djStats.staticFallbackUsed,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      listeners: this.listeners.size,
    };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
