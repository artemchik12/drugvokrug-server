'use strict';

/**
 * MSB-first bit packing, ported from com.rubylight.net.serialization.impl.BitArrayOutputStream.
 *
 * The Java implementation has "fast path" byte-level write() overloads that merge
 * bytes into a partially-filled trailing byte. We proved (see README.md, "Bit
 * packing equivalence") that those fast paths are bit-for-bit equivalent to just
 * calling the single-bit writer 8 times, so this port only implements the bit-level
 * primitive and builds everything else (bytes, multi-bit values) on top of it.
 * This trades a little performance for a much smaller surface area to get wrong.
 */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.bitOffset = 0; // 0-7: number of bits already filled in the trailing byte
    this.totalBits = 0;
  }

  writeBit(bit) {
    if (this.bitOffset === 0) {
      this.bytes.push(bit ? 0x80 : 0x00);
    } else if (bit) {
      const idx = this.bytes.length - 1;
      this.bytes[idx] |= 0x80 >> this.bitOffset;
    }
    this.bitOffset = (this.bitOffset + 1) % 8;
    this.totalBits++;
  }

  // value: Number|BigInt, nBits: how many bits to emit, MSB first.
  writeBits(value, nBits) {
    if (nBits === 0) return;
    let v = BigInt(value);
    for (let i = nBits - 1; i >= 0; i--) {
      this.writeBit(Number((v >> BigInt(i)) & 1n));
    }
  }

  writeByte(b) {
    this.writeBits(b & 0xff, 8);
  }

  writeBytes(buf) {
    for (let i = 0; i < buf.length; i++) this.writeByte(buf[i]);
  }

  // Appends another BitWriter's content bit-for-bit (used to splice a nested,
  // already-built sub-buffer into a parent buffer without re-deriving bytes).
  appendWriter(src) {
    for (let i = 0; i < src.totalBits; i++) {
      const byteIdx = i >> 3;
      const bitIdx = i & 7;
      const bit = (src.bytes[byteIdx] >> (7 - bitIdx)) & 1;
      this.writeBit(bit);
    }
  }

  toBuffer() {
    return Buffer.from(this.bytes);
  }
}

/**
 * Mirrors com.rubylight.net.serialization.impl.BitArrayInputStream.
 * Same reasoning as BitWriter: only the bit-level primitive is implemented;
 * Java's byte-level read() fast path is bit-equivalent to 8x readBit().
 */
class BitReader {
  constructor(buf) {
    this.buf = buf;
    this.bytePos = 0;
    this.bitOffset = 0;
    this.cur = 0;
  }

  readBit() {
    if (this.bitOffset === 0) {
      this.cur = this.buf[this.bytePos++];
    }
    this.bitOffset++;
    const bit = (this.cur >> (8 - this.bitOffset)) & 1;
    if (this.bitOffset > 7) this.bitOffset = 0;
    return bit;
  }

  // Returns a BigInt (safe for up to 64-bit protocol values).
  readBits(n) {
    let v = 0n;
    for (let i = 0; i < n; i++) v = (v << 1n) | BigInt(this.readBit());
    return v;
  }

  readByteArray(numBytes) {
    const out = Buffer.alloc(numBytes);
    for (let i = 0; i < numBytes; i++) out[i] = Number(this.readBits(8));
    return out;
  }

  // Mirrors BitArrayInputStream.available(), which just forwards to the
  // underlying ByteArrayInputStream: remaining *whole bytes not yet pulled
  // into the bit cache*, ignoring any bits left over in a partial trailing
  // byte. The top-level packet-decode loop in ASN1PERSerialization relies on
  // this exact (slightly quirky) semantics to know when to stop.
  available() {
    return this.buf.length - this.bytePos;
  }
}

// Number of bits needed to represent a positive BigInt (matches the effect of
// com.rubylight.net.Bits.a(long), which the client computes via
// floor(log(j)/log(2))+1). We use integer bit-shifting instead of floating
// point log() to avoid edge-case rounding bugs; both formulas agree everywhere
// that matters, and since we're the one choosing how many bits to spend on our
// own encodes, exact bit-for-bit parity with the client's chooser isn't
// required for wire compatibility (the client's decoder just trusts our length
// descriptor).
function bitLength(v) {
  let bits = 0;
  let x = v < 0n ? -v : v;
  while (x > 0n) {
    bits++;
    x >>= 1n;
  }
  return Math.max(1, bits);
}

// Mirrors the private helper `a(int i)` in ASN1PERSerialization: number of
// bytes needed to hold a length-in-bits value `n` as an unsigned big-endian
// integer (0 if n==0).
function byteLenFor(n) {
  if (n === 0) return 0;
  return Math.ceil(bitLength(BigInt(n)) / 8);
}

module.exports = { BitWriter, BitReader, bitLength, byteLenFor };
