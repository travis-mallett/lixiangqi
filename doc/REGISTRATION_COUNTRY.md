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
values are submitted. `UserRepo.create` writes the selected `profile.flag` in the account
insert itself; there is no follow-up write or separate country storage. Opt-out is a
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
