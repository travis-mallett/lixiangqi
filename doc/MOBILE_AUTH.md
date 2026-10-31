# Native mobile account API

LiXiangQi Mobile renders its own Flutter account forms. These first-party JSON
endpoints accept URL-encoded POST bodies (16 KiB maximum), do not authenticate
using cookies, and never redirect to website forms. Use HTTPS, `Accept:
application/json`, and `Accept-Language` for the user's locale. Passwords, codes,
and tokens must never appear in URLs, logs, or analytics.

## Protocol

`GET /api/mobile/auth/config` returns the public `googleClientId` from the existing
web credential file (or null when Google is unavailable). It never returns a secret.
Android registers its package and signing SHA-1 in the same Google Cloud project
and uses this web client ID as Credential Manager's server client ID.

`POST /api/mobile/auth/google` accepts `idToken`, optional `token` (local TOTP),
and optional `verificationId` / `emailCode`. Google's Java authentication library
verifies the signature against asynchronously cached Google public keys; issuer,
audience, algorithm, expiry, issue time, and subject are checked. The website's
Google subject mapping and authoritative-email policy remain canonical.
Linked users pass the same local 2FA, account-closure and email-confirmation guards
as password users. An unlinked Google identity returns
`{"status":"registration_required","email":"..."}`; email is null unless Google
is authoritative for it. This request never creates or links an account.

`POST /api/mobile/auth/google/register` accepts the ID token, username, email,
agreement fields, and optional email verification proof. It uses the shared signup
pipeline with an external identity and no password. The supplied email must match
Google's authoritative email or have a valid native registration code. The unique
external-identity index prevents duplicate ownership, including concurrent signup.
Email matching never links accounts. New errors are `invalid_provider_credential`,
`provider_unavailable`, and `provider_already_linked`.

Lichess/Lishogi use the existing browser OAuth flow through native AppAuth. A
`provider` hint on a parsed `/oauth` authorization request starts the existing
external-login service and returns to that local OAuth request. AppAuth validates
state and S256 PKCE and exchanges the code at `/api/token`; the app requests
`puzzle:read`, `puzzle:write`, and `mobile:play`. This preserves provider registration, local 2FA, and explicit
account authorization. Google on iOS uses this browser flow until its separate
native client registration is configured.

`POST /api/mobile/auth/login` accepts `username` (username or email), `password`,
optional `token` (TOTP), and optional `verificationId` / `emailCode`. It reuses
SecurityApi's credential validation, compromised/weak/blanked-password policy,
network two-factor policy, disabled-account restrictions, and password hash rate
limits. `missing_totp` and `invalid_totp` require another native submission with
the authenticator code. An unconfirmed account with valid credentials receives
`{"status":"email_verification_required","verificationId":"..."}` after
a code is sent to its recorded email. Submit credentials and that proof again.

`POST /api/mobile/auth/registration-code` accepts `email`, applies the existing
signup email validation, and sends a code. It returns
`{"status":"code_sent","verificationId":"..."}`. No account is created yet.

`POST /api/mobile/auth/register` accepts `username`, `password`, `email`,
`verificationId`, `emailCode`, and the existing boolean agreement fields
`agreement.assistance`, `agreement.nice`, `agreement.account`. The shared signup
pipeline validates the form before consuming its email proof. Existing username,
email, password, network, signup throttles, welcome messages, and preference
initialization remain authoritative. Native verified signup bypasses only the
browser challenge; the website path still requires that challenge as before.

Successful login/registration returns `access_token` and `token_type: Bearer`.
The first-party token uses the existing token collection, expiry (12 months),
rotation, revocation, and account API; it grants `puzzle:read`, `puzzle:write`, and `mobile:play`. Read the
account through `GET /api/account` and revoke with `DELETE /api/token`.

Deploy the mobile-token scope fix before using signed-in puzzles with native
Google/password login. Browser provider login also requires the updated mobile
app requesting these scopes. Existing tokens are not changed: sign out and sign
in again to obtain puzzle permissions. No data migration is required.

Errors use `{"error":"code"}`. Validation errors also contain `fields`, a map
from form field names to existing validation message keys. Mobile localizes
these responses. Relevant codes include `invalid_credentials`, `missing_totp`,
`invalid_totp`, `invalid_email_code`, `password_reset_required`,
`two_factor_required`, `account_closed`, `forbidden_network`, `rate_limited`,
`email_unavailable`, and `validation_error`. Responses are marked `no-store`.
Clients must also handle non-JSON transport/proxy errors without opening a web UI.

## Abuse controls and deployment

### Xiangqi Kids

Native authentication requests may select the Kids client with the public query
parameter `client=xiangqi-kids`. Credential, provider, email, and two-factor
checks are unchanged. Kids tokens use a separate client origin
(`org.lixiangqi.kids://`) and description, and grant `kid:enable`, `mobile:play`
and the existing puzzle scopes. The Kids app exposes only the rated 15+0 room.
Older Kids tokens require sign-out and sign-in after deploying the gameplay
permission; existing tokens are not modified.

`POST /api/account/kid/enable` requires the `kid:enable` scope. It always enables
Kid mode through `UserApi.setKid`; it accepts no target state and cannot disable
the mode. Repeated calls for an already-enabled account are harmless. The
client confirms the resulting account state through `GET /api/account`.
Enabling Kid mode retains the existing biography-removal behavior.

Kids asks for confirmation when an existing account is not in Kid mode and
automatically enables it after native registration, whose agreement discloses
the setting. A failed activation retains the session for retry but does not
unlock authenticated play. Saved sessions and foreground resumes recheck the
account. Website disabling remains available under the existing account rules.

Browser provider flows request `kid:enable` and `mobile:play` with client ID `xiangqi-kids` and
callback `org.lixiangqi.kids:/oauth`. Android Google additionally needs a Google
OAuth Android client for package `org.lixiangqi.xiangqi_kids` and its signing
certificate, in the backend web client's project. These identifiers are distinct
from the regular mobile app so both apps can be installed together.

Deploy these backend changes before Kids. No data migration, new server secret,
or deployment-tool change is required; existing build fingerprinting includes
the modified controllers, routes, and OAuth code.

### Shared safeguards

Native requests have a separate enforced IP throttle (30 per five minutes), in
addition to existing password/signup rate limits. Email delivery is limited to
10 per IP, 3 per normalized email, and 200 globally per hour. These delivery
limits also apply in development. Mail-disabled servers return an error; there
is no production bypass or fixed test code.

Email challenges use secure random identifiers and six-digit codes, salted
SHA-256 hashes, ten-minute expiry, five attempts, and atomic single-use
consumption. They are bound to a normalized email and purpose; account
confirmation is additionally bound to the user ID. The bounded in-process cache
holds at most 10,000 challenges. Restarting the single application instance
invalidates outstanding challenges; users can request a new code. A future
multi-instance deployment must provide shared atomic challenge storage before
enabling these endpoints across instances.

Deploy the backend before distributing the native-form app. The existing
`../lixiangqi-beta-deployment/push-local-live.cmd` flow fingerprints and packages
app, modules, conf, and translations and runs `stage`; it needs no migration,
new secret, or new service for this change. Existing SMTP configuration is used.
Production deployment requires explicit authorization per `deployment.md`.
No existing account, password, session, or token data is migrated or deleted.

Verification: security tests cover challenge binding, expiry, attempt limits,
and concurrent single-use consumption; Flutter tests cover the native forms and
HTTP contract. Before release, verify real email delivery and complete login,
TOTP, registration, restart/session restoration, and sign-out on Android and iOS.
