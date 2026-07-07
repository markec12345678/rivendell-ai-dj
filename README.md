# Rivendell AI DJ

**The first AI DJ integration for any professional radio automation system.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-22%2F22-brightgreen)](scripts/test.js)
[![Demo Mode](https://img.shields.io/badge/demo%20mode-ready-blue)](#demo-mode)

A bridge that connects [Rivendell Radio Automation](https://www.rivendellaudio.org) (the open-source broadcast-grade RAS used by hundreds of FM/AM stations worldwide) to any LLM-powered AI DJ.

**Two modes:**
- **Demo Mode** (default) — simulates a Rivendell station, runs anywhere, has web dashboard. Perfect for evaluation and free hosting (Render, Railway, HF Spaces).
- **Production Mode** — connects to real Rivendell via RDXport API, imports AI-generated voice tracks into the audio library.

```
┌─────────────────┐     RDXport API     ┌──────────────────┐
│   Rivendell     │ ─── (now playing) → │  AI DJ Bridge    │
│  (broadcast)    │                     │  (Node.js)       │
│  MySQL + ALSA   │ ←── (voice track) ─ │  + LLM + TTS     │
│  Apache + RDX   │                     │                  │
└─────────────────┘                     └──────────────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         GLM-5.2 (1)    Nemotron (2)    Groq (3)
                         paid, best     free fallback    free, fast
```

---

## Demo Mode — try it in 30 seconds

Demo Mode runs a simulated Rivendell station with a 15-track library, generates AI DJ intros every 45 seconds, and serves a live web dashboard. **No real Rivendell needed.**

### Quick start

```bash
git clone https://github.com/markec12345678/rivendell-ai-dj.git
cd rivendell-ai-dj
npm install

# Set at least one LLM provider (Groq recommended — free, no credit card)
export GROQ_API_KEY=gsk_your_key_here      # https://console.groq.com
# OR
export OPENAI_API_KEY=sk-or-v1-...         # https://openrouter.ai

# Run in demo mode
npm run demo
```

Open http://localhost:7701 — you'll see:
- Live "Now Playing" + "Up Next" (simulated)
- Latest AI DJ intro with provider badge (which LLM served it)
- Last 10 intros history
- Real-time stats (transitions, per-provider success/failure)
- Browser-side TTS (Web Speech API — speaks intros automatically)

### LLM provider chain (auto-fallback)

The bridge tries providers in order until one succeeds:

| # | Provider | Cost | Quality | Setup |
|---|---|---|---|---|
| 1 | **GLM-5.2** (OpenRouter) | ~$0.0009/1k tokens | Best | OpenRouter key + $5 credits |
| 2 | **Nemotron Ultra** (OpenRouter free) | Free | Good | OpenRouter key (no credits needed) |
| 3 | **Groq Llama 3.3 70B** | Free (30 req/min) | Very good | Groq key |
| 4 | Static fallback | Free | Generic | Always works |

**Recommended setup for free 24/7 operation:**
- Get a free [Groq key](https://console.groq.com) (no credit card)
- Optionally add [OpenRouter](https://openrouter.ai) key for Nemotron free tier
- The bridge auto-falls-back when rate limits hit

---

## Production Mode — real Rivendell integration

For connecting to a real Rivendell install (LPFM station, community radio, broadcast studio):

### Prerequisites

1. **Rivendell** v4.0+ installed and running
   - Apache serving `/rd-bin/` (default on package install)
   - A Rivendell user with API access (create in RDAdmin → Manage Users)
   - A group named `AI_DJ` (create in RDAdmin → Manage Groups → Add)

2. **Node.js** 20+, **ffmpeg**

3. **LLM API key** (see provider chain above)

### Install

```bash
git clone https://github.com/markec12345678/rivendell-ai-dj.git
cd rivendell-ai-dj
npm install
cp .env.example .env
# Edit .env — set RIVENDELL_*, OPENAI_API_KEY or GROQ_API_KEY, DEMO_MODE=false
```

### Test connection

```bash
npm run test-connection
# Or: RIVENDELL_URL=http://rivendell-host RIVENDELL_USER=user RIVENDELL_PASS=pass node scripts/test-connection.js
```

### Run

```bash
npm start
# Or as systemd service:
sudo cp scripts/rivendell-ai-dj.service /etc/systemd/system/
sudo systemctl enable --now rivendell-ai-dj
```

---

## Deploy to Render (free 24/7 with keep-alive)

**Best free option for demo mode.** Render free tier sleeps after 15 min, but with UptimeRobot it stays awake.

### Option A: Blueprint (1-click)

1. Fork this repo to your GitHub
2. Go to https://render.com → **New +** → **Blueprint**
3. Select your fork — `render.yaml` auto-configures everything
4. Set `OPENAI_API_KEY` and/or `GROQ_API_KEY` manually
5. Deploy

### Option B: Manual

1. https://render.com → Sign up with GitHub
2. **New +** → **Web Service** → select `markec12345678/rivendell-ai-dj`
3. **Runtime:** Docker (auto-detected)
4. **Instance Type:** Free
5. **Environment Variables:**
   - `DEMO_MODE=true`
   - `GROQ_API_KEY=gsk_...` (recommended — free, reliable)
   - `OPENAI_API_KEY=sk-or-v1-...` (optional — for GLM-5.2 when you add credits)
   - `OPENAI_BASE_URL=https://openrouter.ai/api/v1`
   - `OPENAI_MODEL=z-ai/glm-5.2`
   - `OPENAI_MODEL_FALLBACK=nvidia/nemotron-3-ultra-550b-a55b:free`
6. **Create Web Service**
7. **⚠️ Set up keep-alive** (otherwise Render sleeps after 15 min):
   - https://uptimerobot.com (free) → Add Monitor → HTTP(s)
   - URL: `https://your-app.onrender.com/api/state`
   - Interval: 5 minutes

---

## How it works

### Demo Mode flow

1. Picks a random track from 15-track library
2. Waits `TRANSITION_INTERVAL_SEC` (default 45s)
3. Transitions to next track
4. Generates DJ link with LLM (tries primary → secondary → Groq → static)
5. Broadcasts intro + new track via WebSocket to all dashboard clients
6. Browser auto-speaks the intro via Web Speech API (free TTS)
7. Repeats

### Production Mode flow

1. Polls `/rd-bin/rdnowplaying` every 5 seconds
2. When cart number changes, a track transition just happened
3. Looks ahead in active log (via `/rd-bin/rdlistlog`) to find next track
4. Generates DJ link with LLM
5. Synthesizes speech with TTS (Piper/OpenAI/ElevenLabs)
6. Imports MP3 as a new cart into `AI_DJ` group via `/rd-bin/rdimport`

### Configurable persona

```bash
DJ_NAME=ECHO
DJ_STYLE=laid-back late-night DJ
# Or override the full system prompt:
DJ_SYSTEM_PROMPT=You are ECHO, a mysterious late-night radio DJ who speaks in short, poetic fragments...
```

### TTS engines

| Engine | Quality | Cost | Mode |
|---|---|---|---|
| **browser** (default) | Basic | Free | Demo Mode (Web Speech API) |
| **Piper** | Basic, robotic | Free, local | Production Mode |
| **OpenAI TTS** | High | $0.015/min | Production Mode |
| **ElevenLabs** | Highest (voice cloning) | $0.30/1k chars | Production Mode |

---

## Architecture

```
src/
├── cli.js                 # CLI entry — auto-detects demo vs production mode
├── demo-bridge.js         # Demo Mode: simulated Rivendell + web dashboard + WebSocket
├── demo-dashboard.html    # Web UI (live intros, stats, browser TTS)
├── bridge.js              # Production Mode: polls RDXport, generates intros, imports to Rivendell
├── rdxport-client.js      # RDXport API client (cart, log, import, now-playing) + XML parsers
└── ai-dj.js               # Multi-provider LLM chain + multi-engine TTS

scripts/
├── test.js                # Unit tests for XML parsers (22 assertions)
├── test-connection.js     # RDXport connectivity test (production mode)
└── rivendell-ai-dj.service # systemd unit file (production mode)

Dockerfile                 # Docker image (Node 22 + ffmpeg, demo mode by default)
render.yaml                # Render Blueprint for 1-click deploy
.env.example               # All configuration options documented
```

### Dependencies

Only **one** runtime npm dependency: `ws` (WebSocket). Everything else uses Node.js built-ins + global `fetch` (Node 20+).

---

## Configuration reference

See [`.env.example`](.env.example) for all options. Key ones:

| Var | Default | Description |
|---|---|---|
| `DEMO_MODE` | auto | `true` = simulate Rivendell, `false` = connect to real Rivendell |
| `PORT` | `7701` | HTTP port (Render auto-injects) |
| `TRANSITION_INTERVAL_SEC` | `45` | Demo mode: seconds between simulated transitions |
| `OPENAI_API_KEY` | (required) | OpenRouter (or OpenAI) key |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` | LLM API base URL |
| `OPENAI_MODEL` | `z-ai/glm-5.2` | Primary model (best, paid) |
| `OPENAI_MODEL_FALLBACK` | `nvidia/nemotron-3-ultra-550b-a55b:free` | Secondary model (free) |
| `GROQ_API_KEY` | (optional) | Groq key for tertiary fallback (recommended) |
| `RIVENDELL_URL` | `http://localhost` | Production: Rivendell Apache URL |
| `RIVENDELL_USER` | `user` | Production: Rivendell API user |
| `RIVENDELL_PASS` | (required in prod) | Production: Rivendell API password |
| `RIVENDELL_AI_GROUP` | `AI_DJ` | Production: group for imported voice tracks |
| `DJ_NAME` | `ECHO` | DJ persona name |
| `TTS_ENGINE` | `browser` | `browser` / `piper` / `openai` / `elevenlabs` |

---

## Testing

```bash
# Unit tests (XML parsers)
npm test

# Connection test (production mode, requires running Rivendell)
npm run test-connection
```

---

## Roadmap

- [x] RDXport client (cart, log, import, now-playing)
- [x] Multi-provider LLM chain (OpenRouter GLM-5.2 → Nemotron free → Groq → static)
- [x] Multi-engine TTS (browser/Piper/OpenAI/ElevenLabs)
- [x] Demo Mode with web dashboard
- [x] Configurable DJ persona
- [x] systemd service for production
- [x] Dockerfile + Render Blueprint
- [ ] Auto-insert into active log (currently imports only, no log insertion)
- [ ] Mood detection (time-of-day + chat sentiment)
- [ ] Webhook mode (push instead of poll) — for Rivendell setups that support it
- [ ] Multi-language DJ personas
- [ ] Voice cloning (clone real DJ voice with ElevenLabs)

---

## Compatibility

- **Rivendell** v4.0+ (uses RDXport API, stable since v3)
- **Node.js** 20+
- **OS**: Linux (primary), macOS, Windows (with WSL for Piper)
- **Demo Mode**: runs anywhere (Render, Railway, HF Spaces, Fly.io, VPS, PC)
- **Production Mode**: requires real Rivendell install (Linux recommended)

---

## Credits

- [Rivendell Radio Automation](https://www.rivendellaudio.org) by Fred Gleason / Paravel Systems
- [Piper TTS](https://github.com/rhasspy/piper) by Rhasspy
- [OpenRouter](https://openrouter.ai) — LLM API aggregator
- [Groq](https://groq.com) — ultra-fast free LLM inference
- Architecture and security patterns adapted from [SUB/WAVE Lite](https://github.com/markec12345678/subwave-lite)

---

## License

MIT. This project is independent of Paravel Systems and not affiliated with the Rivendell project.
