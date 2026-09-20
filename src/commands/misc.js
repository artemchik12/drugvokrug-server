'use strict';

const { LongArr, BoolArr, SeqArr, StrArr, Seq } = require('../wire');

/**
 * CID 72 - drug.vokrug.system.command.CanWriteLiveChatCommand. Fires
 * automatically post-login (LoginService's bootstrap block). No request
 * args. Response: [Long? minutesRemaining] - a null or 0 both mean "not
 * banned from the live/wall chat", so `[0n]` is a genuine correct answer,
 * not just a safe placeholder.
 */
async function handleCanWriteLiveChat(args, session) {
  return [0n];
}

/**
 * CID 73 - drug.vokrug.system.command.CanChangePhotoCommand. Fires
 * automatically post-login. No request args. Response: [Boolean canChange]
 * - `true` sets the client's avatar state to CASUAL (unrestricted);
 * `false` sets it to BLOCKED.
 */
async function handleCanChangePhoto(args, session) {
  return [true];
}

/**
 * CID 108 - drug.vokrug.system.command.MarkOptionCommand. Request:
 * args[0] = mixed[] wrapping one Long[] (same wire pattern as
 * GetOptionCommand - see README "Wire format"). Response isn't read by the
 * client at all (`Command.a` returns null unconditionally), so any ack is
 * enough.
 */
async function handleMarkOption(args, session) {
  return [];
}

/**
 * CID 60 - drug.vokrug.system.command.PaidServicesCommand. Fires
 * automatically post-login. No request args. Response: [Object[] of
 * String[5] paid-service descriptors] - each fed to
 * `Billing.a(Object[])`, which iterates and casts every element to
 * `String[]`. An empty array is safe: the loop just runs zero times and
 * `Billing` falls back to its own local payment-service setup (Google
 * Play / SMS) with nothing server-provided - genuinely correct for a
 * server with no billing/payments backend, not merely a placeholder.
 * `LongArr([])` round-trips to an empty array structurally identical to an
 * empty `String[]` on the client (a zero-length array's element type
 * doesn't matter once it's cast via `(Object[])`), so no new wire wrapper
 * was needed for this.
 */
async function handlePaidServices(args, session) {
  return [new LongArr([])];
}

/**
 * CID 111 - drug.vokrug.system.command.NotificationListCommand. Fires
 * automatically post-login. Request: [Long chunkSize, Long? offset] - two
 * SEPARATE top-level items here (each added via its own `super.a(...)`
 * call), unlike most of the other list commands in this file. Response:
 * [Boolean[2], SeqArr(notifications)] - the standard ListCommand-style
 * pagination shape (objArr[1] is both the "continue" length-check target
 * and the items array). Notification's own wire shape isn't traced, so
 * this is an empty-but-valid stub.
 */
async function handleNotificationList(args, session) {
  return [new BoolArr([true, false]), new SeqArr([])];
}

/**
 * CID 104 - drug.vokrug.system.command.FamiliarListCommand ("people you
 * might know" - friends-of-friends). Fires automatically post-login.
 * Request: [LongArr[chunkSize, offset]] - a single wrapped Long[2].
 * Response: [Boolean, Long, SeqArr(items)] - a 3-element response using the
 * `Boolean + Long` pagination shape (see README "Wire format"), *not* the
 * Boolean[2] shape - the real items array is objArr[2] here, not objArr[1],
 * which is why the length-check needs to compare against a Long rather
 * than use objArr[1]'s own array length. Each item would be
 * Seq([userInfo, Boolean]) but is left empty (undocumented "familiar"
 * matching logic, not traced).
 */
async function handleFamiliarList(args, session) {
  return [true, 0n, new SeqArr([])];
}

/**
 * CID 23 - drug.vokrug.system.command.EventListCommand. Fires
 * automatically post-login. Request: [Long chunkSize, Long? offset] - two
 * separate top-level items (each its own `super.a(...)` call). Response:
 * [Boolean[2], SeqArr(events)] - standard ListCommand-style pagination
 * shape. Event's own wire shape isn't traced, so this is an
 * empty-but-valid stub.
 */
async function handleEventList(args, session) {
  return [new BoolArr([true, false]), new SeqArr([])];
}

/**
 * CID 4 - drug.vokrug.system.command.BtFindCommand. The client fires this
 * repeatedly (once per nearby-device sighting) while its own Bluetooth
 * radio is scanning, asking the server "do you recognize this device?".
 * Request: [StrArr[macOrHash, name, extra]] - a single wrapped String[3].
 * Response: [Seq(deviceInfo)] where `deviceInfo` is itself
 *   Seq([StrArr[...names], LongArr[flags, flags, rssiOrId], Long|Seq(userInfo)])
 * - the third element is polymorphic: a bare Long (a generic type/signal
 * code) or a full userInfo Seq if the device is matched to a known user.
 * `BtFindCommand.a(...)` is always called with its "trust the client's own
 * timestamp" flag hardcoded `true`, so a 4th Long (timestamp) is never
 * actually read despite `LongArr` needing at least 3 elements. This server
 * doesn't do real Bluetooth device correlation (no proximity data to
 * offer), so this always answers "unrecognized device" (Long 0) rather
 * than a matched profile - safe, not a guess: BTDeviceInfo's precise field
 * semantics beyond this branch weren't traced further.
 */
async function handleBtFind(args, session) {
  return [new Seq([new StrArr(['']), new LongArr([0, 0, 0]), 0n])];
}

/**
 * CID 80 - drug.vokrug.system.command.SendSettingToServerCommand. A
 * fire-and-forget push FROM the client (e.g. a GCM push-registration id -
 * see GetSettingsCommand's case 42). Request: [Long settingId, String
 * value] - two separate top-level items, not a wrapped array this time.
 * Response isn't read by the client at all, so any ack is enough.
 */
async function handleSendSettingToServer(args, session) {
  return [];
}

module.exports = {
  handleCanWriteLiveChat,
  handleCanChangePhoto,
  handleMarkOption,
  handlePaidServices,
  handleNotificationList,
  handleFamiliarList,
  handleEventList,
  handleBtFind,
  handleSendSettingToServer,
};
