# External login and linked accounts

LiXiangQi offers Google, Lichess, and Lishogi, in that order, as login methods. Existing users
link providers at `/account/login-methods` after confirming their identity. A
provider identity belongs to exactly one local account. Usernames and email
addresses never automatically link or merge accounts.

The header has one **Sign in** action. `/login` is a shared provider-first entry
screen for login and registration; `?method=password` opens password login.
Email registration and emailed sign-in links remain available as secondary paths.

New provider users choose a local username and accept the normal agreements.
Google requests `openid email`; a verified Gmail or Workspace email is used for
recovery without a second confirmation. Other provider users supply a recovery
email through the existing email-confirmation flow. Changed email addresses still
require normal verification. No provider email ever automatically links accounts.
Provider users do not need a local password. Local two-factor authentication also
applies to provider login.

The completion screen offers **Already have an account? Sign in to link it**.
The pending provider identity remains server-side during password login and any
subsequent reauthentication. An explicit confirmation links it to the signed-in
account. Completing password authentication grants the same five-minute identity
confirmation used by account settings. Abandoned provider identities expire.

## Provider configuration

The canonical callback is `${net.base_url}/auth/external/PROVIDER/callback`.
For the current deployment domain, register:

```
https://lixiangqi.com/auth/external/google/callback
```

Register additional domains only if they actually serve the application with
their own canonical `net.base_url`. Domain roots are not callback URLs. Local
testing needs its exact callback too, for example
`http://localhost:9663/auth/external/google/callback` if that is the configured
local origin. Changes to Google's registered redirect URLs must be made in
Google Cloud Console; editing a downloaded JSON file does not register them.
Configure the Google consent screen and production audience before launch.

Lichess and Lishogi use public clients with S256 PKCE; the client ID is
`net.domain`. They request no additional account scopes. Google uses a web
client secret and the OpenID Connect UserInfo endpoint's stable `sub`. Provider
tokens are used on the server only and are not persisted or refreshed.

`security.external.lichess.enabled` and `security.external.lishogi.enabled`
default to true. Google is offered when its credential file exists. The default
local path is `data/local/secrets/google-client-secret.json`; override it with
`GOOGLE_OAUTH_CREDENTIALS_FILE` or `security.external.google.credentials_file`.
The JSON must contain Google's `web.client_id` and `web.client_secret`. Keep the
file private. Root-level `client_secret*.json` downloads are also ignored by Git.

The adjacent `lixiangqi-beta-deployment/push-local-live.ps1` passes the local
credential path to its transport. A subsequent authorized deployment provisions
an absent server file under `data/secrets/` with restricted permissions, outside
the application release and manifest. Existing credentials are preserved; a
different client ID or secret stops deployment instead of silently replacing
them. Docker mounts the directory read-only at `/run/lixiangqi-secrets`, outside
the read-only `/lila` application mount so Docker can create its mountpoint.
Credentials are explicitly rejected
from application payloads. No deployment is necessary to run the unit tests.

## Zalo configuration (currently disabled)

Zalo is disabled by default (`security.external.zalo.enabled = false`) because its profile API
rejects our server IP outside Vietnam. Credentials alone do not enable it. Re-enabling it requires
an explicit configuration change and a verified working connection to the profile API.

