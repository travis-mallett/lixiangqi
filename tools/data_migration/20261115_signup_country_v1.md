# Signup country persistence repair

The signup writer incorrectly stored `profile.flag`; the canonical `Profile` BSON
serializer reads/writes `profile.country`. The migration scans **all** `user4`
documents with the misplaced field, irrespective of creation date or enabled state.
It promotes the selection only when `country` is absent, preserves any existing
canonical country (including explicit null), and removes `flag`. Opt-outs and
unrelated accounts are untouched. Other profile fields and full account contents
must compare equal to the expected original after transformation.

## Run and verify

Requires the project's existing Python/pymongo environment. Preview is read-only:

```sh
python tools/data_migration/20261115_signup_country_v1.py --mongo-uri mongodb://HOST/lichess
```

Before applying, stop account writers and deploy the corrected user module. The
normal `push-local-live` packages and checksums this script and invokes it after
application writers stop, before restarting them:

```sh
python tools/data_migration/20261115_signup_country_v1.py --mongo-uri mongodb://HOST/lichess --apply --writers-stopped
```

Every affected **full account document** is backed up in the durable collection
`__signup_country_v1_user4`, under `original`, using journaled majority writes.
All recovery copies are reread and checked before the first account update.
Existing copies are never overwritten. This collection contains private account
information and must retain the database's access protections. It is outside
disposable release directories and must not be expired or checked into Git.

The script validates shapes before writes, compares profiles when updating, then
verifies complete migrated accounts against the originals. It records completion
in `schema_migration/signup_country_v1`. Interrupted runs safely resume from the
original backups. A completed run with new misplaced values fails: investigate an
obsolete signup writer rather than silently repeating a broken deployment.

For an operational release, also retain a restricted, checksummed `mongodump`
archive of `user4` before mutation. Verify its readability before proceeding.
Do not restart account writers after a failed migration until the failure is
understood and resolved. Do not restore the old buggy writer as a permanent fix.

After migration, require zero `user4` documents with `profile.flag`, compare all
repaired profiles with the saved expected values, and verify a public profile and
the public user API. Re-running must report `already-current` with no mutations.

## Recovery

The regression suite reconstructs intact original accounts from the recovery
collection in a separate fixture collection. In production, first stop writers and
capture current affected documents too. Read the immutable `original` documents
into an isolated collection to investigate and correct the migration. Reconstruct
the intended profiles from these originals, then apply narrowly scoped corrections
with comparisons against current profiles. Preserve account edits and all other
post-migration information. Never replace entire production accounts or the whole
database from this backup after users have resumed activity. Keep original copies
and operational archives through every retry; clearing completion state requires
an explicit recovery procedure and verification of the current writer.

Tests: `LIXIANGQI_MIGRATION_TEST_URI=mongodb://127.0.0.1:PORT python -m unittest
tools.data_migration.tests.test_signup_country`. Use an isolated MongoDB 8.2 server;
the suite creates and drops only unique test databases.
