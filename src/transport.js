'use strict';

const { EventEmitter } = require('events');

/**
 * Ported from com.rubylight.net.transport.impl.DefaultTransport.
 * Wire framing is simply: [2-byte big-endian length][payload], max 65535
 * bytes of payload. No magic number, no checksum - just a length prefix on
 * top of a raw TCP stream (see SocketConnection.java: it hands raw bytes
 * straight to/from the socket with no framing of its own).
 *
 * This class wraps a net.Socket and emits 'packet' events with fully
 * reassembled (but still encrypted) payloads, and exposes send(buf) to
 * write a framed packet out.
 */
class FramedTransport extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this._pending = Buffer.alloc(0);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));
  }

  _onData(chunk) {
    this._pending = this._pending.length ? Buffer.concat([this._pending, chunk]) : chunk;
    for (;;) {
      if (this._pending.length < 2) return;
      const len = this._pending.readUInt16BE(0);
      if (this._pending.length < 2 + len) return;
      const payload = this._pending.subarray(2, 2 + len);
      this._pending = this._pending.subarray(2 + len);
      try {
        this.emit('packet', payload);
      } catch (err) {
        this.emit('error', err);
      }
    }
  }

  send(payload) {
    if (payload.length >= 65535) {
      throw new Error('Max packet size limit reached: 65535/' + payload.length);
    }
    const header = Buffer.alloc(2);
    header.writeUInt16BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    try {
      this.socket.destroy();
    } catch (err) {
      /* ignore */
    }
  }
}

module.exports = { FramedTransport };
