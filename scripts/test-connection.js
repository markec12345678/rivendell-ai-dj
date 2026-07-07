#!/usr/bin/env node
// Test connection to Rivendell RDXport API
import { RDXportClient } from '../src/rdxport-client.js';

const config = {
  baseUrl: process.env.RIVENDELL_URL || 'http://localhost',
  username: process.env.RIVENDELL_USER || 'user',
  password: process.env.RIVENDELL_PASS || '',
};

console.log('Testing RDXport connection...');
console.log(`  URL: ${config.baseUrl}`);
console.log(`  User: ${config.username}`);
console.log('');

if (!config.password) {
  console.error('✗ RIVENDELL_PASS not set');
  console.error('  Usage: RIVENDELL_URL=http://rivendell-host RIVENDELL_USER=user RIVENDELL_PASS=pass node scripts/test-connection.js');
  process.exit(1);
}

const client = new RDXportClient(config);

try {
  // Try now-playing endpoint
  const np = await client.getNowPlaying();
  if (np) {
    console.log('✓ Now-playing endpoint reachable');
    console.log(`  Current cart: ${np.cartNumber || '(none)'}`);
    console.log(`  Title: ${np.title || '(unknown)'}`);
    console.log(`  Artist: ${np.artist || '(unknown)'}`);
  } else {
    console.log('⚠ Now-playing endpoint not available (PyPAD may not be configured)');
  }

  // Try listing a cart (cart 1 usually exists in fresh install)
  console.log('');
  console.log('Testing cart list (cart 1)...');
  try {
    const cart = await client.getCart(1);
    console.log('✓ Cart list endpoint reachable');
    console.log(`  Cart 1: ${cart.title || '(empty)'} by ${cart.artist || '(unknown)'}`);
    console.log(`  Cuts: ${cart.cuts?.length || 0}`);
  } catch (err) {
    console.log(`⚠ Cart list failed: ${err.message}`);
  }

  console.log('');
  console.log('✓ RDXport connection test complete');
  process.exit(0);
} catch (err) {
  console.error('✗ Connection failed:', err.message);
  console.error('');
  console.error('Common issues:');
  console.error('  - Rivendell not running (start with: sudo systemctl start rivendell)');
  console.error('  - Apache not serving /rd-bin/ (check /etc/apache2/mods-enabled/rivendell.conf)');
  console.error('  - Wrong credentials (use Rivendell user, not Linux user)');
  console.error('  - Firewall blocking port 80');
  process.exit(1);
}
