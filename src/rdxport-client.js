// RDXport client — communicates with Rivendell's web API
//
// Rivendell's RDXport API is a RESTful HTTP interface served by Apache
// (typically at http://rivendell-host/rd-bin/). It returns XML.
//
// Key endpoints used by the AI DJ bridge:
//   - GET  /rd-bin/rdexport?cart-number=N   → download audio for a cart
//   - POST /rd-bin/rdimport                  → upload audio as a new cart/cut
//   - GET  /rd-bin/rdlistcart?cart-number=N  → cart metadata (title, artist)
//   - GET  /rd-bin/rdlistlog?log-name=N      → upcoming log entries
//   - GET  /rd-bin/rdnowplaying              → current playing cart (if available)
//
// All requests require HTTP Basic auth (Rivendell user + password).

import { Buffer } from 'node:buffer';

export class RDXportClient {
  constructor({ baseUrl, username, password }) {
    if (!baseUrl) throw new Error('RDXportClient: baseUrl required');
    if (!username || !password) throw new Error('RDXportClient: username + password required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  async call(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Authorization': this.auth,
        'User-Agent': 'rivendell-ai-dj/0.1',
        ...(options.body ? { 'Content-Type': options.contentType || 'application/octet-stream' } : {}),
        ...options.headers,
      },
      body: options.body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RDXport ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('xml')) {
      const text = await res.text();
      return { type: 'xml', text };
    }
    if (contentType.includes('audio') || contentType.includes('octet-stream')) {
      const buf = await res.arrayBuffer();
      return { type: 'binary', buffer: Buffer.from(buf) };
    }
    const text = await res.text();
    return { type: 'text', text };
  }

  // ─── Cart operations ──────────────────────────────────────────────────────

  // Get cart metadata (title, artist, album, cuts, etc.)
  // Returns parsed cart info
  async getCart(cartNumber) {
    const r = await this.call(`/rd-bin/rdlistcart?cart-number=${cartNumber}`);
    return parseCartXml(r.text);
  }

  // Download audio for a specific cut (returns Buffer)
  async exportCut(cartNumber, cutNumber = 1) {
    const r = await this.call(`/rd-bin/rdexport?cart-number=${cartNumber}&cut-number=${cutNumber}&format=mp3`);
    return r.buffer;
  }

  // ─── Log operations ──────────────────────────────────────────────────────

  // List log entries for a service+date
  async listLog(logName) {
    const r = await this.call(`/rd-bin/rdlistlog?log-name=${encodeURIComponent(logName)}`);
    return parseLogXml(r.text);
  }

  // ─── Audio import (create new cart with AI-generated voice track) ─────────

  // Import audio as a new cart. Returns the cart number assigned.
  // group: Rivendell group name (must exist)
  // title: cart title
  // audioBuffer: MP3/WAV bytes
  // filename: source filename (for metadata)
  async importAudio({ group, title, audioBuffer, filename = 'ai-dj-track.mp3' }) {
    // Use multipart-like format expected by RDXport rdimport
    const boundary = '----ai-dj-boundary-' + Math.random().toString(36).slice(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="COMMAND"\r\n\r\n`),
      Buffer.from('1\r\n'),  // COMMAND=1 = import
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="GROUP_NAME"\r\n\r\n`),
      Buffer.from(`${group}\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="TITLE"\r\n\r\n`),
      Buffer.from(`${title}\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="FILENAME"; filename="${filename}"\r\n`),
      Buffer.from(`Content-Type: audio/mpeg\r\n\r\n`),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await this.call('/rd-bin/rdimport', {
      method: 'POST',
      body,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
    return parseImportResult(r.text);
  }

  // ─── Now playing (if Rivendell exposes it) ────────────────────────────────

  // Some Rivendell setups expose a "now playing" endpoint via PyPAD or custom
  // script. This is a best-effort poll.
  async getNowPlaying() {
    try {
      const r = await this.call('/rd-bin/rdnowplaying');
      return parseNowPlayingXml(r.text);
    } catch (e) {
      // Endpoint may not exist — return null
      return null;
    }
  }
}

// ─── XML parsers (lightweight, no XML lib dependency) ───────────────────────

function parseCartXml(xml) {
  // RDXport returns <cartList><cart><number>N</number><title>...</title>...</cart></cartList>
  const cart = {};
  const fields = ['number', 'title', 'artist', 'album', 'year', 'genre', 'usageCode', 'cuts'];
  for (const f of fields) {
    const m = xml.match(new RegExp(`<${f}>([^<]*)</${f}>`));
    if (m) cart[f] = m[1];
  }
  // Parse cuts
  const cuts = [];
  const cutRe = /<cut>([\s\S]*?)<\/cut>/g;
  let m;
  while ((m = cutRe.exec(xml)) !== null) {
    const cut = {};
    const cutFields = ['cutName', 'description', 'length', 'evergreen', 'weight'];
    for (const f of cutFields) {
      const cm = m[1].match(new RegExp(`<${f}>([^<]*)</${f}>`));
      if (cm) cut[f] = cm[1];
    }
    cuts.push(cut);
  }
  cart.cuts = cuts;
  return cart;
}

function parseLogXml(xml) {
  // RDXport returns <logList><logEntry><line>N</line><cartType>...</cartType><cartNumber>...</cartNumber>...</logEntry></logList>
  const entries = [];
  const entryRe = /<logEntry>([\s\S]*?)<\/logEntry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = {};
    const fields = ['line', 'cartType', 'cartNumber', 'cartTitle', 'cartArtist', 'startTime', 'eventType', 'comment'];
    for (const f of fields) {
      const fm = m[1].match(new RegExp(`<${f}>([^<]*)</${f}>`));
      if (fm) entry[f] = fm[1];
    }
    entries.push(entry);
  }
  return entries;
}

function parseImportResult(xml) {
  // Returns <rdImport><cartNumber>N</cartNumber></rdImport> on success
  const m = xml.match(/<cartNumber>(\d+)<\/cartNumber>/);
  if (m) return { success: true, cartNumber: parseInt(m[1], 10) };
  const e = xml.match(/<error>([^<]*)<\/error>/);
  return { success: false, error: e ? e[1] : 'Unknown import error' };
}

function parseNowPlayingXml(xml) {
  // Custom format, varies by setup. Best-effort parse.
  const m = xml.match(/<cartNumber>(\d+)<\/cartNumber>/);
  const title = xml.match(/<title>([^<]*)<\/title>/);
  const artist = xml.match(/<artist>([^<]*)<\/artist>/);
  return {
    cartNumber: m ? parseInt(m[1], 10) : null,
    title: title ? title[1] : null,
    artist: artist ? artist[1] : null,
  };
}
