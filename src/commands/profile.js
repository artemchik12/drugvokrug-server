'use strict';

const { LongArr, StrArr, SeqArr } = require('../wire');
const { userInfoSeq } = require('../userinfo');

/**
 * CID 31 - drug.vokrug.system.command.UserProfileCommand.
 *
 * Request: [Long userId]
 * Response: [userInfo, String[4], Long[2], Long[4], Boolean]
 * Every field below was resolved with certainty (not guessed) by cross-
 * referencing UserProfileCommand.a(Object[])'s setter calls against
 * UserInfo.java's getter names, then against
 * drug.vokrug.activity.profile.MyProfileDataFragment.java's DataType enum,
 * which ties each getter to an L10n key (profile_about, profile_meetings,
 * profile_register, ...) - see README "UserProfileCommand real fields":
 *   userInfo -> UserInfoFactory.a() shape, see userinfo.js
 *   String[4] -> [0]=ABOUT (L10n "profile_about"), [3]=INTERESTS
 *                ("profile_interests"); [1]/[2] unread by this command
 *   Long[2]   -> [0]=REGISTER date (Q(), "profile_register" - NOT a
 *                "boost until" timestamp, an earlier draft of this file
 *                guessed wrong here), [1]=last-seen timestamp (used by
 *                UserInfo.W() to render "offline 3 days ago" etc.)
 *   Long[4]   -> [0]=MEETINGS count (N(), "profile_meetings"), [1]/[2]
 *                untraced (no DataType uses O()/P()), [3]=a relationship-
 *                status code (J(), "profile_relations", combined with
 *                gender for the displayed string)
 *   Boolean   -> isOnline (M(), used by UserInfo.W() for "online" vs
 *                "offline ...")
 */
async function handleUserProfile(args, session) {
  const userId = args[0];
  const targetId = typeof userId === 'bigint' ? Number(userId) : session.userId;
  const user = targetId !== null ? session.server.store.getById(targetId) : null;
  if (!user) {
    session.server.log('user-profile-not-found', session.remoteAddr, `userId=${userId}`);
    // Nothing in the traced client code models a "not found" case for this
    // command (it's always requested for a known id from a list/search
    // result), so there's no known-safe failure shape - fall back to an
    // empty placeholder profile rather than leaving the request to time out.
    return [
      userInfoSeq({ id: targetId ?? 0, name: '', isMale: true }),
      new StrArr(['', '', '', '']),
      new LongArr([0, 0]),
      new LongArr([0, 0, 0, 0]),
      false,
    ];
  }
  const isOnline = session.server.isOnline(user.id);
  const lastSeen = user.lastSeen ?? user.createdAt;
  return [
    userInfoSeq(user),
    new StrArr([user.about || '', '', '', user.interests || '']),
    new LongArr([user.createdAt, lastSeen]),
    new LongArr([0, 0, 0, 0]),
    isOnline,
  ];
}

/**
 * CID 32 - drug.vokrug.system.command.SendUserInfoCommand. The profile-edit
 * screen's "save" action - always sends the *entire* editable profile, not
 * an incremental patch.
 *
 * Request: [Long[4]{birthYear, birthMonth, birthDay, genderInt},
 *           String[8]{nick, firstName, surname, city, "", "", about, interests},
 *           Boolean isMale]
 * Field order/meaning confirmed the same way as UserProfileCommand above -
 * MyProfileDataFragment's NICK/NAME/SURNAME/CITY/ABOUT/INTERESTS DataTypes
 * map 1:1 to H()/F()/G()/y()/L()/R(), which is exactly this order (indices
 * 4-5 are hardcoded empty strings client-side, not user-editable here).
 * Response: [Boolean success] - the client retries a few times on `false`
 * (SAVE_USER_INFO_MAX_ATTEMPTS_KEY), so always answering `true` (we always
 * persist successfully) avoids pointless retries.
 */
async function handleSendUserInfo(args, session) {
  if (session.userId === null) return [false];
  const birth = args[0];
  const strs = args[1];
  const isMale = args[2];
  const [nick, firstName, surname, city, , , about, interests] =
    strs && strs.kind === 'str[]' ? strs.items : ['', '', '', '', '', '', '', ''];
  session.server.store.updateProfile(session.userId, {
    nick,
    firstName,
    surname,
    city,
    about,
    interests,
    isMale: Boolean(isMale),
  });
  if (birth && birth.kind === 'long[]' && birth.items.length >= 3) {
    // Birthday isn't part of updateProfile's UPDATE statement (kept
    // separate since RegistrationCommand also writes it) - reuse the same
    // columns via a second, tiny update.
    session.server.store.db
      .prepare('UPDATE users SET birth_year = ?, birth_month = ?, birth_day = ? WHERE id = ?')
      .run(Number(birth.items[0]), Number(birth.items[1]), Number(birth.items[2]), session.userId);
  }
  session.server.log('send-user-info', session.remoteAddr, `userId=${session.userId} nick=${nick}`);
  return [true];
}

/**
 * CID 51 - drug.vokrug.system.command.UserSmallInfoCommand. Used to
 * bulk-resolve lightweight profile info for a list of user ids (e.g. after
 * receiving messages from unknown senders).
 *
 * Request: [Long[] userIds]
 * Response: [?, SeqArr(userInfo...)] - unlike Friends/GuestList, items here
 * are bare userInfo Seqs (UserInfoFactory.a()), not wrapped with an extra
 * per-item field.
 */
async function handleUserSmallInfo(args, session) {
  const ids = args[0];
  const requested = ids && ids.kind === 'long[]' ? ids.items : [];
  const items = [];
  for (const id of requested) {
    const user = session.server.store.getById(Number(id));
    if (user) items.push([...userInfoSeq(user).items]);
  }
  return [0n, new SeqArr(items)];
}

module.exports = { handleUserProfile, handleSendUserInfo, handleUserSmallInfo };
