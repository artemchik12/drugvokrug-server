'use strict';

/**
 * A minimal stand-in for com.rubylight.net.client.impl.DefaultClient, built
 * from the same traced wire format, used to exercise the server end-to-end
 * without needing a real device/emulator. This is a *test double*, not a
 * general-purpose client library - it hardcodes the one connection flow we
 * need to verify (handshake -> login -> keepalive -> relogin -> logout).
 */
const net = require('net');
const assert = require('assert');
const { encodeTop, decodeTop, LongArr, StrArr, Seq, SeqArr, Bytes } = require('../src/wire');
const { Encryption } = require('../src/cipher');
const { DVServer } = require('../src/server');
const config = require('../src/config');
const { REGION_DATA_VERSION } = require('../src/commands/region');

function buildHandshakeHello(version, token) {
  const buf = Buffer.alloc(15);
  buf.writeUInt16BE(1, 0);
  buf.writeUInt16BE(2, 2);
  buf.writeUInt16BE(5, 4);
  buf.writeUInt16BE(20, 6);
  buf[8] = version[0];
  buf[9] = version[1];
  buf[10] = version[2];
  buf.writeUInt32BE(token, 11);
  return buf;
}

class FakeClient {
  constructor(socket) {
    this.socket = socket;
    this.pending = Buffer.alloc(0);
    this.enc = new Encryption();
    this.seq = 0;
    this.waiters = new Map(); // seq(string) -> resolve fn
    this.handshakeWaiter = null;
    socket.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      if (this.pending.length < 2) return;
      const len = this.pending.readUInt16BE(0);
      if (this.pending.length < 2 + len) return;
      const payload = this.pending.subarray(2, 2 + len);
      this.pending = this.pending.subarray(2 + len);
      this._onPacket(payload);
    }
  }

  _onPacket(raw) {
    if (this.handshakeWaiter) {
      const w = this.handshakeWaiter;
      this.handshakeWaiter = null;
      w(raw); // handshake response travels unencrypted, per protocol
      return;
    }
    const plain = this.enc.decrypt(raw);
    const items = decodeTop(plain);
    const cid = items[0];
    const seq = items[1];
    const args = items.slice(2);
    const key = String(seq);
    const w = this.waiters.get(key);
    if (w) {
      this.waiters.delete(key);
      w({ cid, args });
    } else {
      this.onPush && this.onPush(cid, seq, args);
    }
  }

  sendFrame(buf) {
    const header = Buffer.alloc(2);
    header.writeUInt16BE(buf.length, 0);
    this.socket.write(Buffer.concat([header, buf]));
  }

  handshake(version, token) {
    return new Promise((resolve) => {
      this.handshakeWaiter = resolve;
      this.sendFrame(buildHandshakeHello(version, token));
    }).then((raw) => {
      const [sessionId, resourceAddrs, encType, encKey] = decodeTop(raw);
      this.enc.setCipher(Number(encType), encKey.buf);
      return { sessionId, resourceAddrs, encType, encKey };
    });
  }

  sendCommand(cid, args) {
    const seq = ++this.seq;
    const items = [BigInt(cid), BigInt(seq), ...args];
    const plain = encodeTop(items);
    this.sendFrame(this.enc.encrypt(plain));
    return new Promise((resolve) => this.waiters.set(String(seq), resolve));
  }

  sendServicePing(payload) {
    const seq = ++this.seq;
    const items = [0n, BigInt(seq), 0n, payload];
    const plain = encodeTop(items);
    this.sendFrame(this.enc.encrypt(plain));
    return new Promise((resolve) => this.waiters.set(String(seq), resolve));
  }
}

function stringify(v) {
  return JSON.stringify(v, (k, val) => {
    if (typeof val === 'bigint') return val.toString() + 'n';
    if (Buffer.isBuffer(val)) return '<Buffer ' + val.toString('hex') + '>';
    return val;
  });
}

