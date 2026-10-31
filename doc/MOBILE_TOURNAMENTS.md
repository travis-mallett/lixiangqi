# Native mobile tournaments

The independent Flutter app consumes the canonical `/tournament` system. Native
discovery and forms are projections of existing pagers and form mappings in
`controllers.Tournament`; pairing, eligibility, scoring, chat and persistence stay
in their existing modules. Swiss and staff tournament administration are separate
surfaces and remain unchanged.

## API and authentication

- `GET /api/mobile/tournaments` selects `home`, `calendar`, `history`, `winners`,
  `shields`, `created`, `upcoming`, `recent`, `best` or `chart`, with existing
  `page`, `freq` and optional `user` parameters. Upcoming joined events are
  restricted to their account owner.
- `GET /api/mobile/tournament/form?id=…` requires `tournament:write` and returns
  the original form data, choices and team-leader permissions. Sensitive values
  use `Cache-Control: no-store`.
- `POST /api/mobile/tournament/:id` requires `tournament:write` and applies the
  same full replacement as the website form. Blank optional fields can be
  cleared. The existing public partial-update API keeps its existing semantics.
- Creation, join, withdrawal, team editing, termination and exports reuse the
  existing tournament APIs and their authorization/validation.
- The full tournament JSON includes ruleset, rendered description, password
  requirement, editing permission and the configured socket URL. Chat writing
  reflects authentication, lock and timeout state. Detailed standings/player/team
  routes accept OAuth identity for the existing visibility checks.
- Native token creation and browser-provider scopes include `tournament:write`.
  This grants neither `web:mobile`, staff access, nor gameplay access by itself.
  Kid-mode restrictions remain in force. Existing native tokens need a new sign-in.

## Pairing and gameplay

The canonical `lila-ws-xiangqi.patch` permits raw bearer credentials only on the
exact tournament room path `/tournament/<8-character-id>/socket/v5`, requiring
`tournament:write`. Invalid credentials fail the connection rather than silently
entering as a guest. Existing signature behavior and other socket scopes remain
unchanged. The app implements room heartbeats, versioned events, reconnects and
foreground waiting presence; it closes that presence while another screen or
game covers the room.

Games use the existing `mobile:play` endpoints. Mobile state includes the
tournament ID and current berserk eligibility. The berserk command uses the
existing tournament/round bus and validation. A `BoardBerserk` event refreshes
the shared game-state stream immediately; per-side increments use the clock's
actual increment after berserk. No pairing or clock rules are calculated in the
app.

## Deployment

Release the application and socket gateway together before shipping the app.
The existing `Z:/Work/Scripts/lixiangqi-beta-deployment/push-local-live.ps1`
entry point prepares the canonical patch and incorporates its hash into the
socket build fingerprint. It already rebuilds both affected runtimes, including
the shared game/round modules. No deployment-script change, new environment
variable, dependency, database migration or data conversion is required.

This task prepares code only; it does not deploy or modify live tournaments.

## Verification

Tournament tests cover the full-form optional-field clearing and frozen clock
semantics. `MobileTournamentScopeTest` checks narrow permissions and
`KidModeScopeTest` checks restricted-token behavior. The gateway's
`MobilePlayAuthTest` covers tournament path scoping, malformed paths and invalid
credentials. Shared game/round tests cover affected clock behavior.

Flutter repository `doc/TOURNAMENTS.md` records the feature matrix, native
transport/controller/widget tests and release acceptance checks. Device testing
with two accounts and live pairing remains a release check; no iOS build can be
verified on Windows.
