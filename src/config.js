'use strict';

const path = require('path');
const crypto = require('crypto');

// encType: 0=Blank(none), 1=XOR, 2=RC4 - see src/cipher.js.
// Start with Blank while validating framing/handshake/login against a real
// client; flip to RC4 once that's confirmed working (no other code changes
// needed - the key is generated fresh per session either way).
const cipherType = Number(process.env.DV_CIPHER ?? 0);

const port = Number(process.env.DV_PORT ?? 9080);
const host = process.env.DV_HOST ?? '0.0.0.0';

// Public host:port the *client device* should reach this server at, used to
// populate the resource-server list handed back in the handshake response.
// Leave DV_PUBLIC_HOST unset to advertise zero resource servers (safe - the
// client just skips opening that secondary connection).
const publicHost = process.env.DV_PUBLIC_HOST || null;
const publicPort = Number(process.env.DV_PUBLIC_PORT ?? port);

// SQLite file (accounts, friends, messages). ':memory:' is handy for tests.
const dbPath = process.env.DV_DB_PATH || path.join(__dirname, '..', 'data', 'drugvokrug.sqlite3');

// Off by default: real accounts go through RegistrationCommand (CID 1),
// matching the actual app. Flip this on only for quick local testing
// without going through the phone-based registration flow - see
// commands/login.js and store.js's authenticate()/autoRegister().
const allowLoginAutoRegister = /^(1|true)$/i.test(process.env.DV_LOGIN_AUTOREGISTER ?? '');

function randomKey(len = 16) {
  return crypto.randomBytes(len);
}

module.exports = { cipherType, port, host, publicHost, publicPort, dbPath, allowLoginAutoRegister, randomKey };