async function main() {
  // allowLoginAutoRegister: true here is a *test-only* convenience for
  // quickly creating throwaway accounts across this large flow test -
  // strict "only registered users with the right password" enforcement
  // (the default, real behavior) is verified separately in
  // testStrictLogin() below.
  const testConfig = {
    ...config,
    port: 19080,
    cipherType: 2, // exercise RC4 explicitly
    dbPath: ':memory:',
    allowLoginAutoRegister: true,
  };
  const server = new DVServer(testConfig);
  await server.start();

  const socket = net.connect(testConfig.port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const client = new FakeClient(socket);

  console.log('--- handshake ---');
  const hs = await client.handshake([2, 3, 1], 0);
  console.log('handshake result:', stringify(hs));
  assert.strictEqual(Number(hs.encType), 2, 'server should have negotiated RC4 (cipherType=2)');

  console.log('--- region (fires automatically on connect, before login - see RegionStorage.java) ---');
  const region = await client.sendCommand(115, [new LongArr([15, 0, 0]), null]);
  console.log('Region: got', region.args[1] ? region.args[1].items.length : 0, 'items, version', region.args[2]);
  assert.strictEqual(region.args.length, 3, 'must have 3 elements so the client parses the version correctly');
  assert.strictEqual(region.args[2], REGION_DATA_VERSION, 'must report the fixed data version, not echo the request');
  const items = region.args[1].items;
  assert.ok(items.length > 300, `expected the full real dataset (~313 items), got ${items.length}`);
  const russia = items.find((s) => s.items[0].items[0] === '0');
  assert.ok(russia, 'Russia (code "0") must be present');
  assert.deepStrictEqual(
    russia.items[0].items,
    ['0', '7', '', 'RU'],
    'Russia: [CODE, PREFIX, PAY_CODE, ISO] must be ["0","7","","RU"]'
  );
  assert.strictEqual(russia.items[3], null, 'Russia must be top-level (no parent)');
  const sverdlovsk = items.find((s) => s.items[0].items[0] === '66');
  assert.ok(sverdlovsk, 'a real Russian region (Sverdlovsk, code 66) must be present');
  assert.deepStrictEqual(sverdlovsk.items[3].items, ['0'], "Sverdlovsk's parent must be Russia (code 0)");
  console.log('region data verified: real countries + Russian regions, correctly nested');

  // Second connection already caching our fixed version -> cheap "no changes" path.
  const region2 = await client.sendCommand(115, [new LongArr([15, 0, REGION_DATA_VERSION]), null]);
  assert.strictEqual(region2.args[1], null, 'a client that already has our current version gets no data resent');
  assert.strictEqual(region2.args[2], REGION_DATA_VERSION);

  console.log('--- login (new account, auto-register) ---');
  const loginArgs = [new StrArr(['test_user', 'hunter2', 'AA:BB:CC:DD:EE:FF', 'install-123', 'sdk.19 Google sdk']), null];
  const loginResp = await client.sendCommand(2, loginArgs);
  console.log('login response:', stringify(loginResp));
  assert.strictEqual(loginResp.args[0], true, 'login should succeed for a new account');
  const userInfo = loginResp.args[1];
  assert.ok(userInfo instanceof Seq, 'args[1] should be a Seq (userInfo)');
  const ids = userInfo.items[0];
  assert.strictEqual(ids.kind, 'long[]');
  const userId = ids.items[0];
  console.log('assigned userId:', userId);

  console.log('--- login (same account, wrong password) ---');
  const badLogin = await client.sendCommand(2, [
    new StrArr(['test_user', 'WRONG', 'AA:BB:CC:DD:EE:FF', 'install-123', 'sdk.19 Google sdk']),
    null,
  ]);
  console.log('bad login response:', stringify(badLogin));
  assert.strictEqual(badLogin.args[0], false, 'login with wrong password should fail');

  console.log('--- login (same account, correct password again) ---');
  const login2 = await client.sendCommand(2, [
    new StrArr(['test_user', 'hunter2', 'AA:BB:CC:DD:EE:FF', 'install-123', 'sdk.19 Google sdk']),
    null,
  ]);
  assert.strictEqual(login2.args[0], true);
  assert.strictEqual(login2.args[1].items[0].items[0], userId, 'same login should return same userId');
  console.log('re-login OK, same userId confirmed');

  console.log('--- keepalive / service ping ---');
  const pingResp = await client.sendServicePing(BigInt(Date.now()));
  console.log('ping response:', stringify(pingResp));
  assert.strictEqual(pingResp.cid, 0n);

  console.log('--- registration (real, phone-based, matching RegistrationActivity) ---');
  const socket3 = net.connect(testConfig.port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket3.once('connect', resolve);
    socket3.once('error', reject);
  });
  const client3 = new FakeClient(socket3);
  await client3.handshake([2, 3, 1], 0);

  const birthday = new LongArr([1995, 5, 20]);
  const reg1 = await client3.sendCommand(1, [
    new StrArr(['+79161234567', 'Новый Юзер', 'Moscow', 'ru', 'RU']),
    birthday,
    true,
  ]);
  console.log('Registration (new phone):', stringify(reg1.args));
  assert.strictEqual(reg1.args[0], 0n, 'registering a fresh phone number should succeed');

  // The real client never gets the password back over the wire (it's
  // "SMS'd") - peeking at the store directly here mirrors what an admin
  // could do server-side, and lets the test prove the generated password
  // actually works end-to-end.
  const registered = server.store.getByLogin('+79161234567');
  console.log('generated SMS password (server-side only):', registered.password);
  const loginWithSmsPw = await client3.sendCommand(2, [
    new StrArr(['+79161234567', registered.password, 'dev3', 'inst3', 'info3']),
    null,
  ]);
  assert.strictEqual(loginWithSmsPw.args[0], true, 'logging in with the generated SMS password should work');
  console.log('login with generated password: OK');

  const reg2 = await client3.sendCommand(1, [
    new StrArr(['+79161234567', 'AnotherNick', 'Moscow', 'ru', 'RU']),
    birthday,
    true,
  ]);
  console.log('Registration (duplicate phone):', stringify(reg2.args));
  assert.strictEqual(reg2.args[0], 2n, 'registering the same phone twice should report "already exists"');

  console.log('--- password recovery ---');
  const recov1 = await client3.sendCommand(38, ['+79161234567']);
  console.log('PasswordRecovery (known phone):', stringify(recov1.args));
  assert.strictEqual(recov1.args[0], 1n);
  const newPw = server.store.getByLogin('+79161234567').password;
  assert.notStrictEqual(newPw, registered.password, 'recovery should have generated a NEW password');
  const oldPwLoginFails = await client3.sendCommand(2, [
    new StrArr(['+79161234567', registered.password, 'dev3', 'inst3', 'info3']),
    null,
  ]);
  assert.strictEqual(oldPwLoginFails.args[0], false, 'old password should no longer work after recovery');
  const newPwLoginWorks = await client3.sendCommand(2, [
    new StrArr(['+79161234567', newPw, 'dev3', 'inst3', 'info3']),
    null,
  ]);
  assert.strictEqual(newPwLoginWorks.args[0], true, 'new password from recovery should work');
  console.log('password recovery rotated the password correctly');

  const recov2 = await client3.sendCommand(38, ['+70000000000']);
  console.log('PasswordRecovery (unknown phone):', stringify(recov2.args));
  assert.strictEqual(recov2.args[0], 3n, 'recovery for an unregistered phone should report "not registered"');
  socket3.end();

  console.log('--- second account (separate connection, like a second device) ---');
  const socket2 = net.connect(testConfig.port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket2.once('connect', resolve);
    socket2.once('error', reject);
  });
  const client2 = new FakeClient(socket2);
  await client2.handshake([2, 3, 1], 0);
  const login3 = await client2.sendCommand(2, [
    new StrArr(['test_user2', 'pw2', 'dev2', 'inst2', 'info2']),
    null,
  ]);
  const userId2 = login3.args[1].items[0].items[0];
  console.log('second account userId:', userId2, '(session1 is still logged in as', userId, ')');

  console.log('--- bootstrap commands (post-login) ---');
  const settings = await client.sendCommand(81, [new LongArr([3, 11]), new StrArr(['1', '2'])]);
  console.log('GetSettings:', stringify(settings.args));
  assert.strictEqual(settings.args[0].items.length, 0, 'empty settings response must be a safe no-op');
  const getOpt = await client.sendCommand(107, [new LongArr([1, 2, 3])]);
  console.log('GetOption:', stringify(getOpt.args));
  const rating = await client.sendCommand(26, []);
  console.log('Rating:', stringify(rating.args));
  assert.strictEqual(rating.args[0], false);
  const btMeetings = await client.sendCommand(36, [new LongArr([8, 0])]);
  console.log('LastBtMeetings:', stringify(btMeetings.args));
  const stickers = await client.sendCommand(126, [new LongArr([100, 0])]);
  console.log('StickersCategories:', stringify(stickers.args));
  const presents = await client.sendCommand(40, [new LongArr([100, 0])]);
  console.log('PresentCategoryList:', stringify(presents.args));
  const paidServices = await client.sendCommand(60, []);
  console.log('PaidServices:', stringify(paidServices.args));
  const liveChat = await client.sendCommand(72, []);
  assert.strictEqual(liveChat.args[0], 0n, 'CanWriteLiveChat should report 0 = not banned');
  const changePhoto = await client.sendCommand(73, []);
  assert.strictEqual(changePhoto.args[0], true);
  const notifications = await client.sendCommand(111, [15n, null]);
  console.log('NotificationList:', stringify(notifications.args));
  const familiar = await client.sendCommand(104, [new LongArr([15, 0])]);
  console.log('FamiliarList:', stringify(familiar.args));
  const events = await client.sendCommand(23, [15n, null]);
  console.log('EventList:', stringify(events.args));
  const markOption = await client.sendCommand(108, [new LongArr([1, 2])]);
  console.log('MarkOption:', stringify(markOption.args));
  const btFind = await client.sendCommand(4, [new StrArr(['AA:BB:CC:DD:EE:FF', 'SomePhone', ''])]);
  console.log('BtFind:', stringify(btFind.args));
  assert.ok(btFind.args[0] instanceof Seq, 'BtFind response must be a single Seq');
  const sendSetting = await client.sendCommand(80, [42n, 'some-gcm-id']);
  console.log('SendSettingToServer:', stringify(sendSetting.args));
  console.log('post-login bootstrap: all real commands answered without error');

  console.log('--- user profile / small info ---');
  const profile = await client.sendCommand(31, [userId]);
  console.log('UserProfile:', stringify(profile.args));
  assert.ok(profile.args[0] instanceof Seq);
  const smallInfo = await client.sendCommand(51, [new LongArr([userId, userId2])]);
  console.log('UserSmallInfo:', stringify(smallInfo.args));
  assert.strictEqual(smallInfo.args[1].items.length, 2, 'should resolve both known ids');

  console.log('--- friends ---');
  const friendsEmpty = await client.sendCommand(17, [15n, 0n]);
  assert.strictEqual(friendsEmpty.args[2].items.length, 0);
  const addFriend = await client.sendCommand(15, [userId2]);
  console.log('AddToFriends:', stringify(addFriend.args));
  const friendsAfter = await client.sendCommand(17, [15n, 0n]);
  console.log('FriendsList after add:', stringify(friendsAfter.args));
  assert.strictEqual(friendsAfter.args[2].items.length, 1, 'should have exactly one friend now');
  assert.strictEqual(friendsAfter.args[2].items[0].items[0].items[0].items[0], userId2);

  console.log('--- guest list / online status / live list / search ---');
  const guests = await client.sendCommand(77, [15n, 0n]);
  console.log('GuestList:', stringify(guests.args));
  const online = await client.sendCommand(136, [new LongArr([userId, userId2, 999999])]);
  console.log('OnlineStatus:', stringify(online.args));
  assert.strictEqual(online.args[1].items.length, 3, 'must match request length exactly');
  const live = await client.sendCommand(27, [1n, 'Moscow', null]);
  console.log('LiveList:', stringify(live.args));
  const search = await client.sendCommand(14, [15n, 0n, new Seq([])]);
  console.log('Search:', stringify(search.args));

  console.log('--- messaging (real content, backed by SQLite) ---');
  const msgText = 'Привет! Как дела? 🙂';
  const sendMsg = await client.sendCommand(8, [userId2, msgText]);
  console.log('MessageSend:', stringify(sendMsg.args));
  assert.notStrictEqual(sendMsg.args[0], null, 'send should succeed (non-null message id)');
  const sentMsgId = sendMsg.args[0];

  // Fetch it back as the RECIPIENT's incoming messages (on client2, which is
  // still logged in as userId2).
  const lastIncoming2 = await client2.sendCommand(10, [new LongArr([15, 0]), true]);
  console.log('LastIncomingMessages (recipient side):', stringify(lastIncoming2.args));
  assert.strictEqual(lastIncoming2.args[1].items.length, 1, 'recipient should see exactly one incoming message');
  const incomingSeq = lastIncoming2.args[1].items[0];
  const [msgIds, flags, body] = incomingSeq.items;
  assert.strictEqual(msgIds.items[0], sentMsgId, 'message id should match what MessageSend returned');
  assert.strictEqual(msgIds.items[1], userId, "otherUserId should be the sender's id, from recipient's perspective");
  assert.strictEqual(body, msgText, 'message body should round-trip exactly, including Cyrillic/emoji');
  console.log('message body round-tripped correctly:', JSON.stringify(body));

  // Fetch it back as the SENDER's outgoing messages.
  const lastOutcoming = await client.sendCommand(10, [new LongArr([15, 0]), false]);
  console.log('LastOutcomingMessages (sender side):', stringify(lastOutcoming.args));
  assert.strictEqual(lastOutcoming.args[1].items.length, 1);
  assert.strictEqual(lastOutcoming.args[1].items[0].items[2], msgText);

  // History for the specific conversation.
  const history = await client.sendCommand(12, [new LongArr([15, 0, userId2])]);
  console.log('MessagesHistory:', stringify(history.args));
  assert.strictEqual(history.args[1].items.length, 1);

  const msgWork = await client.sendCommand(33, [new LongArr([sentMsgId, 0n])]);
  console.log('MessageWork (mark read):', stringify(msgWork.args));

  console.log('--- эфир (live feed / wall) ---');
  const emptyLive = await client.sendCommand(27, [15n, 'RU', null]);
  assert.strictEqual(emptyLive.args[1].items.length, 0, 'live feed for a fresh region should start empty');
  const postText = 'Всем привет из эфира! 🎉';
  const postResp = await client.sendCommand(55, [new StrArr(['RU', postText]), null]);
  console.log('SendMessageToLiveChat:', stringify(postResp.args));
  assert.strictEqual(postResp.args[0], 0n, 'posting to the live feed should always succeed (no payment backend)');
  const liveAfterPost = await client.sendCommand(27, [15n, 'RU', null]);
  assert.strictEqual(liveAfterPost.args[1].items.length, 1, 'the post should now show up in region RU');
  const liveItem = liveAfterPost.args[1].items[0];
  assert.strictEqual(liveItem.items[1], postText, 'live feed item text must round-trip exactly');
  assert.strictEqual(
    liveItem.items[0].items[0].items[0],
    userId,
    'live feed item author must be the posting user'
  );
  const liveOtherRegion = await client.sendCommand(27, [15n, 'US', null]);
  assert.strictEqual(liveOtherRegion.args[1].items.length, 0, 'posts must be scoped to their own region');
  console.log('live feed: post + region-scoped list verified');

  console.log('--- профиль (view + edit) ---');
  const profileBefore = await client.sendCommand(31, [userId]);
  console.log('UserProfile (before edit):', stringify(profileBefore.args));
  assert.strictEqual(profileBefore.args[4], true, 'user should show online while this session is connected');
  const editResp = await client.sendCommand(32, [
    new LongArr([1995, 5, 20]),
    new StrArr(['test_user_nick', 'Иван', 'Иванов', 'Москва', '', '', 'Люблю ретро-технологии', 'Ретро, Android']),
    true,
  ]);
  assert.strictEqual(editResp.args[0], true, 'SendUserInfoCommand should always report success');
  const profileAfter = await client.sendCommand(31, [userId]);
  console.log('UserProfile (after edit):', stringify(profileAfter.args));
  assert.strictEqual(
    profileAfter.args[1].items[0],
    'Люблю ретро-технологии',
    'ABOUT (String[0]) should reflect the edit'
  );
  assert.strictEqual(
    profileAfter.args[1].items[3],
    'Ретро, Android',
    'INTERESTS (String[3]) should reflect the edit'
  );
  assert.strictEqual(profileAfter.args[0].items[1].items[0], 'test_user_nick', "nick should reflect the edit");
  console.log('profile: view + edit round-trip verified');

  console.log('--- relogin ---');
  const reloginResp = await client.sendCommand(13, [userId, 'hunter2']);
  console.log('relogin response:', stringify(reloginResp));
  assert.strictEqual(reloginResp.args[0], true, 'relogin with correct saved password should succeed');

  console.log('--- relogin with wrong password ---');
  const badRelogin = await client.sendCommand(13, [userId, 'nope']);
  assert.strictEqual(badRelogin.args[0], false);
  console.log('relogin correctly rejected wrong password');

  console.log('--- logout ---');
  const logoutResp = await client.sendCommand(3, []);
  console.log('logout response:', stringify(logoutResp));

  console.log('\nALL CHECKS PASSED (protocol flow)');
  socket.end();
  socket2.end();
  server.stop();

  await testPersistence();
  await testStrictLogin();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
}

