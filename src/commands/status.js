'use strict';

const { SeqArr } = require('../wire');

/**
 * CID 136 - drug.vokrug.system.command.OnlineStatusCommand.
 *
 * Request: [Long[] userIds]
 * Response: [?, SeqArr(items)] where each item is Seq([Boolean isOnline,
 * Long lastSeen]). The client hard-asserts (CrashCollector +
 * IllegalStateException) if the response array length doesn't exactly match
 * the number of requested ids, so this must never drop or add entries -
 * unknown ids just get reported offline/never-seen rather than omitted.
 */
async function handleOnlineStatus(args, session) {
  const ids = args[0];
  const requested = ids && ids.kind === 'long[]' ? ids.items : [];
  const items = requested.map((id) => {
    const user = session.server.store.getById(Number(id));
    const online = user ? session.server.isOnline(user.id) : false;
    return [online, BigInt(Date.now())];
  });
  return [0n, new SeqArr(items)];
}

module.exports = { handleOnlineStatus };
