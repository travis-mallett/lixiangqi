# Native Me, preferences and account controls

The Flutter Me feature consumes the website's canonical preference and account
services. Deploy the backend before distributing the app. No Mongo migration,
server configuration, secret or provider callback registration changes are needed.
The existing deployment flow applies. Users with older access tokens must sign
out and back in to acquire `preference:read` and `mobile:account`.

## API contracts

- `GET /api/account/preferences`: preferences, account language and appearance /
  language catalogs; `preference:read`.
- `POST /api/account/preferences/:name`: canonical `PrefSingleChange` named form
  field; `preference:write`. Language uses `lang`. Updates preserve other fields
  through `PrefApi.setPref` and existing isolation/matching-piece behavior.
- `GET /api/account/preferences/notifications`: canonical notification form data.
- `POST /api/account/notifications/:name`: one `v=true|false` field, merged with
  the canonical notification form. Fixed bell channels cannot be changed.
- `/api/mobile/account`: dedicated `mobile:account` scope. The route family
  exposes status, confirmation, provider verification/link/unlink, TOTP setup,
  native account changes, session/client/token listing and revocation, and
  personal token creation. See `MobileAccount` and `conf/routes` for form keys.

`mobile:account` is classified as a dangerous account permission. It is granted
by the first-party native login and requested by its browser OAuth flow, never
implicitly granted to old tokens or the separate Kids application.

## Identity and lifecycle

Sensitive changes and session listing require recent password/TOTP or linked
provider/TOTP verification. The five-minute confirmation cache is keyed by user
and SHA-256 bearer binding. Browser confirmations retain their session binding.
Native credentials never become a browser session.

Provider tickets use the existing browser binding, OAuth state and PKCE flow.
Their bounded ten-minute cache also binds the target user, bearer, provider and
purpose; launch, identity deposit and consumption are atomic and one-use. The
browser receives an opaque ticket URL, not the native access token. Provider
verification can only confirm an already-linked identity owned by the same user;
new linking requires recent identity confirmation. TOTP is validated on completion.

Account changes reuse the website forms, managed-account constraints, identity
repository, email rate limits, termination service and session/push cleanup.
Responses containing account state or credentials are non-cacheable. Personal
API tokens are returned once. The app clears sensitive routes on account change
and blocks ambiguous retries after failed writes.

Personal-data export is not exposed by this route family.

## Verification

Run Scala formatting and compilation, `pref/testOnly *MobilePreferencesTest`
and `security/testOnly *MobileAccountScopeTest *ExternalLoginTest`. The preference
tests cover complete native field coverage, bounds, untouched values and mask
validation. Provider tests cover ticket/user/bearer/provider binding and replay.
On this Windows host, use the repository's existing local JDK selector patch for
the loopback provider test server. The mobile repository documents UI and Android
verification in `doc/ME.md`; production mail/provider flows and destructive
actions require controlled staging acceptance.
