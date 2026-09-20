'use strict';

const { SeqArr } = require('../wire');

/**
 * CID 27 - drug.vokrug.system.command.LiveListCommand. Real implementation
 * has moved to commands/live.js (the "эфир"/wall feed is now backed by
 * SQLite, see that file for the full request/response derivation).
 */

/**
 * CID 14 - drug.vokrug.system.command.SearchCommand, extends the generic
 * ListCommand(cid, limit, offset) base, same response shape as
 * FriendsListCommand/GuestListCommand: [?, SeqArr(userInfo...)]. The
 * request carries an 11-field SearchParams struct (age/sex/city/etc,
 * see SearchCommand.java) that isn't parsed here yet - every search just
 * returns an empty result set for now.
 */
async function handleSearch(args, session) {
  return [0n, new SeqArr([])];
}

module.exports = { handleSearch };
