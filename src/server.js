'use strict';

const net = require('net');
const dns = require('dns').promises;
const { Session } = require('./session');
const { buildRegistry } = require('./commands');
const { Store } = require('./store');
const config = require('./config');

class DVServer {
  constructor(cfg) {
    this.config = cfg;
    this.commands = buildRegistry();
    this.store = new Store(cfg.dbPath);
    this._sessionCounter = 1;
    this._sessionKeys = new Map(); // sessionId -> Buffer (per-session cipher key)
    this._resourceAddrBytes = Buffer.alloc(0);
    this.onlineUsers = new Map(); // userId -> Session
  }

  setOnline(userId, session) {
    this.onlineUsers.set(userId, session);
  }

  setOffline(userId) {
    this.onlineUsers.delete(userId);
  }

  isOnline(userId) {
    return this.onlineUsers.has(userId);
  }

  log(...parts) {
    const ts = new Date().toISOString();
    console.log(`[${ts}]`, ...parts);
  }

  nextSessionId() {
    return this._sessionCounter++;
  }

  getResourceAddrBytes() {
    return this._resourceAddrBytes;
  }

  getSessionEncryptionKey(sessionId) {
    let key = this._sessionKeys.get(sessionId);
    if (!key) {
      key = this.config.cipherType === 0 ? Buffer.alloc(0) : this.config.randomKey(16);
      this._sessionKeys.set(sessionId, key);
    }
    return key;
  }

  async _resolveResourceAddr() {
    if (!this.config.publicHost) {
      this.log('resource-server', 'none advertised (DV_PUBLIC_HOST unset)');
      return;
    }
    try {
      let ip = this.config.publicHost;
      if (!net.isIPv4(ip)) {
        const res = await dns.lookup(this.config.publicHost, { family: 4 });
        ip = res.address;
      }
      const parts = ip.split('.').map(Number);
      const buf = Buffer.alloc(6);
      buf[0] = parts[0];
      buf[1] = parts[1];
      buf[2] = parts[2];
      buf[3] = parts[3];
      buf.writeUInt16BE(this.config.publicPort, 4);
      this._resourceAddrBytes = buf;
      this.log('resource-server', `advertising ${ip}:${this.config.publicPort}`);
    } catch (err) {
      this.log('resource-server-resolve-failed', err.message);
    }
  }

  async start() {
    await this._resolveResourceAddr();
    this.server = net.createServer((socket) => {
      socket.setNoDelay(true);
      const session = new Session(socket, this);
      session.on('close', () => this._sessionKeys.delete(session.id));
    });
    this.server.on('error', (err) => this.log('listen-error', err.message));
    await new Promise((resolve) => this.server.listen(this.config.port, this.config.host, resolve));
    this.log('listening', `${this.config.host}:${this.config.port}`, `cipher=${this.config.cipherType}`);
  }

  stop() {
    if (this.server) this.server.close();
    if (this.store) this.store.close();
  }
}

if (require.main === module) {
  const server = new DVServer(config);
  server.start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { DVServer };
