'use strict';

const { EventEmitter } = require('events');
const { FramedTransport } = require('./transport');
const { encodeTop, decodeTop, Bytes } = require('./wire');
const { Encryption } = require('./cipher');

const STATE_HANDSHAKE = 'handshake';
const STATE_CONNECTED = 'connected';

// CID used as the "service" marker for connection-level messages
// (keepalive, rekey, redirect, ...) - see DefaultClient.a = new Long(0).
const SERVICE_CID = 0n;

/**
 * One client<->server session. Handles the RubyLight handshake (see
 * com.rubylight.net.client.impl.HandshakeState) and, once connected, decrypts
 * + decodes incoming packets (com.rubylight.net.client.impl.ConnectedState)
 * and dispatches application commands to a registry keyed by command id.
 */
class Session extends EventEmitter {
  constructor(socket, server) {
    super();
    this.server = server;
    this.transport = new FramedTransport(socket);
    this.state = STATE_HANDSHAKE;
    this.enc = new Encryption();
    this.remoteVersion = null;
    this.id = server.nextSessionId();
    this.userId = null; // set once a Login/Relogin command succeeds
    this.remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;

    this.transport.on('packet', (buf) => this._onPacket(buf));
    this.transport.on('close', () => this._onClose());
    this.transport.on('error', (err) => this.server.log('transport-error', this.remoteAddr, err.message));
  }

  _onPacket(raw) {
    try {
      if (this.state === STATE_HANDSHAKE) {
        this._handleHandshake(raw);
      } else {
        this._handleConnected(raw);
      }
    } catch (err) {
      this.server.log('session-error', this.remoteAddr, err.stack || err.message);
      this.transport.close();
    }
  }

  // ---- Handshake -----------------------------------------------------
  // Client hello layout (HandshakeState ctor), 15 raw unencrypted bytes:
  //   u16 field1=1, u16 field2=2, u16 field3=5, u16 field4=20,
  //   u8 verMajor, u8 verMinor, u8 verPatch, u32 token
  _handleHandshake(raw) {
    if (raw.length !== 15) {
      this.server.log('bad-handshake-len', this.remoteAddr, raw.length);
      this.transport.close();
      return;
    }
    const header = [raw.readUInt16BE(0), raw.readUInt16BE(2), raw.readUInt16BE(4), raw.readUInt16BE(6)];
    const ver = [raw[8], raw[9], raw[10]];
    const clientToken = raw.readUInt32BE(11);
    this.remoteVersion = ver;
    this.server.log(
      'handshake',
      this.remoteAddr,
      `ver=${ver.join('.')} token=${clientToken} hdr=[${header.join(',')}]`
    );

    // Handshake response layout (decoded by HandshakeState.a(byte[])):
    //   [Long sessionId, byte[] resourceAddrs (6-byte IP+port chunks),
    //    Long encType, byte[] encKey]
    // Sent RAW (unencrypted/Blank), same as the client's hello - see
    // README.md "Handshake" for why (chicken-and-egg: the cipher this
    // response announces can't be used to protect itself).
    const resourceAddrs = this.server.getResourceAddrBytes();
    const encType = this.server.config.cipherType;
    const encKey = this.server.getSessionEncryptionKey(this.id);
    const payload = encodeTop([BigInt(this.id), new Bytes(resourceAddrs), BigInt(encType), new Bytes(encKey)]);
    this.transport.send(payload);

    this.enc.setCipher(encType, encKey);
    this.state = STATE_CONNECTED;
    this.server.log('connected', this.remoteAddr, `session=${this.id} cipher=${encType}`);
    this.emit('connected');
  }

  // ---- Connected state -------------------------------------------------
  _handleConnected(raw) {
    const plain = this.enc.decrypt(raw);
    const items = decodeTop(plain);
    if (items.length < 2) {
      this.server.log('short-packet', this.remoteAddr, items.length);
      return;
    }
    const cid = items[0];
    const seq = items[1];
    const args = items.slice(2);

    if (cid === SERVICE_CID) {
      this._handleService(seq, args);
      return;
    }
    this._handleCommand(cid, seq, args);
  }

  _handleService(seq, args) {
    const subtype = args.length > 0 ? args[0] : null;
    if (subtype === 0n) {
      // Keepalive: client sent [0, seq, 0, timestamp]; any reply with the
      // same (cid=0, seq) fulfils the client's pending delivery record
      // (Connector.a(Long,Object[]) response handler is a no-op) - the
      // payload after that is discarded by the client, so we just echo
      // our own clock for debuggability.
      if (seq !== null) {
        this._sendRaw([SERVICE_CID, seq, 0n, BigInt(Date.now())]);
      }
      return;
    }
    this.server.log('service-unhandled', this.remoteAddr, `subtype=${subtype} args=${args.length}`);
  }

  async _handleCommand(cid, seq, args) {
    const handler = this.server.commands.get(cid.toString());
    if (!handler) {
      this.server.log('unknown-command', this.remoteAddr, `cid=${cid} seq=${seq} argc=${args.length}`);
      return;
    }
    try {
      const responseArgs = await handler(args, this);
      if (seq !== null && responseArgs !== undefined) {
        this._sendRaw([cid, seq, ...responseArgs]);
      }
    } catch (err) {
      this.server.log('command-error', this.remoteAddr, `cid=${cid}`, err.stack || err.message);
    }
  }

  // items: full top-level array including cid+seq, already includes any
  // wrapper types (LongArr/Seq/etc) needed by wire.encodeTop.
  _sendRaw(items) {
    const plain = encodeTop(items);
    this.transport.send(this.enc.encrypt(plain));
  }

  sendCommandResponse(cid, seq, argsArray) {
    this._sendRaw([BigInt(cid), seq, ...argsArray]);
  }

  _onClose() {
    // Only clear the online marker if it's still pointing at us - a newer
    // session for the same user (reconnect) may have already taken over.
    if (this.userId !== null && this.server.onlineUsers.get(this.userId) === this) {
      this.server.setOffline(this.userId);
      // Best-effort bookkeeping: the socket's 'close' event can fire after
      // the process has already torn down the store (e.g. server.stop()
      // during a fast test-harness shutdown), so don't let this non-
      // critical update crash the close path.
      try {
        this.server.store.touchLastSeen(this.userId);
      } catch (err) {
        this.server.log('touch-last-seen-failed', this.remoteAddr, err.message);
      }
    }
    this.server.log('closed', this.remoteAddr, `session=${this.id}`);
    this.emit('close');
  }
}

module.exports = { Session };
