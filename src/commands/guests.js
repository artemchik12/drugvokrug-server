'use strict';

const { SeqArr } = require('../wire');

/**
 * CID 77 - drug.vokrug.system.command.GuestListCommand extends the generic
 * ListCommand(cid, limit, offset) base.
 *
 * Request: [Long limit, Long offset] (ListCommand ctor)
 * Response: [Long? count, SeqArr(items)] where each item is
 *   Seq([userInfo, Long visitTimestamp])
 *   (GuestListCommand.a(ICollection): reads userInfo then a Long via the
 *    same iterator - that Long feeds `new Guest(userId, timestamp)`)
 *
 * Profile-visit tracking isn't implemented yet (this server doesn't record
 * who looked at whose profile), so this always returns an empty list - safe
 * per ListCommand's base `a(long,Object[])`, which just builds a List from
 * objArr[1] and never branches on objArr[0].
 */
async function handleGuestList(args, session) {
  return [0n, new SeqArr([])];
}

module.exports = { handleGuestList };
