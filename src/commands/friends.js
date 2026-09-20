'use strict';

const { LongArr, SeqArr } = require('../wire');
const { userInfoSeq } = require('../userinfo');

/**
 * CID 17 - drug.vokrug.system.command.FriendsListCommand (does not extend
 * the generic ListCommand base - it's hand-rolled with its own pagination).
 *
 * Request: [LongArr[chunkSize, offset]] - a single wrapped Long[2], not two
 * separate top-level Longs (`super.a((Object) new Long[]{l, l2})` always
 * adds the whole array as one wire item - see README "A wire-shape bug
 * worth remembering"). Decoded but not enforced below: this dev server
 * doesn't expect large enough friend lists to need real pagination, so it
 * always returns everything in one page.
 * Response: [Boolean, Long, SeqArr(items)] where each item is
 *   Seq([userInfo, Boolean isOnline])  (see the handler's
 *   `UserInfoFactory.a(iteratorB.b())` followed by a Boolean read)
 *
 * objArr[0]/[1] feed Command.a(Command,Object[],Long), the client's
 * auto-paginate-until-exhausted helper (see README "Wire format" for the
 * two shapes it accepts). We use the `Boolean + Long` shape and set the Long
 * so `l < objArr[1]` is always false, i.e. "no more pages, stop".
 */
async function handleFriendsList(args, session) {
  const friends = session.userId !== null ? session.server.store.getFriends(session.userId) : [];
  const items = friends.map((u) => [userInfoSeq(u), session.server.isOnline(u.id)]);
  return [true, 0n, new SeqArr(items)];
}

// CID 15 - AddToFriendsCommand. Request: [Long friendUserId]. Response: not
// read by the client at all (Command.a returns null unconditionally) - any
// ack is enough.
async function handleAddToFriends(args, session) {
  const friendId = args[0];
  if (session.userId === null || typeof friendId !== 'bigint') return [];
  const friend = session.server.store.getById(Number(friendId));
  if (friend) {
    session.server.store.addFriend(session.userId, friend.id);
    session.server.log('add-friend', session.remoteAddr, `${session.userId} -> ${friend.id}`);
  }
  return [];
}

module.exports = { handleFriendsList, handleAddToFriends };
