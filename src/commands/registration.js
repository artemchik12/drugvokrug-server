'use strict';

const crypto = require('crypto');

/**
 * CID 1 - drug.vokrug.system.command.RegistrationCommand.
 *
 * Unlike the permissive "any login/password auto-registers" convenience
 * `LoginCommand` offers for quick testing (see commands/login.js), this is
 * the *real* registration flow the app's UI actually uses - and it's phone
 * number based, not username/password: the server generates a password and
 * sends it by SMS (see `Config.PASSWORD_SMS_TEXT`, "Ваш пароль: ...
 * drugvokrug"). The client never learns the password from this call - after
 * a successful response it saves the phone number as the login with an
 * *empty* stored password (`AuthDB.a(strB, "", ...)` in
 * RegistrationActivity.java) and expects the user to type in the SMS'd
 * password on the following login screen.
 *
 * Traced from RegistrationActivity.java's constructor call and its
 * ICommandListener (the Command subclass's own `a(Object[])` always returns
 * null - the response is only handled at the call site):
 *
 * Request:
 *   [StrArr[phone, nick, city, language, country],
 *    LongArr[birthYear, birthMonth(0-indexed), birthDay],
 *    Boolean isMale]
 *
 * Response: [Long code]
 *   0 -> success ("password_sended_to_you")
 *   2 or 3 -> "user with this phone number already exists"
 *   anything else (1, or omitted) -> "registration_wrong_phone"
 *
 * This server has no real SMS gateway, so the generated password is logged
 * to the console instead - use it to log in with LoginCommand afterward.
 */
async function handleRegistration(args, session) {
  const fields = args[0];
  if (!fields || fields.kind !== 'str[]' || fields.items.length < 5) {
    session.server.log('registration-bad-args', session.remoteAddr, JSON.stringify(args));
    return [1n]; // wrong phone / malformed request
  }
  const [phone, nick, city, language, country] = fields.items;
  const birth = args[1];
  const isMale = args[2];

  const phoneNormalized = normalizePhone(phone);
  if (!phoneNormalized) {
    session.server.log('registration-bad-phone', session.remoteAddr, `phone=${JSON.stringify(phone)}`);
    return [1n];
  }

  if (session.server.store.getByLogin(phoneNormalized)) {
    session.server.log('registration-exists', session.remoteAddr, `phone=${phoneNormalized}`);
    return [2n];
  }

  const password = randomSmsPassword();
  const [birthYear, birthMonth, birthDay] = birth && birth.kind === 'long[]' ? birth.items.map(Number) : [];
  const user = session.server.store.register({
    login: phoneNormalized,
    password,
    name: nick || phoneNormalized,
    isMale: Boolean(isMale),
    city: city || null,
    country: country || null,
    language: language || null,
    birthYear,
    birthMonth,
    birthDay,
  });

  // No real SMS gateway - this is the only place the generated password is
  // ever surfaced. In a real deployment this line would be replaced by an
  // actual SMS send using Config.PASSWORD_SMS_TEXT's template.
  session.server.log(
    'registration-ok',
    session.remoteAddr,
    `phone=${phoneNormalized} nick=${nick} userId=${user.id} SMS password="${password}"`
  );
  return [0n];
}

/**
 * CID 38 - drug.vokrug.system.command.PasswordRecoveryCommand.
 * Request: [String phone]
 * Response: [Long code]
 *   1 -> success ("sms_will_be_sended") - a new password was generated
 *   2 -> too many tries today (rate limiting - not implemented, never sent)
 *   3 -> "such_number_is_not_registrated"
 */
async function handlePasswordRecovery(args, session) {
  const phone = normalizePhone(args[0]);
  const user = phone ? session.server.store.getByLogin(phone) : null;
  if (!user) {
    session.server.log('password-recovery-unknown', session.remoteAddr, `phone=${JSON.stringify(args[0])}`);
    return [3n];
  }
  const password = randomSmsPassword();
  session.server.store.setPassword(user.id, password);
  session.server.log(
    'password-recovery-ok',
    session.remoteAddr,
    `phone=${phone} userId=${user.id} new SMS password="${password}"`
  );
  return [1n];
}

// Both real registration and password recovery are keyed by phone number;
// this only strips whitespace, it does not validate/canonicalize a real
// phone number format (the client does its own formatting - InputFilters.d
// in RegistrationActivity - which wasn't traced further).
function normalizePhone(phone) {
  if (typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// The real server's password format was never observed (the client treats
// it as an opaque string typed in from an SMS) - a 6-digit numeric code is
// a plausible, easy-to-type-on-a-phone choice and is what this server uses.
function randomSmsPassword() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

module.exports = { handleRegistration, handlePasswordRecovery };