Zalo uses its [Social OAuth v4 web flow](https://docs.zaloplatforms.com/docs/Social/social-api/tham-khao/user-access-token-v4)
with S256 PKCE and a server-side app secret. Configure the app's login callback as:

```
https://lixiangqi.com/auth/external/zalo/callback
```

Complete domain verification and enable the application in Zalo's developer console.
Keep app-secret checking enabled for this server-side integration. Domain verification
does not register the callback or activate the application.

Store a JSON object containing string fields `app_id` and `secret_key` in
`data/local/secrets/zalo-client-secret.json`, or set `ZALO_OAUTH_CREDENTIALS_FILE`.
The provider is offered only when explicitly enabled and its credential file exists. Root `Zalo_Keys.txt`
and the JSON credential filename are ignored by Git and rejected from release payloads.
The deployment transport provisions both providers' files under `data/secrets/`
without replacing existing credentials; Docker reads Zalo's file through
`/run/lixiangqi-secrets/zalo-client-secret.json`.

Only `fields=id` is requested from Zalo's profile API. Neither names nor email
addresses are used to identify or automatically link accounts. Zalo's user ID is
application-specific: keep the same app ID when rotating its secret. Replacing the
application would require a separately planned account-identity migration.
Zalo has the same registration, explicit linking, reauthentication, local 2FA,
and last-login-method protections as the other providers. API errors with HTTP 200
are rejected. Provider HTTP redirects are disabled to keep credentials on their
configured endpoints. Tokens are discarded after the identity lookup.

## Account lifecycle and security

External identity keys are stored in the `user4.externalLogins` array. A sparse
unique multikey index, `externalLogins_unique`, is ensured before lookup,
registration, or linking. Registration inserts the user and identity in one
write. No existing user data needs conversion. Index creation does not rewrite
or remove accounts; a failure prevents external authentication from proceeding.

Only one account from each provider can be linked to a local user. Unlinking
checks the remaining login methods in the same database operation. A provider-only
user must add another provider or set a password before removing the last link.
Removing the final link from a password account unsets the field, avoiding empty
arrays in the unique index. Account erasure removes external identity keys.

OAuth state and PKCE verifiers expire after ten minutes, are bound to an HttpOnly
browser cookie and provider, and are consumed once. Link and reauthentication
attempts also bind to the initiating local user and session. Restarting the app
cancels unfinished flows. Provider errors never grant access or expose tokens.

Account settings accept either the existing password check or a five-minute
reauthentication grant obtained with a password plus local 2FA, or an already
linked provider plus local 2FA. Grants stay server-side and bind to the local
session. Logging out or rotating the session makes them unusable. Managed
classroom accounts cannot link providers. Closed accounts cannot obtain a normal
session through external login; they retain the existing email reopening flow.

Sign-in methods is the shared settings entry for passwords and external identities.
Actions remain visible without a reauthentication grant. Link/unlink intents are
stored for ten minutes, bound to the initiating user and session, and consumed once.
Verification resumes the selected action; unlinking still requires an explicit POST
confirmation and an atomic last-method check. Password changes require the same
verification grant, then close existing sessions and rotate the current session.
Passwordless accounts can add a password after verifying a linked identity.

Settings and verification buttons show the currently linked Lichess or Lishogi
handle. Other providers' opaque subject identifiers are never shown. To replace a
chess-provider account, first verify with an existing sign-in method (the local
password or an already linked account), confirm unlinking, then start linking the
new account. Authenticating the replacement account during verification cannot
authorize removal of the existing link.

## Verification

`security/testOnly *ExternalLoginTest` exercises HTTP code exchange, PKCE,
browser/provider binding, replay rejection, stable identity parsing, and redirects.
`user/testOnly *ExternalIdentityRepoTest` runs database concurrency checks when
`LIXIANGQI_EXTERNAL_LOGIN_TEST_URI` points to an isolated local MongoDB. It creates
and drops only a randomly named `external_login_test_*` database.

Before enabling providers in production, complete a real-provider round trip for
each callback origin, including linking to an existing password account, local
2FA, provider-only registration and email confirmation, and unlinking. Mock HTTP
tests cannot verify provider-console settings or the live consent screen.

## Provider button assets

Buttons use the official [Google logo](https://developers.google.com/static/identity/images/g-logo.png),
[Lichess logo](https://github.com/lichess-org/lila/blob/master/public/logo/lichess.svg),
and [Lishogi logo](https://github.com/WandererXII/lishogi/blob/master/ui/@build/static/assets/logo/lishogi.svg).
Google branding follows its [button guidance](https://developers.google.com/identity/branding-guidelines).
Email verification follows Google's distinction between authoritative Gmail or
Workspace addresses and [third-party email addresses](https://developers.google.com/identity/sign-in/android/backend-auth).

The Zalo wordmark comes from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/zalo.svg) (CC0).
