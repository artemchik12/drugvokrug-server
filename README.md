# ДругВокруг (drugvokrug.ru) private server emulator

Reverse-engineered from `2-3-1.apk` (versionCode 32, versionName 2.3.1,
`AppProfile.g = {2,3,1}` in `drug.vokrug.AppProfile`). Everything below was
traced from the decompiled client sources (jadx output), not guessed.

## Protocol summary

The app uses **RubyLight** (`com.rubylight.net.*`), the same protocol family
as MRIM/Mail.ru Agent (see the earlier MRIM web client work) - a custom
binary command/response protocol over a raw TCP socket, no TLS.

- **Server:** `sap.drugvokrug.ru:9080` (`drug.vokrug.AppProfile.h`)
- **Framing:** `[u16 big-endian length][payload]`, max payload 65535 bytes
  (`com.rubylight.net.transport.impl.DefaultTransport.b`). No magic number,
  no checksum.
- **Serialization:** a custom bit-packed TLV format, in the client's own
  package called "ASN1PER" but it isn't real ASN.1 PER. Full spec below.
- **Encryption:** negotiated per-session at handshake time: Blank (none),
  XOR, or RC4 (`com.rubylight.net.encryption.impl.*`). RC4 is the standard
  KSA/PRGA algorithm - verified byte-for-byte against the RFC 6229 test
  vector during development.

### Handshake

Client connects and immediately sends 15 raw, **unencrypted** bytes
(`com.rubylight.net.client.impl.HandshakeState`):

| Offset | Size | Value |
|---|---|---|
| 0  | u16 | `1` (fixed) |
| 2  | u16 | `2` (fixed) |
| 4  | u16 | `5` (fixed) |
| 6  | u16 | `20` (fixed) |
| 8  | u8  | app version major (2) |
| 9  | u8  | app version minor (3) |
| 10 | u8  | app version patch (1) |
| 11 | u32 | resume token (0 on fresh install) |

The four fixed u16 fields' exact semantics weren't traced further (they're
written once and never branched on client-side) - the server logs them but
doesn't validate them.

