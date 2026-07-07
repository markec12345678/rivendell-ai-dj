// Unit tests for RDXport XML parsers
// The parsers are private functions in rdxport-client.js — we extract them here
// for direct testing. This is acceptable because they're pure functions with
// no side effects or dependencies.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error(`  ✗ ${msg}`); }
}

// ─── Extract parsers from rdxport-client.js source ──────────────────────────
// We read the source, find the parser functions, and eval them in a sandbox.
// This avoids the ESM/CJS import issue while still testing the actual code.
const clientSrc = readFileSync(path.join(__dirname, '..', 'src', 'rdxport-client.js'), 'utf8');

// Extract just the parser functions (between the "// ─── XML parsers" comment and EOF)
const parserStart = clientSrc.indexOf('// ─── XML parsers');
const parserSrc = clientSrc.slice(parserStart);

// Eval in a sandbox with no imports
const sandbox = {};
const fn = new Function('sandbox', parserSrc + '\nObject.assign(sandbox, { parseCartXml, parseLogXml, parseImportResult, parseNowPlayingXml });');
fn(sandbox);
const { parseCartXml, parseLogXml, parseImportResult, parseNowPlayingXml } = sandbox;

console.log('━'.repeat(60));
console.log(' rivendell-ai-dj — XML parser tests');
console.log('━'.repeat(60));

// Test 1: parseCartXml
console.log('\n[1] parseCartXml');
{
  const cartXml = `<?xml version="1.0" ?>
<cartList>
  <cart>
    <number>1001</number>
    <title>Bohemian Rhapsody</title>
    <artist>Queen</artist>
    <album>A Night at the Opera</album>
    <year>1975</year>
    <genre>Rock</genre>
    <cuts>1</cuts>
    <cut>
      <cutName>1001 001</cutName>
      <description>Main cut</description>
      <length>354000</length>
      <evergreen>0</evergreen>
      <weight>1</weight>
    </cut>
  </cart>
</cartList>`;

  const cart = parseCartXml(cartXml);
  assert(cart.number === '1001', 'cart number parsed');
  assert(cart.title === 'Bohemian Rhapsody', 'cart title parsed');
  assert(cart.artist === 'Queen', 'cart artist parsed');
  assert(cart.year === '1975', 'cart year parsed');
  assert(cart.cuts && cart.cuts.length === 1, 'cut count parsed');
  assert(cart.cuts[0].cutName === '1001 001', 'cut name parsed');
}

// Test 2: parseLogXml
console.log('\n[2] parseLogXml');
{
  const logXml = `<?xml version="1.0" ?>
<logList>
  <logEntry>
    <line>1</line>
    <cartType>audio</cartType>
    <cartNumber>1001</cartNumber>
    <cartTitle>Bohemian Rhapsody</cartTitle>
    <cartArtist>Queen</cartArtist>
    <startTime>2026-07-07T15:00:00</startTime>
    <eventType>AUDIO</eventType>
  </logEntry>
  <logEntry>
    <line>2</line>
    <cartType>macro</cartType>
    <cartNumber></cartNumber>
    <eventType>MACRO</eventType>
    <comment>Stop and restart</comment>
  </logEntry>
  <logEntry>
    <line>3</line>
    <cartType>audio</cartType>
    <cartNumber>1002</cartNumber>
    <cartTitle>Stairway to Heaven</cartTitle>
    <cartArtist>Led Zeppelin</cartArtist>
  </logEntry>
</logList>`;

  const entries = parseLogXml(logXml);
  assert(entries.length === 3, 'log entries count = 3');
  assert(entries[0].cartNumber === '1001', 'first entry cart number');
  assert(entries[0].cartTitle === 'Bohemian Rhapsody', 'first entry title');
  assert(entries[1].cartType === 'macro', 'second entry is macro');
  assert(entries[2].cartTitle === 'Stairway to Heaven', 'third entry title');
}

// Test 3: parseImportResult
console.log('\n[3] parseImportResult');
{
  const successXml = `<rdImport><cartNumber>2001</cartNumber></rdImport>`;
  const success = parseImportResult(successXml);
  assert(success.success === true, 'import success = true');
  assert(success.cartNumber === 2001, 'cart number = 2001');

  const errorXml = `<rdImport><error>Invalid group name</error></rdImport>`;
  const errorResult = parseImportResult(errorXml);
  assert(errorResult.success === false, 'import success = false on error');
  assert(errorResult.error === 'Invalid group name', 'error message parsed');
}

// Test 4: parseNowPlayingXml
console.log('\n[4] parseNowPlayingXml');
{
  const npXml = `<nowPlaying><cartNumber>1001</cartNumber><title>Bohemian Rhapsody</title><artist>Queen</artist></nowPlaying>`;
  const np = parseNowPlayingXml(npXml);
  assert(np.cartNumber === 1001, 'now playing cart number');
  assert(np.title === 'Bohemian Rhapsody', 'now playing title');
  assert(np.artist === 'Queen', 'now playing artist');

  // Empty/malformed XML
  const empty = parseNowPlayingXml('<nowPlaying></nowPlaying>');
  assert(empty.cartNumber === null, 'empty now playing returns null cart');
}

// Test 5: Edge cases
console.log('\n[5] Edge cases');
{
  // Missing fields
  const minimalCart = parseCartXml('<cartList><cart><number>1</number></cart></cartList>');
  assert(minimalCart.number === '1', 'minimal cart number parsed');
  assert(minimalCart.title === undefined, 'missing title is undefined');

  // Empty log
  const emptyLog = parseLogXml('<logList></logList>');
  assert(Array.isArray(emptyLog) && emptyLog.length === 0, 'empty log returns empty array');
}

console.log('\n' + '━'.repeat(60));
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('━'.repeat(60));
if (failed > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ All XML parsers work correctly.');
process.exit(0);
