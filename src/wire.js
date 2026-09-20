'use strict';

/**
 * Wire format ported from com.rubylight.net.serialization.impl.ASN1PERSerialization.
 * Despite the class name it isn't real ASN.1 PER - it's a small custom TLV-ish
 * bit-packed format. Full derivation and worked examples are in README.md.
 *
 * Every value starts with a tag byte: (ldSizeBytes << 6) | type
 *   type 0 = null
 *   type 1 = Long        (integer, up to 64 bits)
 *   type 2 = Boolean      (single bit, no length descriptor)
 *   type 3 = String        (UTF-8, length-prefixed)
 *   type 4 = "complex"      (nested arrays, or raw byte[] when inner subtype==6)
 *   type 5 = Seq (ICollection) - heterogeneous list, each element independently
 *            tagged the same way as a top-level item (recursive)
 *
 * A top-level packet, and every Seq, is just a flat concatenation of
 * independently-tagged items - there is no outer "array" wrapper for the
 * top-level command payload itself.
 *
 * Inside a *typed* array (Long[]/Boolean[]/String[]) elements don't repeat the
 * full tag byte - only a compact 2-bit length-descriptor-size prefix (since the
 * type is already known from the array's own subtype nibble). Booleans inside
 * a Boolean[] don't even get that: just one raw bit each.
 */

const { BitWriter, BitReader, bitLength, byteLenFor } = require('./bits');

// ---- Wrapper classes used to disambiguate JS arrays into the Java array
// ---- types the client's serializer distinguishes by reflection ----------

class LongArr {
  constructor(items) {
    this.items = items.map((x) => BigInt(x));
  }
}
class BoolArr {
  constructor(items) {
    this.items = items.slice();
  }
}
class StrArr {
  constructor(items) {
    this.items = items.slice();
  }
}
// Heterogeneous sequence (Java ICollection) - e.g. the nested user-info
// object is a Seq of [LongArr, StrArr, Boolean]. See UserInfoFactory.a().
class Seq {
  constructor(items) {
    this.items = items.slice();
  }
}
class Bytes {
  constructor(buf) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
}
// Array of heterogeneous sequences (Java ICollection[]) - e.g. a friends-list
// or guest-list response is a SeqArr of per-user Seqs. `items` is an array of
// plain JS arrays (each one the item-list for one Seq element), not Seq
// instances - see encodeSeqArr for why the wire shape differs slightly from
// a top-level Seq (no per-element type-5 tag, just a compact length prefix).
class SeqArr {
  constructor(items) {
    this.items = items.slice();
  }
}

function tagByte(type, ldSizeBytes) {
  return ((ldSizeBytes & 0x03) << 6) | (type & 0x0f);
}

// ---------------------------------------------------------------- ENCODE --

function encodeItem(writer, obj) {
  if (obj === null || obj === undefined) {
    writer.writeByte(tagByte(0, 0));
    return;
  }
  if (typeof obj === 'boolean') {
    writer.writeByte(tagByte(2, 0));
    writer.writeBit(obj ? 1 : 0);
    return;
  }
  if (typeof obj === 'number' || typeof obj === 'bigint') {
    encodeLong(writer, BigInt(obj));
    return;
  }
  if (typeof obj === 'string') {
    encodeString(writer, obj);
    return;
  }
  if (obj instanceof Bytes) {
    encodeBytes(writer, obj.buf);
    return;
  }
  if (obj instanceof Seq) {
    encodeSeq(writer, obj.items);
    return;
  }
  if (obj instanceof LongArr || obj instanceof BoolArr || obj instanceof StrArr) {
    encodeTypedArray(writer, obj);
    return;
  }
  if (obj instanceof SeqArr) {
    encodeSeqArr(writer, obj);
    return;
  }
  throw new Error('wire.encodeItem: unsupported value ' + obj);
}

function encodeLong(writer, val) {
  if (val === 0n) {
    writer.writeByte(tagByte(1, 0));
    return;
  }
  const bl = bitLength(val);
  const ld = byteLenFor(bl);
  writer.writeByte(tagByte(1, ld));
  writer.writeBits(bl, ld * 8);
  writer.writeBits(val, bl);
}

