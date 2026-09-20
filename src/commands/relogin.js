'use strict';

/**
 * CID 13 - drug.vokrug.system.command.ReloginCommand.
 *
 * Sent automatically on reconnect to resume a session without the full
 * login UI flow. Request args, traced from the constructor:
 *   super.a(UserInfoStorage.b().C())  -> args[0] = Long userId   (UserInfo.C())
 *   super.a(UserInfoStorage.b().c())  -> args[1] = String password
 *     (CurrentUserInfo.c() reads back the field set by
 *      `currentUserInfoB.a(this.e)` in LoginService, where this.e is the
 *      plaintext password from the original LoginCommand call - so the
 *      client really does cache the password in memory for resume)
 *
 * Response: only objArr[0] (Boolean) is read by ReloginCommand.b(); false
 * triggers ClientCore.e().o() (client-side logout/teardown). This memory
 * notes a real bug matching this shape - a ReloginCommand (cmd 13) handler
 * that produced NaN user IDs and reconnect storms - so keep this handler
 * conservative: only ever return [true] for a userId+password we actually
 * recognize, never something that could look "successful but malformed" to
 * the client.
 */
async function handleRelogin(args, session) {
  const userId = args[0];
  const password = args[1];
  if (typeof userId !== 'bigint' || typeof password !== 'string') {
    session.server.log('relogin-bad-args', session.remoteAddr, JSON.stringify(args));
    return [false];
  }

  const user = session.server.store.getById(Number(userId));
  if (!user || user.password !== password) {
    session.server.log('relogin-reject', session.remoteAddr, `userId=${userId}`);
    return [false];
  }

  session.userId = user.id;
  session.server.setOnline(user.id, session);
  session.server.log('relogin-ok', session.remoteAddr, `userId=${userId}`);
  return [true];
}

module.exports = { handleRelogin };
