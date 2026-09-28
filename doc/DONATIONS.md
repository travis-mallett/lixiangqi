# LiXiangQi donations

## Setup status — 2026-09-22

The PayPal Business account now has a live **LiXiangQi** REST app, the
`PATRON-MONTH` catalog product, active USD/EUR monthly plans, and a webhook at
`https://lixiangqi.com/patron/webhook` (ID `7EM616770L3005112`).

The live Client ID and Secret are in `/opt/lixiangqi-beta/.env` on the server
(mode 0600). A private copy of the prior environment file was preserved before
adding them. No service was restarted and no live payment was made.

The user requested **preparation for the next normal deployment**, not deployment
of the checkout's unrelated pending changes. The sibling
`lixiangqi-beta-deployment/templates/lila-application.beta.conf` and
`upload/compose.yaml` now pass these settings to the app:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `OPENEXCHANGERATES_APP_ID` (optional)

The deployment template selects `https://api-m.paypal.com`. The repository's base
configuration remains sandbox with empty keys for safe local development. Do not
copy live keys into local previews, source control, release bundles, or frontend
code. Leave Stripe credentials empty for the PayPal-only setup.

Payments are credited to the merchant owning the REST app. Bank withdrawals are
managed separately in that PayPal Business account; website code does not select
a personal bank account.

## Behavior

Signed-in donors can make one-time, lifetime, gift, and monthly donations. The
Donate page explains the Alpha/Beta/future funding priorities and planned nonprofit
formation, and retains the answer that all features are free. Inherited Lichess
funding, bank-transfer, nonprofit registration, and billing-portal links were removed.

Without an exchange-rate API key, checkout uses USD. PayPal handles the buyer's
available funding-currency conversion. Other donation currencies are offered only
when the optional Open Exchange Rates integration is configured. USD accounting
never requires an exchange-rate request.

An order approval is captured with a stable PayPal request ID. Both the browser
callback and verified webhook delivery can finish it. Monthly approvals are checked
against the signed-in owner and the subscription transactions API; approval alone
does not grant paid benefits. A pending first payment gets a processing message.
Renewal events can initialize a Patron even when the browser never returned.

Every completed PayPal payment uses `paypal:<transaction ID>` as its unique charge
ID. Charge, Patron expiry, and user plan are committed in one MongoDB transaction.
Concurrent retries cannot add a second receipt or month. A failed write rolls back
all three changes. This requires a MongoDB replica set; the standard beta deployment
already provisions one. Notifications and metrics run after commit and are not part
of the financial transaction.

Cancellation checks PayPal's response before removing renewal information. Paid
Patron time is retained. Expiration rechecks the date and updates the user in a
transaction, so a concurrent renewal is not overwritten. Overdue expirations are
processed after downtime rather than being limited to a three-hour window.

Refunds and disputes are handled in the PayPal Business dashboard. Automatic
refund/chargeback adjustments to historical donation totals and wings are not
implemented by this integration.

## Webhooks

The live app subscribes to:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.SALE.COMPLETED`
- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.EXPIRED`

The handler fetches each event from PayPal using the server's app credentials before
using it. It awaits fulfillment and returns an error if fulfillment fails so PayPal
can retry. It does not need a webhook-ID configuration key. Do not configure legacy
`/patron/ipn`; it rejects requests when its separate authentication key is unset.

## Verification and next deployment

Sandbox API/browser verification completed a $5 order, retried capture and confirmed
the same transaction ID, approved a $5 monthly subscription, retrieved its completed
first transaction, and cancelled the test subscription. No real funds were charged.
These provider checks do not substitute for a smoke test of the deployed website.

`PayPalJsonTest` covers actual capture amounts and statuses, monthly sale and
transaction response formats, pending first payments, and retained expiry after
cancellation. `PayPalPaymentStoreTest` exercises duplicate/concurrent delivery,
renewals, gifts, rollback after a user write, and replay using fresh service instances.
Run the Mongo test against an isolated disposable replica set:

```powershell
$env:LIXIANGQI_PAYPAL_TEST_URI = 'mongodb://127.0.0.1:27029/?replicaSet=paypaltest'
& .tools/jdk-21/jdk-21.0.11+10/bin/java.exe '-Dsbt.server.autostart=false' -jar .tools/sbt/sbt-launch-2.0.3.jar 'plan/test'
```

For this Windows host, Java's default Unix-domain temporary directory failed to
create selector pipes; the test command worked with a local directory specified as
`-Djdk.net.unixdomain.tmpdir=C:/Users/Travis Mallett/.codex/paypal-java-tmp` before
`-jar`. This is a test-host option, not a Linux production setting.

After the next normal `push-local-live` deployment:

1. Sign in at `https://lixiangqi.com/patron`; verify both one-time and monthly PayPal
   buttons appear and the revised FAQ is present.
2. Have a donor use a separate PayPal account for a small real donation, then confirm
   the merchant receipt, charge record, and Patron wings. A merchant cannot donate
   to their own account. Any real test payment requires that donor's authorization.
3. Verify webhook delivery in the live developer dashboard. For monthly testing,
   confirm the amount and next billing date, then cancel and verify paid wings remain.
4. Review the merchant name/contact details shown in the real checkout and receipt.

For another environment, create the REST app under its merchant, create a SERVICE
catalog product with ID `PATRON-MONTH`, and register the same events at that
environment's HTTPS `/patron/webhook`. The app creates currency-specific plans as
needed. Keep sandbox and live credentials, databases, and webhooks separate.

References: [PayPal Orders](https://developer.paypal.com/docs/api/orders/v2/),
[Subscriptions](https://developer.paypal.com/api/subscriptions/v1),
[Subscription transactions](https://developer.paypal.com/api/subscriptions/v1/subscriptions-transactions),
[Webhooks](https://developer.paypal.com/api/rest/webhooks/rest/).
