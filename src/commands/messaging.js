'use strict';

const { BoolArr, SeqArr } = require('../wire');
const { messageSeq } = require('../message');

/**
 * CID 8 - drug.vokrug.system.command.MessageSendCommand.
 *
 * Request: [Long recipientUserId, String text]
 *   Traced via `super.a(textMessage.d())` (Message.d() reads field `e`, the
 *   *other party's* user id - the recipient when sending) and
 *   `super.a(textMessage.k())` (TextMessage.k() returns the message text as
 *   a String, `this.c.toString()` - NOT a Long, despite both being added
 *   with the same untyped `Command.a(Object)` call. Confirmed by reading
 *   TextMessage's constructor and field types directly).
 * Response:
 *   failure: [null, Long errorCode(0-3)] - see MessageSendCommand.ERROR
 *   success: [Long serverMessageId, Long serverTimestamp]
 *
 * Now persists to SQLite (store.saveMessage) so it actually shows up in
 * MessagesHistoryCommand/Last(In|Out)comingMessagesCommand afterwards.
 */
async function handleMessageSend(args, session) {
  const recipientId = args[0];
  const text = args[1];
  if (session.userId === null || typeof recipientId !== 'bigint' || typeof text !== 'string') {
    session.server.log('message-send-bad-args', session.remoteAddr, JSON.stringify(args));
    return [null, 0n]; // ERROR_NO_SUCH_USER
  }
  const recipient = session.server.store.getById(Number(recipientId));
  if (!recipient) {
    return [null, 0n]; // ERROR_NO_SUCH_USER
  }
  const saved = session.server.store.saveMessage(session.userId, recipient.id, text);
  session.server.log(
    'message-send',
    session.remoteAddr,
    `${session.userId} -> ${recipient.id}: ${JSON.stringify(text)} (id=${saved.id})`
  );
  return [BigInt(saved.id), BigInt(saved.createdAt)];
}

/**
 * CID 12 - drug.vokrug.system.command.MessagesHistoryCommand.
 * Request: [LongArr[chunkSize, offset, otherUserId]] - a SINGLE wrapped
 * Long[3], not three separate top-level Longs
 * (`super.a((Object) new Long[]{...})` always adds the whole array as one
 * wire item - see README "A wire-shape bug worth remembering" for the full
 * story of how this was found and why it isn't the only command it hit).
 * Response: [Boolean[2], SeqArr(messageSeq...)] - objArr[0] is cast
 * directly to `Boolean[]` client-side (index 1 read), not the polymorphic
 * pagination shape some other commands use.
 */
async function handleMessagesHistory(args, session) {
  if (session.userId === null) return [new BoolArr([true, false]), new SeqArr([])];
  const params = args[0];
  const [chunkSize, , otherUserId] = params && params.kind === 'long[]' ? params.items : [15n, 0n, 0n];
  const rows = session.server.store.getConversation(session.userId, Number(otherUserId), Number(chunkSize), 0);
  const items = rows.map((row) => [...messageSeq(row, session.userId).items]);
  return [new BoolArr([true, false]), new SeqArr(items)];
}

/**
 * CID 10 - shared by LastIncomingMessagesCommand and
 * LastOutcomingMessagesCommand, distinguished only by a trailing Boolean
 * request arg (true=incoming, false=outgoing - see Command.a(boolean) in
 * both constructors).
 * Request: [LongArr[chunkSize, offset], Boolean isIncoming] - the two Longs
 * are ONE wrapped array (first arg), the direction flag is a separate
 * second top-level item. An earlier version of this handler treated all
 * three as flat top-level args, which silently fed a decoded array object
 * into `Number(...)` (-> NaN) and crashed SQLite with "datatype mismatch" -
 * see README.
 * Response: [Boolean[2], SeqArr(messageSeq...)] - same shape as
 * MessagesHistoryCommand.
 */
async function handleLastMessages(args, session) {
  if (session.userId === null) return [new BoolArr([true, false]), new SeqArr([])];
  const params = args[0];
  const [chunkSize, offset] = params && params.kind === 'long[]' ? params.items : [15n, 0n];
  const isIncoming = args[1];
  const rows = isIncoming
    ? session.server.store.getIncoming(session.userId, Number(chunkSize), Number(offset))
    : session.server.store.getOutgoing(session.userId, Number(chunkSize), Number(offset));
  const items = rows.map((row) => [...messageSeq(row, session.userId).items]);
  session.server.log(
    'last-messages',
    session.remoteAddr,
    `direction=${isIncoming ? 'in' : 'out'} user=${session.userId} -> ${rows.length} messages`
  );
  return [new BoolArr([true, false]), new SeqArr(items)];
}

/**
 * CID 33 - MessageWorkCommand(Long messageId, Long action). Used by
 * Message.a() to mark a message read (action=0L, see the base Message
 * class). Request: [LongArr[messageId, action]] - again a single wrapped
 * Long[2], not two separate top-level Longs. Response isn't read by the
 * client at all, so any ack is enough.
 */
async function handleMessageWork(args, session) {
  const params = args[0];
  if (params && params.kind === 'long[]' && params.items.length >= 1) {
    session.server.store.markRead(Number(params.items[0]));
  }
  return [];
}

module.exports = { handleMessageSend, handleMessagesHistory, handleLastMessages, handleMessageWork };