async function testPersistence() {
  console.log('\n--- SQLite persistence across a restart ---');
  const os = require('os');
  const fs = require('fs');
  const dbPath = require('path').join(os.tmpdir(), `dv-test-${Date.now()}.sqlite3`);

  let server = new DVServer({ ...config, port: 19082, cipherType: 0, dbPath, allowLoginAutoRegister: true });
  await server.start();
  let socket = net.connect(19082, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let client = new FakeClient(socket);
  await client.handshake([2, 3, 1], 0);
  const login = await client.sendCommand(2, [new StrArr(['persisted_user', 'secret', 'd', 'i', 'x']), null]);
  const uid = login.args[1].items[0].items[0];
  await client.sendCommand(8, [uid, 'note to self']); // send a message to self, just to have a row
  socket.end();
  server.stop();
  await new Promise((r) => setTimeout(r, 50)); // let the close settle

  console.log('restarting server against the same DB file:', dbPath);
  server = new DVServer({ ...config, port: 19082, cipherType: 0, dbPath, allowLoginAutoRegister: true });
  await server.start();
  socket = net.connect(19082, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  client = new FakeClient(socket);
  await client.handshake([2, 3, 1], 0);
  // Wrong password against the SAME login must now fail, proving the
  // account really was persisted to disk and reloaded, not recreated fresh.
  const wrongPw = await client.sendCommand(2, [new StrArr(['persisted_user', 'WRONG', 'd', 'i', 'x']), null]);
  assert.strictEqual(wrongPw.args[0], false, 'account should still exist after restart, rejecting the wrong password');
  const rightPw = await client.sendCommand(2, [new StrArr(['persisted_user', 'secret', 'd', 'i', 'x']), null]);
  assert.strictEqual(rightPw.args[0], true);
  assert.strictEqual(rightPw.args[1].items[0].items[0], uid, 'same user id after restart');
  const history = await client.sendCommand(12, [new LongArr([15, 0, uid])]);
  assert.strictEqual(history.args[1].items.length, 1, 'the message sent before restart should still be there');
  assert.strictEqual(history.args[1].items[0].items[2], 'note to self');
  console.log('confirmed: account + message survived a full server restart via', dbPath);

  socket.end();
  server.stop();
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(dbPath + '-wal', { force: true });
  fs.rmSync(dbPath + '-shm', { force: true });
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

async function testStrictLogin() {
  console.log('\n--- strict login: only registered users, correct password (default config) ---');
  // Deliberately NOT passing allowLoginAutoRegister - this is the real
  // default the server ships with.
  const server = new DVServer({ ...config, port: 19083, cipherType: 0, dbPath: ':memory:' });
  await server.start();
  const socket = net.connect(19083, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const client = new FakeClient(socket);
  await client.handshake([2, 3, 1], 0);

  const neverRegistered = await client.sendCommand(2, [
    new StrArr(['+79990001122', 'whatever', 'd', 'i', 'x']),
    null,
  ]);
  assert.strictEqual(neverRegistered.args[0], false, 'login for a never-registered account must be rejected');
  assert.strictEqual(server.store.getByLogin('+79990001122'), null, 'it must NOT have been auto-created either');
  console.log('unregistered login correctly rejected, and did not create an account');

  const reg = await client.sendCommand(1, [
    new StrArr(['+79990001122', 'RealUser', 'Moscow', 'ru', 'RU']),
    new LongArr([1990, 0, 1]),
    true,
  ]);
  assert.strictEqual(reg.args[0], 0n, 'registration itself should still work');
  const password = server.store.getByLogin('+79990001122').password;

  const wrongPw = await client.sendCommand(2, [
    new StrArr(['+79990001122', 'not-the-password', 'd', 'i', 'x']),
    null,
  ]);
  assert.strictEqual(wrongPw.args[0], false, 'wrong password for a real registered account must be rejected');

  const rightPw = await client.sendCommand(2, [new StrArr(['+79990001122', password, 'd', 'i', 'x']), null]);
  assert.strictEqual(rightPw.args[0], true, 'correct password for a registered account must succeed');
  console.log('registered account: wrong password rejected, correct password accepted');

  socket.end();
  server.stop();
}
