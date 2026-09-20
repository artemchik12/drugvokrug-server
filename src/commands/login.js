'use strict';

const { LongArr, StrArr, Seq } = require('../wire');

/**
 * CID 2 - drug.vokrug.system.command.LoginCommand, response parsed by
 * drug.vokrug.system.LoginService.a(Long, Object[]).
 *
 * Request args, traced from LoginService.a(...) -> `new LoginCommand(str,
 * str2, phoneInfo.a(), phoneInfo.c(), phoneInfo.b(), l)`:
 *   args[0] = String[5]: [login, password, deviceId, installId, deviceInfo]
 *   args[1] = Long (optional): a resume/expiry token. LoginCommand's own
 *             constructor only ever appends this when it's > 0, which - due
 *             to what looks like a client-side bug (see LoginCommand.java,
 *             the a((Long)(-1L)) branch can never actually be taken) - means
 *             in practice this element is *usually absent*. Handle both.
 *
 * Response, traced from LoginService.a(Long, Object[]):
 *   failure: [false]
 *   success: [true, Seq(userInfo), LongArr(extraIds), Long serverTimeMs, Boolean flag]
 *     userInfo Seq (see UserInfoFactory.a()): [LongArr(ids), StrArr(text), Boolean isMale]
 *       ids:  ids[0]=userId (also used standalone via UserInfoFactory.c()),
 *             ids[1] always read (UserInfo.d(Long)); ids.length>=5 triggers
 *             an extra a(int,int,int) call (city/region ids? - untraced) so
 *             we deliberately keep this at length 2 to avoid that branch.
 *       text: text[0]=display name; text.length>=2 triggers one more String
 *             setter (untraced) so we send exactly 2 and leave text[1] empty.
 *   extraIds (objArr[2], separate Long[] from the one inside userInfo):
 *             extraIds[0] always read; length>=3/>=4 trigger further setters
 *             (untraced) - kept at length 1.
 *   flag (objArr[4]): untraced boolean setter - sent false.
 *
 * The "untraced" fields above are places where the real client only fails
 * open (it just skips setting some UI-facing profile field) if we omit the
 * longer array branch, rather than crashing - the app has explicit
 * `if (arr.length >= N)` guards for all of them. Worth re-deriving from a
 * live PCAPdroid capture against the real server if profile fields end up
 * looking wrong in the app UI.
 */
async function handleLogin(args, session) {
  const creds = args[0];
  if (!creds || creds.kind !== 'str[]' || creds.items.length < 5) {
    session.server.log('login-bad-args', session.remoteAddr, JSON.stringify(args));
    return [false];
  }
  const [login, password, deviceId, installId, deviceInfo] = creds.items;
  session.server.log(
    'login-attempt',
    session.remoteAddr,
    `login=${login} deviceId=${deviceId} installId=${installId} device=${deviceInfo}`
  );

  const user = session.server.store.authenticate(login, password);
  if (!user) {
    if (session.server.config.allowLoginAutoRegister && !session.server.store.getByLogin(login)) {
      const created = session.server.store.autoRegister(login, password);
      session.server.log('login-autoregister', session.remoteAddr, `login=${login} userId=${created.id}`);
      return loginSuccess(session, created);
    }
    // Deliberately the same [false] whether the login doesn't exist at all
    // or the password is wrong - real accounts only come from
    // RegistrationCommand now (see README "Registration and password
    // recovery"), and not distinguishing the two cases avoids leaking which
    // phone numbers/logins are registered.
    session.server.log('login-reject', session.remoteAddr, `login=${login}`);
    return [false];
  }
  return loginSuccess(session, user);
}

function loginSuccess(session, user) {
  session.userId = user.id;
  session.server.setOnline(user.id, session);
  session.server.log('login-ok', session.remoteAddr, `login=${user.login} userId=${user.id}`);

  const userInfo = new Seq([new LongArr([user.id, user.id]), new StrArr([user.name, '']), true]);

  return [true, userInfo, new LongArr([0]), BigInt(Date.now()), false];
}

module.exports = { handleLogin };
