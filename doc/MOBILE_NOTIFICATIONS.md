# Mobile notifications API

The shared mobile notification center replaces the former forum-only notification
and activity endpoints. Deploy this backend together with the new mobile client.
No existing public website notification route changes. No data migration, index,
worker, service configuration or native push credential is added. The normal
backend build and restart handles deployment.

`mobile:notifications` grants read/acknowledge access to the authenticated user's
notification store and activity timeline. It does not authorize inbox contents,
forum mutations or account administration. Native account token creation includes
the scope; browser OAuth clients request it explicitly. Previously issued mobile
tokens require sign-out/sign-in to obtain it.

- `GET /api/mobile/notifications?page=N` returns the standard notification pager,
  unread total and `unreadByType` counts over all unexpired unread notifications,
  including rows outside the page. Pages are bounded to 1–100.
- `POST /api/mobile/notifications/:id/read` marks only this recipient's matching
  notification read. Repeated acknowledgement is harmless; another recipient's
  ID cannot change their state. Read changes use the existing unread-count cache
  invalidation path.
- `GET /api/mobile/activity?page=N` returns `entries` and `nextPage`, 20 rows/page,
  newest first with stable tie-breaking, up to 50 pages within the existing
  two-week retention window. Existing audience/subscription filters apply.

Both notification and timeline JSON include stable `id` fields. Activity has no
server unread status; the app maintains device-local acknowledgements. The
existing active-game preview additionally exposes opponent `drawOffer` and
`takebackOffer` flags so the shared mobile module can surface actionable offers.
The app reads pending challenges and inbox unread counts through their existing
scoped APIs. Account notifications still obey existing delivery preferences.

The retired `/forum/notifications`, `/forum/notifications/read` and
`/forum/activity` endpoints and their filtered repositories have been removed.
Topic muting remains on the existing forum-scoped timeline unsubscribe endpoint.
The app consumes public official-blog and update feeds without credentials.

This is foreground in-app delivery. The existing server push bus/APNs/FCM
integration is unchanged; this mobile client does not register a background push
device. Transient push-only events such as accepted challenges or a tournament
starting are not a durable notification history. Accepted games remain available
in active games, and game offers are available in the game view as well as the
shared center.

Verification includes notification JSON identifiers, isolated scope registration,
Scala formatting, backend tests and staging compilation. Client coverage and
lifecycle semantics are documented in the mobile repository's
`doc/NOTIFICATIONS.md`.
