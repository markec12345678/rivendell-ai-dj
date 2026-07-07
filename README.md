# Rivendell AI DJ

**The first AI DJ integration for any professional radio automation system.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-22%2F22-brightgreen)](scripts/test.js)

A bridge that connects [Rivendell Radio Automation](https://www.rivendellaudio.org) (the open-source broadcast-grade RAS used by hundreds of FM/AM stations worldwide) to any LLM-powered AI DJ. The bridge:

1. **Polls** Rivendell's RDXport API for "now playing" changes
2. **Detects** track transitions (cart number changes)
3. **Generates** a 1-2 sentence DJ link between the just-ended and next track using an LLM
4. **Synthesizes** speech with TTS (Piper, OpenAI, or ElevenLabs)
5. **Imports** the audio as a new cart into Rivendell's library
6. **(Optional)** Inserts the cart into the active log for automatic playout

```
┌─────────────────┐     RDXport API     ┌──────────────────┐
│   Rivendell     │ ─── (now playing) → │  AI DJ Bridge    │
│  (broadcast)    │                     │  (Node.js)       │
│  MySQL + ALSA   │ ←── (voice track) ─ │  + LLM + TTS     │
│  Apache + RDX   │                     │                  │
└─────────────────┘                     └──────────────────┘
                                              │
                                              ▼
                                        ┌─────────────┐
                                        │ OpenRouter  │
                                        │ (LLM API)   │
                                        └─────────────┘
                                              │
                                              ▼
                                        ┌─────────────┐
                                        │  Piper TTS  │
                                        │ (or cloud)  │
                                        └─────────────┘
```

---

## Why this matters

**No professional radio automation system has AI DJ integration today.** Rivendell is the only GPLv2 broadcast-grade RAS, and it's been AI-free since 2002. This bridge fills that gap.

Compared to consumer "AI radio" projects (SUB/WAVE, Spotify AI DJ):
- **Rivendell** = professional broadcast (used by real FM/AM stations, supports GPIO, satellite feeds, voice tracking, multi-station replication)
- **This bridge** = adds AI DJ capability without modifying Rivendell itself

The bridge is **read-only on Rivendell state** until a transition is detected, then does one write (import) per transition. Safe for production use.

---

## Quick start

### Prerequisites

1. **Rivendell** installed and running (v4.0+)
   - Apache serving `/rd-bin/` (default on package install)
   - A Rivendell user with API access (create in RDAdmin → Manage Users)
   - A group named `AI_DJ` (create in RDAdmin → Manage Groups → Add)

2. **Node.js** 20+

3. **ffmpeg** (for audio conversion)

4. **Piper TTS** (for local speech synthesis)
   ```bash
   # Linux
   curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz | tar -xz -C /opt/piper
   # Download a voice
   mkdir -p /opt/piper/voices
   curl -L -o /opt/piper/voices/en_GB-alan-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
   curl -L -o /opt/piper/voices/en_GB-alan-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json
   ```

5. **LLM API key** — free options:
   - [OpenRouter](https://openrouter.ai) — 24 free models, no credit card
   - [Groq](https://console.groq.com) — ultra-fast, 30 req/min, no credit card

### Install

```bash
git clone https://github.com/markec12345678/rivendell-ai-dj.git
cd rivendell-ai-dj
cp .env.example .env
# Edit .env with your Rivendell + LLM credentials
```

### Test connection

```bash
node scripts/test-connection.js
```

### Run

```bash
npm start
```

### Install as systemd service (production)

```bash
sudo cp scripts/rivendell-ai-dj.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rivendell-ai-dj
sudo journalctl -u rivendell-ai-dj -f
```

---

## How it works

### Polling strategy

The bridge polls `/rd-bin/rdnowplaying` every 5 seconds. When the cart number changes, a track transition just happened. The bridge then:

1. Looks ahead in the active log (via `/rd-bin/rdlistlog`) to find the next playable track
2. Generates a DJ link with the LLM, given context:
   - Just-ended track (title, artist)
   - Next track (title, artist)
   - Current mood (optional)
   - Listener request (if any)
3. Synthesizes the link text with TTS
4. Imports the MP3 as a new cart into the `AI_DJ` group via `/rd-bin/rdimport`

### Configurable persona

The DJ persona is fully customizable via environment variables:

```bash
DJ_NAME=ECHO
DJ_STYLE=laid-back late-night DJ
# Or override the full system prompt:
DJ_SYSTEM_PROMPT=You are ECHO, a mysterious late-night radio DJ who speaks in short, poetic fragments...
```

### TTS engines

| Engine | Quality | Cost | Setup |
|---|---|---|---|
| **Piper** (default) | Basic, robotic | Free, local | One-time download (~100 MB) |
| **OpenAI TTS** | High | $0.015/min | API key |
| **ElevenLabs** | Highest (voice cloning) | $0.30/1k chars | API key + voice ID |

Switch via `TTS_ENGINE=piper|openai|elevenlabs`.

---

## Architecture

```
src/
├── cli.js                 # CLI entry point — loads config, starts bridge
├── bridge.js              # Main orchestration loop (poll → detect → generate → import)
├── rdxport-client.js      # RDXport API client (cart, log, import, now-playing)
└── ai-dj.js               # LLM + TTS engine (OpenAI-compatible + Piper/cloud)

scripts/
├── test.js                # Unit tests for XML parsers (22 assertions)
├── test-connection.js     # RDXport connectivity test
└── rivendell-ai-dj.service # systemd unit file
```

### Dependencies

**Zero runtime npm dependencies.** Uses only Node.js built-ins (`node:child_process`, `node:fs`, `node:buffer`) + global `fetch` (Node 20+).

---

## Configuration reference

See [`.env.example`](.env.example) for all options. Key ones:

| Var | Default | Description |
|---|---|---|
| `RIVENDELL_URL` | `http://localhost` | Rivendell Apache URL |
| `RIVENDELL_USER` | `user` | Rivendell API user |
| `RIVENDELL_PASS` | (required) | Rivendell API password |
| `RIVENDELL_LOG` | (empty) | Active log name to monitor |
| `RIVENDELL_AI_GROUP` | `AI_DJ` | Group for imported voice tracks |
| `OPENAI_API_KEY` | (required) | LLM API key |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` | LLM API base URL |
| `OPENAI_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b:free` | LLM model |
| `TTS_ENGINE` | `piper` | `piper` / `openai` / `elevenlabs` |
| `TTS_VOICE` | `en_GB-alan-medium` | Piper voice name |
| `POLL_INTERVAL_SEC` | `5` | Now-playing poll interval |
| `MIN_TRANSITION_GAP_SEC` | `30` | Min gap between AI DJ inserts |

---

## Testing

```bash
# Unit tests (XML parsers)
npm test

# Connection test (requires running Rivendell)
RIVENDELL_URL=http://your-rivendell RIVENDELL_USER=user RIVENDELL_PASS=pass \
  node scripts/test-connection.js
```

---

## Roadmap

- [x] RDXport client (cart, log, import, now-playing)
- [x] Multi-provider LLM (OpenRouter, Groq, OpenAI, Cerebras)
- [x] Multi-engine TTS (Piper, OpenAI, ElevenLabs)
- [x] Configurable DJ persona
- [x] systemd service
- [ ] Auto-insert into active log (currently imports only)
- [ ] Mood detection from chat (port from SUB/WAVE Lite)
- [ ] Webhook mode (push instead of poll) — for Rivendell setups that support it
- [ ] Multi-language DJ personas
- [ ] Voice cloning (clone real DJ voice with ElevenLabs)

---

## Compatibility

- **Rivendell** v4.0+ (uses RDXport API, stable since v3)
- **Node.js** 20+
- **OS**: Linux (primary), macOS, Windows (with WSL for Piper)
- **Apache** with Rivendell web API module

---

## Credits

- [Rivendell Radio Automation](https://www.rivendellaudio.org) by Fred Gleason / Paravel Systems — the broadcast-grade RAS this integrates with
- [Piper TTS](https://github.com/rhasspy/piper) by Rhasspy — fast local neural TTS
- [OpenRouter](https://openrouter.ai) — free LLM API aggregator
- Architecture and security patterns adapted from [SUB/WAVE Lite](https://github.com/markec12345678/subwave-lite)

---

## License

MIT. This project is independent of Paravel Systems and not affiliated with the Rivendell project.
