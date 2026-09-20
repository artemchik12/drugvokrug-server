'use strict';

const { LongArr, StrArr, BoolArr, SeqArr } = require('../wire');
const { COUNTRIES, RUSSIAN_REGIONS } = require('../regions-data');

/**
 * CID 115 - drug.vokrug.system.command.RegionCommand.
 *
 * Fires automatically the instant the client reaches the "connected" state
 * (RegionStorage's IStateListener calls `RegionCommand.a(this.c).e()`),
 * *before* any login attempt. It's how the client fetches the country/
 * region tree used by the registration screen's country picker and the
 * "live" wall feed's region picker (RegionActivity, RegionSelection.COUNTRY
 * / RegionSelection.WALL).
 *
 * Request: [LongArr[chunkSize, offset, knownVersion], String? parentCode]
 *
 * Response shape (see RegionCommand.a(Object[]) and README.md "RegionCommand
 * real data" for the full derivation, including the NullPointerException
 * trap if you answer this the "obvious" naive way):
 *   [BoolArr[true, false], SeqArr(regionItems), Long dataVersion]
 * `dataVersion` MUST differ from the client's `knownVersion` for any of
 * regionItems to actually get processed and saved - if they're equal the
 * client takes an early "already up to date" return and does nothing at
 * all. REGION_DATA_VERSION is a fixed constant bumped only when this
 * server's hardcoded dataset changes, so a client that already has it
 * cached correctly gets the (correct, cheap) "nothing changed" response on
 * every subsequent connect.
 *
 * Each region item is a Seq matching RegionInfo's ICollection constructor,
 * whose 8 fields were resolved with certainty from
 * drug.vokrug.system.db.RegionsDB.java's own SQLite column names (CODE,
 * PREFIX, PAY_CODE, PHONE_LENGTH, TYPE, HAS_CHILDREN, HAS_WALL, ISO):
 *   Seq([
 *     StrArr[CODE, PREFIX, PAY_CODE, ISO],
 *     LongArr[PHONE_LENGTH, TYPE],
 *     BoolArr[HAS_CHILDREN, HAS_WALL],
 *     StrArr[...parentCodes] | null   // empty/null = top-level
 *   ])
 *
 * Crucially, display NAMES are never sent over the wire at all - the client
 * resolves them locally via L10n.b("region."+CODE) from its own bundled
 * translation assets (res/raw/l10n_android__regionsgzip_{ru,en}), which is
 * also where every code/prefix/iso value below was extracted from (see
 * tools/build-regions.js) - so anything transmitted here is guaranteed to
 * already have a matching, correctly-translated label on the client.
 *
 * Two levels are modeled: COUNTRY (top-level, 232 entries - every country
 * the app ships translations for, using ISO 3166-1 codes or, for ex-USSR/
 * CIS countries, the same calling-code-as-id scheme the app itself uses)
 * and REGION (81 Russian federal subjects, parented under Russia's code
 * "0"). PHONE_LENGTH is always sent as 0 (client falls back to a 14-digit
 * cap) and HAS_CHILDREN is always false since everything is sent flat in
 * one response - no follow-up child-fetch round-trips are needed or
 * triggered.
 */

const REGION_DATA_VERSION = 1n;

function countryItem(c) {
  return [new StrArr([c.code, c.prefix, '', c.iso]), new LongArr([0, 2]), new BoolArr([false, true]), null];
}

function regionItem(r) {
  return [new StrArr([r.code, '', '', 'RU']), new LongArr([0, 3]), new BoolArr([false, true]), new StrArr(['0'])];
}

// Built once at module load - the dataset is static.
const ALL_ITEMS = [...COUNTRIES.map(countryItem), ...RUSSIAN_REGIONS.map(regionItem)];

async function handleRegion(args, session) {
  const params = args[0];
  const knownVersion = params && params.kind === 'long[]' && params.items.length >= 3 ? params.items[2] : 0n;

  if (knownVersion === REGION_DATA_VERSION) {
    // Client already has this exact dataset cached - the safe, cheap
    // "nothing changed" path (see the class doc comment above).
    return [false, null, REGION_DATA_VERSION];
  }

  session.server.log(
    'region-data',
    session.remoteAddr,
    `sending ${ALL_ITEMS.length} regions (${COUNTRIES.length} countries + ${RUSSIAN_REGIONS.length} RU regions)`
  );
  return [new BoolArr([true, false]), new SeqArr(ALL_ITEMS), REGION_DATA_VERSION];
}

module.exports = { handleRegion, REGION_DATA_VERSION };
