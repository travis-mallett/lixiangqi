# Country choice during registration

Website, LiXiangQi Mobile and Xiangqi Kids registration require a profile country/region
or an explicit opt-out. This includes email registration, Google account completion and
the website's simple/custom registration form. Existing accounts are unchanged.

The dropdown starts empty. Submitting without a selection reveals **Opt out** and the
message “Add your country and flag to your profile, or choose ‘Opt out’.” The choice stays
available while correcting the form. Selecting a country clears opt-out; opting out
clears the country. Native dropdowns also offer an empty entry to clear a selection.
The website server renders the choice after an invalid submission even without JavaScript.

`SecurityForm.signupCountryMapping` owns validation for both website and mobile endpoints:

- `country.flag`: optional code from the existing profile flag catalogue;
- `country.optOut`: boolean, requiring an explicit true value when the flag is empty.

Unknown codes and malformed booleans are rejected. Opt-out takes precedence if both
values are submitted. `UserRepo.create` serializes the canonical `Profile` in the account
insert itself. Its Scala/JSON `flag` property is stored as BSON `profile.country`;
there is no follow-up write or separate country storage. Opt-out is a
registration decision, not a persistent profile preference. Users can edit or remove
their flag afterward using existing profile editing.

The website uses the existing `FlagApi` catalogue. Native choices are generated snapshots
of the same catalogue, with no geolocation inference or additional network request:

```sh
node scripts/snapshot-registration-countries.mjs
node scripts/snapshot-registration-countries.mjs --check
```

English, Simplified Chinese and Traditional Chinese website messages are supplied through
the translation system. Mobile uses its English localization; Kids supplies English and
Chinese. Country names retain the existing profile catalogue's naming convention.

## Release and verification

Deploy the server and website assets and release both updated mobile applications as a
coordinated registration-contract update. Older mobile binaries do not send either field
and cannot complete registration against the updated server. Existing-account login and
Google account linking are unchanged. No user-data migration, backup or deployment-tool
change is necessary. This task does not deploy or publish either application.

Verification covers server mapping cases (blank, country, opt-out, conflicting values,
invalid values), website submission behavior, native email/Google flows, request payloads,
clearing a selection, and native widget layouts at 320 and 768 pixels. Browser checks use
the production CSS and registration component at 1280, 768 and 390 pixels; these are
component checks rather than a live CAPTCHA/account-creation test.

Results and exact source fingerprints are recorded in each app's reconciliation receipt.
No unrelated checkpoint or pending review is advanced. iOS builds require macOS/Xcode;
physical devices, live registration, Linux backend integration tests and production release
remain outside this local verification.

### Local checks (November 8, 2026)

- `pnpm format`, `pnpm run lint`, `pnpm run check-format`: passed. Concurrent graph-board
  lint errors seen during an intermediate run were corrected by that separate work;
  the final full lint and format checks pass.
- `pnpm i18n-file-gen`, `./ui/build --i18n`, repeat generation, and
  `pnpm i18n-file-gen --check`: passed with stable generated keys/declarations.
- libxml2 DTD validation: all 6,223 translation XML files passed. `bin/trans-lint`:
  zero errors, 1,390 existing warnings (run with UTF-8 output on Windows).
- `./ui/build --no-install -p`: passed. The existing `./ui/test` wrapper fails to
  resolve `.test/runner.mjs` from the repository root; its actual runner,
  `node ui/.test/runner.mjs`, passed all 725 tests.
- `scalafmtAll`, `scalafmtCheckAll`, `security/testOnly *SignupCountryTest`, and
  full application `compile`: passed. The country suite has five tests.
- `security/test`: 61 tests passed initially and one external-login test encountered
  Windows' Unix-domain loopback limitation on the mapped drive. Retrying with
  `-Djdk.net.unixdomain.tmpdir=Z:/Work/Scripts/lixiangqi/.tools/no-unix-sockets`
  passed all seven external-login tests; SBT reused its other successful test results.
- Each mobile application's `scripts/check.ps1`: passed formatting and
  `flutter analyze --fatal-infos`. Main: 492 tests passed, two existing skips.
  Kids: 222 tests passed, one existing skip.
- `node scripts/snapshot-registration-countries.mjs --check`: passed for both apps.

Full `test;stage`, Linux backend integration tests, CodeQL, iOS builds, physical devices
and live registration were not run. Android debug build outcomes are recorded in the
two mobile reconciliation reports. No commit, push or production deployment was made.

## Signup persistence repair (November 15, 2026)

The original signup insert wrote `profile.flag` directly, bypassing the existing
`Profile` BSON serializer's `@Key("country")`. Selections were stored but invisible
to account loading, profile display and API consumers. Signup now uses the same
serializer as profile editing. No API field or mobile request payload changes.

`SignupCountryPersistenceTest` exercises real account insertion and loading for email,
Google, Lichess and Lishogi identities, country/region selections and opt-out. Run with
`LIXIANGQI_EXTERNAL_LOGIN_TEST_URI` pointing to an isolated MongoDB.

The all-account repair is
[`20261115_signup_country_v1.py`](../tools/data_migration/20261115_signup_country_v1.py).
See its [operations guide](../tools/data_migration/20261115_signup_country_v1.md)
for backups, deployment, verification and recovery. Both native apps inherit this
server correction; their country-selection and email/Google payloads remain unchanged.

Production repair on November 15 checked all 137 accounts: nine misplaced selections
were promoted, existing canonical countries were preserved, and zero misplaced fields
remain. All nine public profiles and user APIs were checked after restart, including
the China flag reported by the user. The verified account archive, original binary,
source fingerprints and operation receipt are retained under
`/opt/lixiangqi-beta-signup-country-20261115`; immutable full-account recovery copies
also remain in MongoDB's `__signup_country_v1_user4` collection.

This was a narrow release of the tested `UserRepo` class and its Scala metadata inside
the original production user-module jar, plus the migration. Public method signatures
were unchanged and bytecode review confirmed only signup serialization changed.
Unrelated checkout changes were not included. Normal future releases now package,
checksum and run the migration while account writers are stopped. No mobile binary
release is necessary for this backend correction.

Verification: user-module tests (including real email/provider account creation and
read-back), five server country-validation cases, six migration tests, 95 deployment
safety tests, and 26 targeted signup tests in each mobile app passed. The wider migration
suite ran 72 tests with 14 environment-dependent skips. The patched jar also passed the
persistence regression against the production Linux dependencies using a temporary,
uniquely named test database, which the test removed. Country snapshot checks passed.
User-module Scalafmt and repository lint passed. The global Oxfmt check was blocked by
an unrelated temporary SEO script; changed documentation was formatted. Full backend
`test;stage`, the remaining mining/desktop workflow suites, CodeQL, native builds and
physical-device/iOS checks were not run for this narrow backend repair.
