'use strict';

const { LongArr, StrArr, SeqArr } = require('../wire');

/**
 * These six all fire automatically right after a successful login
 * (drug.vokrug.system.LoginService, the `static /* synthetic *\/ void a(...)`
 * block). None of them are core features by themselves, but leaving any of
 * them completely unanswered means the client sits on a pending
 * DeliveryRecord until `command.timeout` (60s default) - so even a minimal,
 * "nothing here yet" response is worth sending immediately. Each one below
 * is checked against its handler in the decompiled source to make sure an
 * empty/negative answer is actually a safe branch, not just a guess.
 */

// CID 81 - GetSettingsCommand. This one is not merely cosmetic: LoginService
// keeps a checklist (`this.b = [81L]`) of pending post-login commands and
// only fires the *real* "login succeeded" signal (`this.c.e_()`, which is
// what Launcher.java uses to transition into MainActivity - see README
// "GetSettingsCommand is part of the login gate, not just cosmetics") once
// this command's OnParseFinished success callback runs. Leaving it
// unanswered doesn't crash anything by itself, but it does mean that
// signal - and the rest of the post-login bootstrap (Rating/BtMeetings/
// UserProfile/Stickers/PresentCategory, all below) - never fires on time.
// Request: [Long[] settingIds, String[] settingValues] (parallel arrays).
// Response: same shape; the handler loops `for i in 0..lArr.length` matching
// each id to its value, so empty arrays are a complete, safe no-op.
async function handleGetSettings(args, session) {
  return [new LongArr([]), new StrArr([])];
}

// CID 107 - GetOptionCommand. Request: args[0] = mixed[] wrapping one
// Long[] of option ids (`new Object[]{lArr}` - see README "Wire format").
// Response: objArr[0] = ICollection[] of Seq([LongArr(optionIds), Boolean]);
// the handler just loops over it, so an empty array is a complete no-op.
async function handleGetOption(args, session) {
  return [new SeqArr([])];
}

// CID 26 - RatingCommand, no request args. Response objArr[0]=Boolean; when
// false, nothing else is read at all - the cleanly-empty answer.
async function handleRating(args, session) {
  return [false];
}

// CID 36 - LastBtMeetingsCommand (Bluetooth "people nearby" meetings - not
// emulated). Response: only objArr[1] (ICollection[]) is read, looped over;
// objArr[0] is unused by this handler.
async function handleLastBtMeetings(args, session) {
  return [0n, new SeqArr([])];
}

// CID 126 - StickersCategoriesCommand. Response: only objArr[1]
// (ICollection[] of sticker categories) is read.
async function handleStickersCategories(args, session) {
  return [0n, new SeqArr([])];
}

// CID 40 - PresentCategoryListCommand. Response: only objArr[1] (Long[] of
// category ids) is read; an empty list means no follow-up
// PresentOfCategoryCommand calls get fired.
async function handlePresentCategoryList(args, session) {
  return [0n, new LongArr([])];
}

module.exports = {
  handleGetSettings,
  handleGetOption,
  handleRating,
  handleLastBtMeetings,
  handleStickersCategories,
  handlePresentCategoryList,
};
