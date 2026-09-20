'use strict';

const { LongArr, StrArr, SeqArr, Seq } = require('../wire');
const { userInfoSeq } = require('../userinfo');

// Builds one LiveChatItem, ported from drug.vokrug.objects.system.
// LiveChatItem's ICollection constructor:
//   Seq([userInfo, String text, LongArr[timestamp, itemId]])
// (field order confirmed by the constructor reading userInfo first, then a
// String, then a Long[2] where lArr[0]->f() (unused further here) and
// lArr[1]->e() (the item's own id, used for OrangeMenu.Identifiable.b()
// and equals())).
function liveChatItemSeq(post, author) {
  return new Seq([userInfoSeq(author), post.body, new LongArr([post.createdAt, post.id])]);
}

/**
 * CID 27 - drug.vokrug.system.command.LiveListCommand ("эфир"/wall feed for
 * a specific region).
 *
 * Request: [Long chunkSize, String regionCode, Long? sinceId] - three
 * separate top-level items (each its own `super.a(...)` call, unlike most
 * list-style commands - no wrapped array here).
 * Response: [?, SeqArr(liveChatItemSeq...)] - objArr[0] is never read by
 * this handler (`LiveListCommand.a(Object[])` returns null right after
 * processing objArr[1], no pagination-continuation call), so it can be
 * anything as long as it's present.
 */
async function handleLiveList(args, session) {
  const chunkSize = Number(args[0] ?? 15n);
  const regionCode = typeof args[1] === 'string' ? args[1] : '0';
  const rows = session.server.store.getWallPosts(regionCode, chunkSize, 0);
  const items = rows.map((row) => {
    const author = session.server.store.getById(row.authorId);
    return [...liveChatItemSeq(row, author || { id: row.authorId, name: '', isMale: true }).items];
  });
  session.server.log(
    'live-list',
    session.remoteAddr,
    `region=${regionCode} -> ${items.length} posts`
  );
  return [false, new SeqArr(items)];
}

/**
 * CID 55 - drug.vokrug.system.command.SendMessageToLiveChatCommand (posting
 * to the "эфир"). Extends PaymentCommand rather than Command directly.
 *
 * Request: [StrArr[regionCode, text], Long? paymentAmount] - note the wire
 * order is [regionCode, text], the *reverse* of the constructor's own
 * (String text, String regionCode, Long) parameter order - confirmed via
 * the call site in SpecificWallFragment.java
 * (`new SendMessageToLiveChatCommand(str, specificWallFragment.f, l)` where
 * `f` is the same region-code field `LiveListCommand` is also called with).
 * Response (PaymentCommand.a(Object[])): [Long resultCode, Long? balance]
 *   resultCode: 0 = success (shows a success toast); 1 = "no money" (no
 *   toast if this was a free post); anything else = generic error toast.
 * This server has no real payment/currency system, so posting is always
 * free and always succeeds (resultCode 0, no balance update).
 */
async function handleSendMessageToLiveChat(args, session) {
  if (session.userId === null) return [1n, null];
  const params = args[0];
  const [regionCode, text] = params && params.kind === 'str[]' ? params.items : ['0', ''];
  const saved = session.server.store.saveWallPost(session.userId, regionCode, text);
  session.server.log(
    'live-chat-send',
    session.remoteAddr,
    `user=${session.userId} region=${regionCode} text=${JSON.stringify(text)} (id=${saved.id})`
  );
  return [0n, null];
}

module.exports = { handleLiveList, handleSendMessageToLiveChat };
