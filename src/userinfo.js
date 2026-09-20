'use strict';

const { LongArr, StrArr, Seq } = require('./wire');

/**
 * Builds the nested user-info ICollection consumed by
 * drug.vokrug.system.UserInfoFactory.a()/.b():
 *   [LongArr(ids), StrArr(text), Boolean isMale]
 *
 * ids[0] is the user id (read standalone via UserInfoFactory.c()); ids[1] is
 * always read too (UserInfo.d(Long)) but its meaning wasn't traced further.
 * We deliberately keep ids at length 2 and text at length 2 to stay on the
 * client's "short" parsing branches (`length >= 3/5` and `length >= 6`
 * respectively trigger additional, untraced field setters - see
 * commands/login.js for the full writeup). Extend this once those are
 * traced from a live capture.
 */
function userInfoSeq(user) {
  return new Seq([new LongArr([user.id, user.id]), new StrArr([user.name, '']), Boolean(user.isMale ?? true)]);
}

module.exports = { userInfoSeq };
