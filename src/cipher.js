'use strict';

/**
 * Ported from com.rubylight.net.encryption.impl.{BlankCipher,XORCipher,RC4Cipher,
 * DefaultEncryption}. Cipher type id is the client's `encType` (sent/received in
 * the handshake response and in service subtype-3 "rekey" messages), and is the
 * same id used as the wire's Long value in that slot - see session.js.
 */

class BlankCipher {
  static type = 0;
  setKey() {}
  transform(buf) {
    return buf;
  }
}

class XORCipher {
  static type = 1;
  setKey(key) {
    this.key = key;
  }
  transform(buf) {
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ this.key[i % this.key.length];
    return out;
  }
}

class RC4Cipher {
  static type = 2;
  setKey(key) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + key[i % key.length] + s[i]) & 0xff;
      const tmp = s[i];
      s[i] = s[j];
      s[j] = tmp;
    }
    this.sbox = s;
  }
  transform(buf) {
    const s = Uint8Array.from(this.sbox);
    const out = Buffer.alloc(buf.length);
    let i = 0;
    let j = 0;
    for (let k = 0; k < buf.length; k++) {
      i = (i + 1) & 0xff;
      j = (j + s[i]) & 0xff;
      const tmp = s[i];
      s[i] = s[j];
      s[j] = tmp;
      out[k] = buf[k] ^ s[(s[i] + s[j]) & 0xff];
    }
    return out;
  }
}

const CIPHERS = {
  [BlankCipher.type]: BlankCipher,
  [XORCipher.type]: XORCipher,
  [RC4Cipher.type]: RC4Cipher,
};

// Mirrors DefaultEncryption: holds the currently-negotiated cipher and lets it
// be swapped out (rekeyed) mid-session.
class Encryption {
  constructor() {
    this.cipher = new BlankCipher();
  }
  setCipher(type, key) {
    const Ctor = CIPHERS[type];
    if (!Ctor) throw new Error('Unsupported cipher type: ' + type);
    const c = new Ctor();
    c.setKey(key);
    this.cipher = c;
  }
  get type() {
    return this.cipher.constructor.type;
  }
  encrypt(buf) {
    return this.cipher.transform(buf);
  }
  decrypt(buf) {
    return this.cipher.transform(buf);
  }
}

module.exports = { BlankCipher, XORCipher, RC4Cipher, Encryption };
