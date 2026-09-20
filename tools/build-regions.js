'use strict';
/**
 * One-off generator for src/regions-data.js.
 *
 * Source data: the APK's OWN bundled files
 * res/raw/l10n_android__regionsgzip_{ru,en} (plain "key=value" text despite
 * the "gzip" in the filename) - i.e. this is the app's real, authentic
 * region/country hierarchy and translations, not invented data. Field
 * layout (PREFIX/PAY_CODE/PHONE_LENGTH/TYPE/HAS_CHILDREN/HAS_WALL/ISO) is
 * taken directly from drug.vokrug.system.db.RegionsDB.java's own column
 * names, which map 1:1 to RegionInfo's ICollection wire constructor - see
 * README.md "RegionCommand real data" for the full derivation.
 *
 * Usage: node tools/build-regions.js <ru-file> <en-file> > src/regions-data.js
 * Re-run only if extracting from a different APK version.
 */
const fs = require('fs');

const ruPath = process.argv[2];
const enPath = process.argv[3];
const callingCodes = require('/tmp/calling-codes.json');
const cisOverrides = require('/tmp/cis-overrides.json');

function parse(path) {
  const map = new Map();
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^region\.([^=]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

const ru = parse(ruPath);
const en = parse(enPath);

const CONTINENTS = new Set(['1000', '1001', '1002', '1003', '1004']);
const CIS_NUMERIC_COUNTRIES = new Set(Object.keys(cisOverrides));

const countries = [];
const russianRegions = [];
for (const [code, nameRu] of ru.entries()) {
  if (CONTINENTS.has(code)) continue;
  const nameEn = en.get(code) || nameRu;
  const isNumeric = /^\d+$/.test(code);
  if (isNumeric && !CIS_NUMERIC_COUNTRIES.has(code)) {
    russianRegions.push({ code, nameRu, nameEn });
  } else if (isNumeric) {
    const o = cisOverrides[code];
    countries.push({ code, nameRu, nameEn, prefix: o.prefix, iso: o.iso });
  } else {
    countries.push({ code, nameRu, nameEn, prefix: callingCodes[code] ?? '', iso: code });
  }
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

let out = `'use strict';

/**
 * Region/country hierarchy, extracted from the APK's own
 * res/raw/l10n_android__regionsgzip_{ru,en} files - see
 * tools/build-regions.js for how this was generated and README.md
 * "RegionCommand real data" for the wire-field derivation
 * (drug.vokrug.system.db.RegionsDB.java's column names).
 *
 * Two levels: COUNTRY (ISO 3166-1 codes, or a calling-code-as-id for
 * ex-USSR/CIS countries - exactly as the app itself does it) at the root,
 * and REGION (Russian federal subjects) as children of Russia (code "0").
 * PHONE_LENGTH is deliberately always 0 - RegionInfo's own display logic
 * treats 0 as "unset" and falls back to a generous 14-digit cap
 * (AnonymousActivity.java), which is safer than fabricating precise
 * national number lengths for ${countries.length} countries without a way
 * to verify them.
 */

const COUNTRIES = [
`;
for (const c of countries) {
  out += `  { code: '${esc(c.code)}', iso: '${esc(c.iso)}', prefix: '${esc(c.prefix)}', nameRu: '${esc(c.nameRu)}', nameEn: '${esc(c.nameEn)}' },\n`;
}
out += `];

// Russian federal subjects (oblasts/republics/krais), children of Russia
// (code "0"). No calling-code prefix of their own - the country-level
// entry (Russia) is what the client's phone-prefix logic reads from.
const RUSSIAN_REGIONS = [
`;
for (const r of russianRegions) {
  out += `  { code: '${esc(r.code)}', nameRu: '${esc(r.nameRu)}', nameEn: '${esc(r.nameEn)}' },\n`;
}
out += `];

module.exports = { COUNTRIES, RUSSIAN_REGIONS };
`;

fs.writeFileSync(process.argv[4], out);
console.error(`wrote ${countries.length} countries + ${russianRegions.length} Russian regions to ${process.argv[4]}`);