function encodeString(writer, str) {
  const bytes = Buffer.from(str, 'utf8');
  const bitLen = bytes.length * 8;
  const ld = byteLenFor(bitLen);
  writer.writeByte(tagByte(3, ld));
  if (ld > 0) writer.writeBits(bitLen, ld * 8);
  writer.writeBytes(bytes);
}

function encodeBytes(writer, buf) {
  // +4 accounts for the inner 4-bit subtype marker (6 == "raw byte array")
  // that lives inside the type-4 "complex" envelope alongside the payload.
  const bitLen = buf.length * 8 + 4;
  const ld = byteLenFor(bitLen);
  writer.writeByte(tagByte(4, ld));
  if (ld > 0) writer.writeBits(bitLen, ld * 8);
  writer.writeBits(6, 4);
  writer.writeBytes(buf);
}

function encodeSeq(writer, items) {
  const inner = new BitWriter();
  for (const it of items) encodeItem(inner, it);
  const bits = inner.totalBits;
  const ld = byteLenFor(bits);
  writer.writeByte(tagByte(5, ld));
  if (ld > 0) writer.writeBits(bits, ld * 8);
  writer.appendWriter(inner);
}

function encodeTypedArray(writer, obj) {
  const inner = new BitWriter();
  if (obj instanceof LongArr) {
    inner.writeBits(1, 4);
    for (const v of obj.items) {
      if (v === 0n) {
        inner.writeBits(0, 2);
      } else {
        const bl = bitLength(v);
        const ld = byteLenFor(bl);
        inner.writeBits(ld, 2);
        inner.writeBits(bl, ld * 8);
        inner.writeBits(v, bl);
      }
    }
  } else if (obj instanceof BoolArr) {
    inner.writeBits(2, 4);
    for (const v of obj.items) inner.writeBit(v ? 1 : 0);
  } else if (obj instanceof StrArr) {
    inner.writeBits(3, 4);
    for (const v of obj.items) {
      const bytes = Buffer.from(v == null ? '' : v, 'utf8');
      const bitLen = bytes.length * 8;
      const ld = byteLenFor(bitLen);
      inner.writeBits(ld, 2);
      if (ld > 0) inner.writeBits(bitLen, ld * 8);
      inner.appendWriter((() => {
        const bw = new BitWriter();
        bw.writeBytes(bytes);
        return bw;
      })());
    }
  }
  const bits = inner.totalBits;
  const ld = byteLenFor(bits);
  writer.writeByte(tagByte(4, ld));
  if (ld > 0) writer.writeBits(bits, ld * 8);
  writer.appendWriter(inner);
}

// ICollection[] (ported from the `objArr instanceof ICollection[]` branch of
// ASN1PERSerialization's array encoder): each element is a Seq whose own
// type-5 tag+length header is *skipped* (z=true on the Java side) - only a
// compact 2-bit-LD-size prefix wraps its raw, already-fully-tagged item
// content. This mirrors decodeComplex's subtype-5 element handling exactly.
function encodeSeqArr(writer, obj) {
  const inner = new BitWriter();
  inner.writeBits(5, 4);
  for (const items of obj.items) {
    const elemInner = new BitWriter();
    for (const it of items) encodeItem(elemInner, it);
    const bits = elemInner.totalBits;
    const ld = byteLenFor(bits);
    inner.writeBits(ld, 2);
    if (ld > 0) inner.writeBits(bits, ld * 8);
    inner.appendWriter(elemInner);
  }
  const bits = inner.totalBits;
  const ld = byteLenFor(bits);
  writer.writeByte(tagByte(4, ld));
  if (ld > 0) writer.writeBits(bits, ld * 8);
  writer.appendWriter(inner);
}

// Top-level entry point: encodes a flat JS array of items (e.g.
// [cid, seq, ...args]) into a wire payload, mirroring
// ISerialization.a(Object[]).
function encodeTop(items) {
  const writer = new BitWriter();
  for (const it of items) encodeItem(writer, it);
  return writer.toBuffer();
}

