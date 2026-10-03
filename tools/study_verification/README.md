# Native study verification

`verify.py` exercises the running application and WebSocket gateway. It only
accepts loopback URLs and the disposable `lixiangqi_preview` or
`lixiangqi_study_verification` Mongo database. Pass the matching `--mongo` URI
when verifying an application configured for the isolated fixture database.
It creates unique ordinary users and authenticated sessions without changing
existing accounts. Mongo is used only for fixture provisioning and cleanup;
study operations run through the real HTTP and socket interfaces.

With the local application, gateway, Redis and Mongo running:

```powershell
& .venv\Scripts\python.exe tools/study_verification/verify.py --manifest .tools/native-study-verification.json
```

The manifest records individual passed checks, fixture identities, failures,
and the expected persisted tree. It contains disposable session credentials;
keep it outside version control. A failed run is retained for investigation.
Use a different manifest filename for another run.

After restarting the application and gateway without restoring the database:

```powershell
& .venv\Scripts\python.exe tools/study_verification/verify.py --phase reopen --manifest .tools/native-study-verification.json
```

With Chrome and the repository's browser Pikafish assets available, exercise
local chapter analysis before restart verification:

```powershell
& .venv\Scripts\python.exe tools/study_verification/verify.py --phase engine --manifest .tools/native-study-verification.json
```

This phase runs the real browser Pikafish worker, saves chapter annotations,
checks reload persistence and rejects unauthorized or stale result uploads. It
asserts that no server analysis is requested or queued. It also exercises comment
tab switching, rapid glyph edits, lesson hints and completion, and layouts at
1440, 900 and 390 pixels. Browser diagnostics and screenshots are saved beside
the manifest without printing credentials.

Remove only that run's fixture studies through the application and its synthetic
users/sessions afterward:

```powershell
& .venv\Scripts\python.exe tools/study_verification/verify.py --phase cleanup --manifest .tools/native-study-verification.json
```

Coverage includes native rank-ten moves and paths, nested variations, comment
and drawing edits, arbitrary NAGs, teaching hints, multiple simultaneous clients,
invitations and contribution roles, presenter synchronization, missed-event
reconnect recovery, invalid move errors, atomic invalid multi-game imports,
notation round trips with contributor identities, cloning, and private access
control. The engine phase requires the installed Chrome browser and Playwright
dependencies; it does not replace screen-reader or deployed-service acceptance.
