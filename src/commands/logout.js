'use strict';

/**
 * CID 3 - drug.vokrug.system.command.LogoutCommand.
 *
 * Sent fire-and-forget (`new LogoutCommand().e()`, i.e. with a null
 * OnParseFinished callback - LogoutCommand.a(Object[]) always returns null
 * and nothing downstream reads response fields), so any ack is enough to
 * fulfil the client's pending delivery record. No request args either.
 */
async function handleLogout(args, session) {
  session.server.log('logout', session.remoteAddr, `userId=${session.userId}`);
  if (session.userId !== null) session.server.setOffline(session.userId);
  session.userId = null;
  return [];
}

module.exports = { handleLogout };