// ---------------------------------------------------------------- DECODE --

// Decodes one full-tag item. Returns { value, bits } where bits is the total
// number of bits consumed (tag+LD header included) - needed by decodeComplex
// / decodeSeq to know when they've consumed their declared length.
function decodeItem(reader) {
  const tb = Number(reader.readBits(8));
  const type = tb & 0x0f;
  const ldSizeBytes = (tb >> 6) & 0x03;
  const headerBits = (ldSizeBytes + 1) * 8;
  let payloadBits = 0;
  let value;
  switch (type) {
    case 0:
      value = null;
      break;
    case 1: {
      const ld = readLD(reader, ldSizeBytes);
      payloadBits = ld;
      value = ld === 0 ? 0n : reader.readBits(ld);
      break;
    }
    case 2: {
      payloadBits = 1;
      value = reader.readBit() === 1;
      break;
    }
    case 3: {
      const ld = readLD(reader, ldSizeBytes);
      payloadBits = ld;
      value = reader.readByteArray(ld / 8).toString('utf8');
      break;
    }
    case 4: {
      const ld = readLD(reader, ldSizeBytes);
      payloadBits = ld;
      value = decodeComplex(reader, ld);
      break;
    }
    case 5: {
      const ld = readLD(reader, ldSizeBytes);
      payloadBits = ld;
      value = new Seq(decodeSeqItems(reader, ld));
      break;
    }
    default:
      throw new Error('wire.decodeItem: unsupported type ' + type);
  }
  return { value, bits: headerBits + payloadBits };
}

function readLD(reader, ldSizeBytes) {
  if (ldSizeBytes === 0) return 0;
  return Number(reader.readBits(ldSizeBytes * 8));
}

// type-4 "complex" payload: 4-bit subtype, then either a raw byte array
// (subtype 6) or a homogeneous/mixed array of `remaining` bits worth of
// compactly-encoded elements.
function decodeComplex(reader, totalBits) {
  const subtype = Number(reader.readBits(4));
  let remaining = totalBits - 4;
  if (subtype === 6) {
    return new Bytes(reader.readByteArray(remaining / 8));
  }
  const items = [];
  while (remaining > 0) {
    if (subtype === 2) {
      items.push(reader.readBit() === 1);
      remaining -= 1;
      continue;
    }
    const ldSize2 = Number(reader.readBits(2));
    const ld = ldSize2 === 0 ? 0 : Number(reader.readBits(ldSize2 * 8));
    switch (subtype) {
      case 1:
        items.push(ld === 0 ? 0n : reader.readBits(ld));
        break;
      case 3:
        items.push(reader.readByteArray(ld / 8).toString('utf8'));
        break;
      case 4:
        items.push(decodeComplex(reader, ld));
        break;
      case 5:
        items.push(new Seq(decodeSeqItems(reader, ld)));
        break;
      default:
        throw new Error('wire.decodeComplex: unsupported subtype ' + subtype);
    }
    remaining -= ldSize2 * 8 + 2 + ld;
  }
  const kind = { 1: 'long[]', 2: 'bool[]', 3: 'str[]', 4: 'mixed[]', 5: 'seq[]' }[subtype];
  return { kind, items };
}

function decodeSeqItems(reader, totalBits) {
  let remaining = totalBits;
  const items = [];
  while (remaining > 0) {
    const { value, bits } = decodeItem(reader);
    items.push(value);
    remaining -= bits;
  }
  return items;
}

// Top-level entry point: decodes a wire payload into a flat JS array of
// items, mirroring ISerialization.a(byte[]).
function decodeTop(buf) {
  const reader = new BitReader(buf);
  const items = [];
  while (reader.available() > 0) {
    const { value } = decodeItem(reader);
    items.push(value);
  }
  return items;
}

module.exports = {
  LongArr,
  BoolArr,
  StrArr,
  Seq,
  SeqArr,
  Bytes,
  encodeTop,
  decodeTop,
};
