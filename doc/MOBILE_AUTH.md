# Native mobile account API

LiXiangQi Mobile renders its own Flutter account forms. These first-party JSON
endpoints accept URL-encoded POST bodies (16 KiB maximum), do not authenticate
using cookies, and never redirect to website forms. Use HTTPS, `Accept:
application/json`, and `Accept-Language` for the user's locale. Passwords, codes,
and tokens must never appear in URLs, logs, or analytics.

## Protocol

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
rotation, revocation, and account API; it has no privileged scopes. Read the
account through `GET /api/account` and revoke with `DELETE /api/token`.

Errors use `{"error":"code"}`. Validation errors also contain `fields`, a map
from form field names to existing validation message keys. Mobile localizes
these responses. Relevant codes include `invalid_credentials`, `missing_totp`,
`invalid_totp`, `invalid_email_code`, `password_reset_required`,
`two_factor_required`, `account_closed`, `forbidden_network`, `rate_limited`,
`email_unavailable`, and `validation_error`. Responses are marked `no-store`.
Clients must also handle non-JSON transport/proxy errors without opening a web UI.

## Abuse controls and deployment

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