Server replies, also raw/unencrypted (chicken-and-egg: the cipher this
message announces can't protect itself), with a **top-level wire-encoded
array** of 4 items:

```
[Long sessionId, byte[] resourceAddrs, Long cipherType, byte[] cipherKey]
```

`resourceAddrs` is zero or more 6-byte chunks (4-byte IPv4 + u16 port) for a
secondary "resource" connection the client may open for avatar/file
transfer. An empty array is fine - the client just skips opening it
(`ResourceConnector.h()` checks `length > 0` first).

From this point on **both directions** use `cipherType`/`cipherKey` for
every framed packet.

### Command/response layer

Every packet payload (once decrypted) decodes to a flat top-level array:

```
[Long cid, Long seq, ...args]
```

- `cid == 0` marks a **service** message (see below); otherwise `cid` is an
  application command id (`drug.vokrug.system.command.CommandCodes` doesn't
  actually list them - see `Command IDs` below, traced per-class).
- To answer a command, echo back `[cid, seq, ...responseArgs]` - the client
  matches purely on `seq` (see `DefaultClient.Connector`'s delivery-record
  map, keyed by seq only).
- `seq == null` on an inbound packet means "no response expected" (push-style).

**Service messages** (`cid == 0`, `args[0]` = subtype):

| Subtype | Direction | Meaning |
|---|---|---|
| 0 | either | keepalive ping/ack. Client sends `[0, seq, 0, timestamp]` every ~30s (`connection.timeout` config) and expects `[0, seq, 0, ...]` back or it tears down the connection. |
| 1 | server→client | "redirect to this primary address instead" |
| 2 | server→client | config/token sync (key-value pairs) |
| 3 | server→client | rekey (new cipher type + key mid-session) |
| 5 | server→client | system message string shown to the user |
| 7 | server→client | notification (title, message, id) |
| 8 | server→client | notification (id only) |
| 23 | server→client | abort (`ServerAbortException`, client disconnects) |
| 238/255 | server→client | generic error/ack wrappers for pending seq'd commands |

Only subtype 0 (keepalive) is implemented server-side so far - it's the only
one the client actually depends on for the connection to stay alive.

### Command IDs traced so far

From `drug.vokrug.system.CommandQueue` (`a`/`b` priority lists) and each
command class's `super(N)` call:

| CID | Class | Status |
|---|---|---|
| 2 | `LoginCommand` | **implemented**, SQLite-persisted |
| 3 | `LogoutCommand` | **implemented** |
| 13 | `ReloginCommand` | **implemented**, SQLite-persisted |
| 1 | `RegistrationCommand` | **implemented**, SQLite-persisted (real phone-based flow, see below) |
| 38 | `PasswordRecoveryCommand` | **implemented**, SQLite-persisted |
| 8 | `MessageSendCommand` | **implemented**, SQLite-persisted |
| 10 | `Last(In\|Out)comingMessagesCommand` (shared CID, see below) | **implemented**, SQLite-persisted |
| 12 | `MessagesHistoryCommand` | **implemented**, SQLite-persisted |
| 14 | `SearchCommand` | **implemented** (empty stub - request params not parsed yet) |
| 15 | `AddToFriendsCommand` | **implemented**, SQLite-persisted |
| 17 | `FriendsListCommand` | **implemented**, SQLite-persisted |
| 4 | `BtFindCommand` | **implemented** (always answers "unrecognized device" - no real Bluetooth correlation data) |
| 23 | `EventListCommand` | **implemented** (empty stub - Event's wire shape not traced) |
| 26 | `RatingCommand` | **implemented** (empty stub) |
| 27 | `LiveListCommand` | **implemented**, SQLite-persisted - real "эфир"/wall feed, see below |
| 31 | `UserProfileCommand` | **implemented**, SQLite-backed - real fields, see below |
| 33 | `MessageWorkCommand` | **implemented**, marks message read in SQLite |
| 36 | `LastBtMeetingsCommand` | **implemented** (empty stub) |
| 40 | `PresentCategoryListCommand` | **implemented** (empty stub) |
| 32 | `SendUserInfoCommand` | **implemented**, SQLite-persisted - profile editing, see below |
| 51 | `UserSmallInfoCommand` | **implemented**, SQLite-backed |
| 55 | `SendMessageToLiveChatCommand` | **implemented**, SQLite-persisted - posting to the "эфир", see below |
| 60 | `PaidServicesCommand` | **implemented** (empty catalog - genuinely correct for a server with no billing backend, see below) |
| 72 | `CanWriteLiveChatCommand` | **implemented**, real answer (`0` = not banned) |
| 73 | `CanChangePhotoCommand` | **implemented**, real answer (`true` = unrestricted) |
| 77 | `GuestListCommand` | **implemented** (empty stub - profile-visit tracking not implemented) |
| 80 | `SendSettingToServerCommand` | **implemented** (no-op ack - fire-and-forget client push, e.g. GCM id) |
| 81 | `GetSettingsCommand` | **implemented** (empty stub - see below, this one gates login completion) |
| 104 | `FamiliarListCommand` | **implemented** (empty stub - "people you may know" matching not traced) |
| 107 | `GetOptionCommand` | **implemented** (empty stub) |
| 108 | `MarkOptionCommand` | **implemented** (no-op ack) |
| 111 | `NotificationListCommand` | **implemented** (empty stub - Notification's wire shape not traced) |
| 115 | `RegionCommand` | **implemented**, real data - 232 countries + 81 Russian regions, see below |
| 126 | `StickersCategoriesCommand` | **implemented** (empty stub) |
| 136 | `OnlineStatusCommand` | **implemented**, SQLite-backed + live session tracking |
| everything else in `drug/vokrug/system/command/*.java` (~31 more classes - presents, avatars, notes, stickers content, complaints, ...) | not yet traced | not implemented |

Unimplemented commands are simply logged and get no response - the client's
`Command.a` will eventually time out (`command.timeout`, default 60s)
without crashing, so it's safe to bring features up incrementally.

### Newly implemented commands - details and known gaps

- **`FriendsListCommand`/`GuestListCommand`/`SearchCommand`** all return
  lists as `SeqArr` (array-of-`Seq`, i.e. `ICollection[]`) - a wire shape
  that needed its own encoder (`wire.js`'s `encodeSeqArr`), since the
  earlier login-only work only needed to *decode* it. Verified with
  dedicated round-trip tests, including the doubly-nested case (a `SeqArr`
  whose elements themselves contain a nested `Seq`), before wiring it into
  any command.
- **`FriendsListCommand`** is real (backed by `store.js`'s friend graph),
  not a stub - `AddToFriendsCommand` populates it. Pagination is
  short-circuited (see the `Boolean+Long` shape in `Command.a(Command,
  Object[], Long)` - we always signal "no more pages").
- **`OnlineStatusCommand`** is real, backed by `server.onlineUsers`
  (populated on login/relogin, cleared on logout/disconnect). The client
  hard-crashes (`CrashCollector` + `IllegalStateException`) if the response
  array length doesn't exactly match the request - the handler is careful
  to always return one entry per requested id, online-status `false` for
  unknown ids rather than omitting them.
- **`UserProfileCommand`/`SendUserInfoCommand`** are now real and fully
  traced, backed by SQLite - see "UserProfileCommand real fields" below for
  the field-by-field derivation (via `MyProfileDataFragment.java`'s L10n
  keys) and the correction of an earlier wrong guess about field `Q()`.
- **`MessageSendCommand`/`MessagesHistoryCommand`/`Last(In|Out)comingMessagesCommand`**
  are now real, persisted to SQLite (`store.js` + `message.js`) - a sent
  message is immediately visible in both the sender's outgoing history and
  the recipient's incoming history, with the exact body text (verified with
  Cyrillic + emoji in `test/run.js`). See "Message wire format" below for
  the field layout this was traced from, and note the `MessageSendCommand`
  request is `[Long recipientUserId, String text]`, not two Longs as an
  earlier, less careful read of the decompiled source suggested.
- **`LiveListCommand`/`SendMessageToLiveChatCommand`** are now real and
  fully traced too - see "The live feed" below for the `LiveChatItem` field
  layout and the reversed wire-order gotcha in the send command.
- **`RegionCommand`** (CID 115) - see "RegionCommand real data" below for
  the full writeup; briefly, it now returns the app's own real, complete
  country/region hierarchy instead of an empty stub.

### A wire-shape bug worth remembering

`Command.a(SomeArray)` (whichever overload - `Integer[]`, `String[]`,
`Long[]` passed as a plain `Object`) always adds the **whole array as one
wire item**, never spreads its elements across separate top-level
arguments. This sounds obvious written down, but it's easy to misread from
the decompiled source at a glance - `super.a((Object) new Long[]{l, l2})`
and two separate `super.a(l); super.a(l2);` calls look superficially
similar but produce different wire shapes, and only one of them is what a
given command actually sends.

This server got it wrong for `MessagesHistoryCommand` (CID 12),
`Last(In|Out)comingMessagesCommand` (CID 10), and `MessageWorkCommand`
(CID 33) - all three were reading `args[0]`/`args[1]`/`args[2]` as if the
request were three flat top-level Longs, when it's actually a *single*
wrapped `LongArr` (plus, for CID 10, a separate trailing Boolean). The
practical damage: for CID 10, `Number(args[0])` on a decoded `LongArr`
*object* (not a bigint) silently produced `NaN`, which then hit SQLite as
an invalid bind parameter and crashed with `Error: datatype mismatch` -
this is exactly the kind of thing worth grep-ing for across every command
that shares the pattern rather than just patching the one that happened to
get exercised first (`grep -l "new Long\[\]{" decompiled/sources/.../
command/*.java` is what found the other two, plus confirmed several
already-correct ones - `RegionCommand`, `OnlineStatusCommand`,
`UserSmallInfoCommand` - weren't affected).

### RegionCommand real data

`RegionCommand` fires the instant the client reaches the "connected" state
- *before* any login attempt, via `RegionStorage`'s connection-state
listener. It's how the country/region tree behind the registration screen's
country picker (`RegionActivity`, `RegionSelection.COUNTRY`) and the "live"
wall feed's region picker (`RegionSelection.WALL`) gets populated.

**The response format is a NullPointerException trap if answered naively**:
`RegionCommand.a(Object[])` only sets its internal version field (`this.h`)
inside the branch that reads a 3rd response element, but the "finalize and
save" path (`RegionStorage.a(this.h.longValue(), ...)`) runs regardless -
so a 2-element response (or a 3-element one where the version happens to
equal what the client already had cached) skips setting `this.h` and then
crashes dereferencing it. The correct response is always 3 elements:
`[BoolArr[true, false], SeqArr(regionItems) | null, Long dataVersion]`,
where `dataVersion` must differ from the client's own `knownVersion` for
anything to actually be processed and saved.

**The region/country data itself turned out not to need any guessing.** The
APK ships its own complete hierarchy as plain text in
`res/raw/l10n_android__regionsgzip_{ru,en}` (despite the "gzip" in the
filename, it's a plain `region.<code>=<name>` properties file) - display
names are *never sent over the wire at all*; the client resolves them
locally via `L10n.b("region."+CODE)`. That also means: any code we send is
guaranteed to already have a correct, translated label on the client, and
`tools/build-regions.js` extracts the server's real dataset (`src/regions-
data.js`, 232 countries + 81 Russian federal subjects) directly from those
files rather than inventing one. `RegionInfo`'s 8 wire fields were resolved
with certainty (not guessed) from `drug.vokrug.system.db.RegionsDB.java`'s
own SQLite column names, which map 1:1 to the ICollection constructor:

```
Seq([
  StrArr[CODE, PREFIX, PAY_CODE, ISO],
  LongArr[PHONE_LENGTH, TYPE],        // TYPE: 2=COUNTRY, 3=REGION
  BoolArr[HAS_CHILDREN, HAS_WALL],
  StrArr[...parentCodes] | null       // null/empty = top-level
])
```

Two levels are modeled: **COUNTRY** (top-level, every country the app has a
translation for - ISO 3166-1 codes, or, for ex-USSR/CIS countries, the same
calling-code-as-id scheme the app itself uses: Russia is `"0"`, Kazakhstan
is `"77"`, Azerbaijan is `"994"`, etc.) and **REGION** (81 Russian federal
subjects/oblasts/republics, parented under Russia's code `"0"` - real
region numbers, e.g. Sverdlovsk Oblast is `"66"`). `PREFIX` (the phone
calling-code string used for the "+7 " input hint) is correct for every
country; `PAY_CODE` is left empty (no billing system here) and
`PHONE_LENGTH` is always `0`, which the client's own display logic treats
as "unset" and falls back to a generous 14-digit cap - safer than
fabricating precise national number lengths for 232 countries. Everything
is sent flat in a single ~7 KB response (well under the 65535-byte packet
limit, no pagination needed), so `HAS_CHILDREN` is always `false` - no
follow-up child-fetch round-trips are triggered or needed.

### The live feed ("эфир"), fully real

`LiveListCommand` (CID 27) and `SendMessageToLiveChatCommand` (CID 55) are
backed by a real `wall_posts` SQLite table now, scoped by the region code
the client requests it for (the same codes `RegionCommand` hands out - see
above). Traced from `drug.vokrug.objects.system.LiveChatItem`'s
`ICollection` constructor:

```
Seq([userInfo, String text, LongArr[timestamp, itemId]])
```

`SendMessageToLiveChatCommand` extends `PaymentCommand`, not `Command`
directly - its response is `[Long resultCode, Long? balance]` where `0`
means success. This server has no billing backend, so posting is always
free and always succeeds; the request itself is worth flagging because the
wire order is `[regionCode, text]`, the *reverse* of the constructor's own
`(text, regionCode, payment)` parameter order - confirmed via the actual
call site in `SpecificWallFragment.java`, not assumed from the constructor
alone (see the pattern this generalizes in "A wire-shape bug worth
remembering" - reading `super.a(new String[]{str2, str})` and assuming it
matches the constructor's `(str, str2, ...)` order the way it's *written*
would have gotten this backwards).

### UserProfileCommand real fields, and SendUserInfoCommand (profile editing)

Both are now real, backed by five new `users` columns (`first_name`,
`surname`, `about`, `interests`, `last_seen`) alongside the existing
`name` (which turns out to be what the client itself calls "nick").

Every field in `UserProfileCommand`'s response and `SendUserInfoCommand`'s
request was resolved with certainty, not guessed - by first matching each
command's setter/getter calls (`UserProfileCommand.a(Object[])` against
`UserInfo.java`'s getter names), then cross-referencing those getters
against `drug.vokrug.activity.profile.MyProfileDataFragment.java`'s
`DataType` enum, where every field is tied to an L10n key
(`profile_nick`, `profile_name`, `profile_about`, `profile_register`, ...).
That second step mattered: an earlier pass at `UserProfileCommand` had
guessed field `Q()` (`UserInfo.K()`'s backing field) was something like "a
boost-until timestamp" from its position alone: the `DataType.REGISTER`
entry shows it's actually the **registration date**.

`SendUserInfoCommand` (CID 32) - the profile-edit screen's "save" - always
pushes the *entire* editable profile, not a diff:

```
Request:  [LongArr[birthYear, birthMonth, birthDay, genderInt],
           StrArr[nick, firstName, surname, city, "", "", about, interests],
           Boolean isMale]
Response: [Boolean success]
```

(indices 4-5 of the string array are hardcoded empty strings client-side -
not user-editable through this particular save path). `UserProfileCommand`
(CID 31) response:

```
[userInfo, StrArr[about, "", "", interests], LongArr[registeredAt, lastSeen],
 LongArr[meetingsCount, 0, 0, relationsCode], Boolean isOnline]
```

`meetingsCount`/`relationsCode` are sent as `0` (no Bluetooth-meetings or
relationship-status tracking here); `isOnline` and `lastSeen` are both
real, backed by the same session-tracking `OnlineStatusCommand` already
used, plus a `last_seen` column touched whenever a session disconnects.

### GetSettingsCommand is part of the login gate, not just cosmetics

CID 81 looks like just another cosmetic post-login command (bluetooth
range, sound volume, push token, misc toggles), but `LoginService.java`
actually keeps a checklist of pending post-login commands -
`this.b = new ArrayList(); this.b.add(81L);` - and only fires the *real*
"login succeeded" signal (`this.c.e_()`) once `GetSettingsCommand`'s success
callback clears that checklist. `Launcher.java`'s `e_()` is what transitions
into `MainActivity` with `SUCCESS_ENTER_EXTRA` set, and it's also what
triggers the rest of the post-login bootstrap (`RatingCommand`,
`LastBtMeetingsCommand`, `UserProfileCommand`, `StickersCategoriesCommand`,
`PresentCategoryListCommand` - all already implemented). Leaving CID 81
unanswered doesn't crash anything by itself (the client just never gets
that specific signal on time), but it's a real correctness gap now fixed
with the same "empty response is a safe no-op" pattern as the others -
`GetSettingsCommand.a(Object[])` loops over parallel `Long[]`/`String[]`
arrays with a for loop bounded by array length, so empty arrays are a
complete no-op.

### Known client-side crash on a fresh install - not a server bug

If you connect a device/emulator with **no previously saved login**
(fresh install, or app data cleared) you'll likely see the app crash
almost immediately after connecting, before ever reaching a login screen:

```
java.lang.NullPointerException: Attempt to invoke virtual method
'...CurrentUserInfo.k()' on a null object reference
	at ConversationsAdapter.<init>(ConversationsAdapter.java:59)
	at ConversationsFragment.onCreate(ConversationsFragment.java:69)
```

This is a genuine race condition **in the original app itself**, not
something this server causes or can fix - it would happen against the real
drugvokrug.ru server too, under the same fresh-install conditions. Traced
through `Launcher.java`, `MainActivity.java`, and `UserInfoStorage.java`:

1. `Launcher.a()` (the `IClientCore.ConnectionListener` callback, fired once
   the handshake completes) calls `h()`, which checks `AuthDB.a()` for a
   saved login/password. On a fresh install there's nothing saved, so `h()`
   returns `false` **synchronously, without attempting any login at all**.
2. `if (ClientCore.e().s() || !h())` is therefore `true`, so `Launcher`
   calls `g()` immediately - `startActivityForResult(MainActivity...)` -
   with no login or relogin ever having been attempted.
3. `MainActivity.onCreate` unconditionally builds its full tab UI
   (`this.a.setCurrentTab(0)`, which constructs the first tab's fragment -
   `ConversationsFragment` in this case) **before** it checks
   `if (!iClientCoreE.s() && !iClientCoreE.k())` to decide whether to
   redirect to `GreetingActivity` (the login/registration screen). That
   redirect check comes too late - `ConversationsAdapter`'s constructor
   already ran `UserInfoStorage.b().k()`, and `UserInfoStorage.b()` (the
   `CurrentUserInfo` singleton, only ever populated by
   `UserInfoFactory.b()` inside a successful `LoginCommand`/`ReloginCommand`
   response - see "Login (CID 2)" above) is still `null`, since no login
   was ever attempted in step 1.

The app's own crash handler (`DVApplication`'s `ExceptionHandler`) catches
this, shows an "Упс, произошла ошибка :-/" toast, and restarts the process
straight into `GreetingActivity` - which is exactly what the log shows
happening a moment later (`Start proc ...: drug.vokrug/.activity.GreetingActivity`).
So in practice this is a one-time crash-and-recover on the very first
launch; from `GreetingActivity` onward (register or log in) everything
proceeds normally. If it's disruptive for testing, saving *any* login in
`AuthDB` first (e.g. registering once) avoids it on subsequent launches,
since `h()` then takes the async login path instead of racing ahead.

### Registration and password recovery - real, not a shortcut

**By default, `LoginCommand` only accepts accounts created through
`RegistrationCommand` (see "Login (CID 2)" above for the enforcement
details) - it is *not* a username/password signup form.** The actual
registration flow, traced from `RegistrationActivity.java`, is phone-number based: the server generates a
password and sends it by SMS; the client never learns it directly. After a
successful `RegistrationCommand`, the client stores the phone number as the
login with an *empty* password (`AuthDB.a(phone, "", ...)`) and expects the
user to read the SMS and type the password in on the next login screen.

**`RegistrationCommand` (CID 1)** - the `Command` subclass's own
`a(Object[])` always returns `null`; the response is only handled by the
`ICommandListener` registered at the call site in `RegistrationActivity`,
which is where these fields were traced from:

```
Request:  [StrArr[phone, nick, city, language, country],
           LongArr[birthYear, birthMonth(0-indexed), birthDay],
           Boolean isMale]
Response: [Long code]
   0        -> success ("password_sended_to_you")
   2 or 3   -> "user with this phone number already exists"
   anything else (1, or omitted) -> "registration_wrong_phone"
```

**`PasswordRecoveryCommand` (CID 38)**, traced the same way from
`PasswordRecoveryActivity.java`:

```
Request:  [String phone]
Response: [Long code]
   1 -> success ("sms_will_be_sended") - a new password was generated
   2 -> too many tries today (rate limiting - not implemented server-side)
   3 -> "such_number_is_not_registrated"
```

Since there's no real SMS gateway here, both commands log the generated
6-digit password to the server console instead of sending it anywhere - the
password format itself is this server's own choice (the client just treats
it as an opaque string typed in from an SMS, so nothing about its shape was
traceable from the decompiled source). Use the logged password to log in
with `LoginCommand` afterward. `test/run.js` exercises the full loop
end-to-end: register -> read the password back from the store (standing in
for "check your SMS") -> log in with it -> recover -> confirm the old
password stops working and the new one succeeds.

### Wire format (the "ASN1PER" serialization)

Every value is bit-packed **MSB-first**. A top-level item (or a `Seq`
element) starts with a full tag byte:

```
tag byte = (ldSizeBytes << 6) | type
```

| type | meaning |
|---|---|
| 0 | null |
| 1 | Long |
| 2 | Boolean |
| 3 | String (UTF-8) |
| 4 | "complex": nested array, or raw `byte[]` when the inner 4-bit subtype is 6 |
| 5 | `Seq` (heterogeneous list) - elements are each independently tagged the same way, recursively |

A **Long** with value 0 is just the tag byte, nothing else. Otherwise:
tag byte, then `ldSizeBytes` bytes holding the value's bit-length, then that
many bits of the value itself.

A **String**/`byte[]` follows the same tag+length-prefix shape, payload is
raw UTF-8 bytes / raw bytes (`byte[]` additionally has a 4-bit `6` subtype
marker baked into its declared bit-length, since it's really "complex type 4,
subtype 6").

**Typed arrays** (`Long[]`, `Boolean[]`, `String[]`) get ONE outer type-4 tag
+ length, wrapping a 4-bit subtype nibble (1/2/3) and then each element with
only a **compact 2-bit length-descriptor-size prefix** (no per-element type
tag, since the array's subtype already declares it). `Boolean[]` elements
don't even get that - just one raw bit each.

A **top-level packet, and every `Seq`,** is just a flat concatenation of
independently-tagged items - there's no outer wrapper.

See `src/wire.js` for the full implementation (`encodeTop`/`decodeTop`) and
`src/bits.js` for the underlying bit reader/writer. `test/run.js` has worked
examples exercising scalars, typed arrays, nested `Seq`s, and raw byte
arrays.

### Login (CID 2) request/response shapes

Traced through `drug.vokrug.system.LoginService.a(...)` and
`drug.vokrug.system.UserInfoFactory`:

- **Request:** `[String[5]{login, password, deviceId, installId,
  deviceInfo}, Long? resumeToken]`. The trailing Long is usually *absent* -
  `LoginCommand`'s own constructor has what looks like a bug where its
  `else if (a((Long)(-1L)))` fallback can never be true, so in practice only
  `l > 0` ever gets appended.
- **Response (failure):** `[false]` - deliberately the same whether the
  login doesn't exist at all or the password is wrong, matching what a real
  server would do (no user-enumeration via the response shape).

**Auth policy: only registered accounts, with the correct password, can log
in - this is the default and it's enforced.** `store.authenticate()` never
creates an account; the only way to get one is `RegistrationCommand` (CID
1, see below). There's a separate, off-by-default `autoRegister()` path for
quick local testing without going through the phone-registration UI flow -
opt in with `DV_LOGIN_AUTOREGISTER=1` (see "Running it"); `commands/login.js`
only calls it when both that flag is set *and* the login genuinely doesn't
exist yet, so it can never silently overwrite or bypass a real account's
password. `test/run.js`'s `testStrictLogin()` spins up a server with the
real default config (no flag) and checks all three cases: an unregistered
login is rejected *and does not create an account*, a registered account
rejects the wrong password, and accepts the right one.
- **Response (success):** `[true, Seq(userInfo), LongArr(extraIds), Long
  serverTimeMs, Boolean flag]`
  - `userInfo` = `Seq([LongArr(ids), StrArr(text), Boolean isMale])`.
    `ids[0]` is the user id; a handful of further array-length-gated fields
    (city/region ids, avatar/status strings) exist in the client
    (`UserInfoFactory.a`) but weren't traced field-by-field - the server
    currently sends the shortest arrays that satisfy the client's
    `if (length >= N)` guards, so the client just skips setting those extra
    profile fields rather than crashing. Worth revisiting with a real
    PCAPdroid capture if profile data looks wrong in the app UI.

### Relogin (CID 13)

`ReloginCommand` sends `[Long userId, String password]` - the client caches
the *plaintext password* in memory after a successful login
(`CurrentUserInfo.a(String)`/`.c()`) specifically to resume the session this
way. Response is `[Boolean success]`; `false` triggers client-side logout.

### Message wire format

Traced through `drug.vokrug.objects.business.message.Message.a(Object)` and
`TextMessage`'s constructor chain (this is the format used by
`MessagesHistoryCommand`/`Last(In|Out)comingMessagesCommand` response items,
and it's worth tracing precisely since a naive read of `MessageSendCommand`
is misleading - see below):

```
Seq([
  LongArr([messageId, otherUserId, serverTimestampMs, messageType]),
  BoolArr([readByViewer, secondFlag]),
  <type-specific payload>   // MessageType.TEXT (0) -> a String body;
                             // other types (VOTE_FOR/AGAINST, PRESENT,
                             // STICKER, PHOTO) carry different payloads,
                             // not implemented
])
```

`otherUserId` is from the *viewing* user's perspective - the sender for an
incoming message, the recipient for an outgoing one. `secondFlag` (`bool2`
in `Message.a`) feeds into the read-flag computation but wasn't traced
beyond that; the server always sends `true`.

**`MessageSendCommand` (CID 8) request is `[Long recipientUserId, String
text]`, not two Longs.** Both `textMessage.d()` and `textMessage.k()` get
added via the same untyped `Command.a(Object)` call, which makes them look
symmetric from the call site alone - but `d()` resolves to `Message`'s field
`e` (the recipient id) while `k()` is `TextMessage`-specific and returns
`this.c.toString()`, i.e. the message body as a `String`. Worth flagging
since it's an easy misread of the decompiled source (an earlier pass at this
server got it wrong for exactly this reason).

### Persistence (SQLite)

Accounts, the friend graph, and messages are persisted in SQLite via Node's
built-in `node:sqlite` module (`DatabaseSync` - available since Node 22.5,
no native build step, no `better-sqlite3`/`node-gyp` dependency; it logs an
"experimental feature" warning on startup, which is expected and harmless).

```
users      (id, login, password, name, is_male, city, country, language,
            birth_year, birth_month, birth_day, first_name, surname,
            about, interests, last_seen, created_at)
friends    (user_id, friend_id, created_at)           -- one-directional edges
messages   (id, from_id, to_id, body, created_at, is_read)
wall_posts (id, author_id, region_code, body, created_at)  -- the "эфир"/wall
```

`name` is what the client itself calls "nick" (see "UserProfileCommand real
fields" below) - kept as-is from its original column name rather than
renamed, to avoid an extra migration for a cosmetic change.

Passwords are stored in plaintext - this matches what the real client
itself does (see "Relogin" above); fine for a private hobby server, not a
pattern to reuse for anything internet-facing.

Default DB file: `server/data/drugvokrug.sqlite3` (created automatically,
WAL mode). Override with `DV_DB_PATH` (or pass `:memory:` for tests -
`test/run.js` uses this for the main protocol-flow test, plus a separate
`testPersistence()` pass that restarts the server against a real temp file
and confirms the account and a sent message both survive).

## Layout

```
src/
  bits.js         bit-level reader/writer primitives
  wire.js         the TLV codec (encodeTop/decodeTop) + LongArr/StrArr/Seq/SeqArr/Bytes wrappers
  cipher.js       Blank/XOR/RC4
  transport.js    length-prefixed TCP framing
  session.js      per-connection state machine: handshake -> connected, dispatch
  db.js           SQLite connection + schema (node:sqlite)
  store.js        SQLite-backed account/friend/message store
  userinfo.js     shared "userInfo Seq" builder used by most profile-bearing responses
  message.js      shared "message Seq" builder (see "Message wire format")
  regions-data.js real country/Russian-region dataset extracted from the APK
                   (see "RegionCommand real data") - generated by tools/build-regions.js
  server.js       entry point (also tracks online users)
  commands/
    login.js, relogin.js, logout.js
    registration.js RegistrationCommand, PasswordRecoveryCommand
    region.js       RegionCommand
    bootstrap.js    post-login auto-fired commands (options/rating/stickers/presents/bt)
    profile.js      UserProfileCommand, SendUserInfoCommand, UserSmallInfoCommand
    friends.js      FriendsListCommand, AddToFriendsCommand
    guests.js       GuestListCommand
    status.js       OnlineStatusCommand
    live.js         LiveListCommand, SendMessageToLiveChatCommand ("эфир"/wall)
    discovery.js    SearchCommand
    misc.js         CanWriteLiveChatCommand, CanChangePhotoCommand,
                     MarkOptionCommand, PaidServicesCommand,
                     NotificationListCommand, FamiliarListCommand, EventListCommand,
                     BtFindCommand, SendSettingToServerCommand
    messaging.js    MessageSendCommand, MessagesHistoryCommand,
                     Last(In|Out)comingMessagesCommand, MessageWorkCommand
    index.js        CID -> handler registry
tools/build-regions.js  one-off generator for src/regions-data.js (see above)
test/run.js       end-to-end test: a fake client exercising the whole flow
```

## Running it

Requires Node 22.5+ (for the built-in `node:sqlite` module - see
"Persistence" above; it logs an experimental-feature warning on startup,
which is expected).

```
cd server
npm start                 # listens on 0.0.0.0:9080, Blank cipher by default
npm test                  # end-to-end self-test (spins up its own instance on :19080)
```

Env vars: `DV_PORT` (default 9080), `DV_HOST` (default 0.0.0.0), `DV_CIPHER`
(0=Blank/1=XOR/2=RC4, default 0), `DV_PUBLIC_HOST`/`DV_PUBLIC_PORT` (if set,
advertised in the handshake as the resource-server address), `DV_DB_PATH`
(default `server/data/drugvokrug.sqlite3`), `DV_LOGIN_AUTOREGISTER` (`1`/
`true` to let `LoginCommand` silently create any never-seen login - off by
default; see "Registration and password recovery").

## Pointing a real device at this server

No TLS to fight this time (plain TCP), so this is simpler than the VK
server. Two options, same as usual:

1. **DNS override** (no APK modification): make the test device resolve
   `sap.drugvokrug.ru` to this server's IP - e.g. a local DNS server on the
   test network, or a `/etc/hosts` entry on a rooted device. Run the server
   with `DV_PORT=9080`.
2. **Smali patch**: `apktool d 2-3-1.apk`, edit the two
   `"sap.drugvokrug.ru"` string constants in `smali/drug/vokrug/AppProfile.smali`
   to the server's IP, `apktool b`, sign, install.

Either way, capture the real traffic with PCAPdroid afterward to validate
the untraced login-response fields noted above, and to start tracing the
remaining ~31 command classes.

## Next steps

- Trace `SearchCommand`'s 11-field `SearchParams` request struct so search
  can actually filter (ideally from a live PCAPdroid capture against the
  real server, same as the login-response fields noted above).
- Trace more commands - presents, avatars (`UploadAvaCommand`), stickers
  content, notes, complaints, payments are all still unimplemented (~31
  classes in `drug/vokrug/system/command/*.java` left).
- Implement the resource/secondary connection for avatar uploads/downloads.
- Non-text message types (PRESENT/STICKER/PHOTO/VOTE) aren't persisted or
  encoded yet - `message.js` only handles `MessageType.TEXT`.
- `BtFindCommand`, `NotificationListCommand`, `EventListCommand`, and
  `FamiliarListCommand` are safe empty stubs (see "Newly implemented
  commands" above) - their own item structures (`Notification`, `Event`,
  the "familiar" matching payload) aren't traced yet.
