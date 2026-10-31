# Native homepage activity counters

The mobile and Kids applications use the same lila-ws `Presence` registry as
the website. Authenticated connections deduplicate by account across browsers
and apps. Guest sockets within one app process share a random visitor ID.
Counters describe connected activity, not lifetime games or puzzle attempts.

- Native matchmaking reports `presence` on its existing lobby socket. Active
  homepage searches use the pool ID; custom searches use `lobby` and `other`.
  Browsing rooms without searching does not count, matching the web lobby.
- Native games receive `presence` and `presenceGroup` in every game state.
  `lila.core.game.GamePresence` owns classification for both web and mobile:
  homepage time controls, custom games, friends, AI, and finished games.
- Puzzle playback in both apps and friend challenges in the main app use a
  dedicated presence socket. Kids' unimplemented game/bot buttons and puzzle
  journey maps do not claim activity.
- `/api/mobile/auth/config` provides `presenceSocketUrl`. The gateway endpoint
  `/mobile/presence` accepts anonymous visitors or bearer credentials with
  `mobile:play`, `puzzle:read`, or `puzzle:write`. It accepts only text heartbeat
  and presence messages. Credentials stay in the upgrade header. Invalid
  supplied credentials cannot silently become anonymous presence.
- Native presence stops on route coverage, backgrounding, disposal, and account
  changes. Reconnect restores the latest activity. Heartbeat deadlines close
  stalled connections; the gateway's existing broom expires abandoned sockets.
  Presence failures never block gameplay or puzzle result synchronization.

## Rollout

Deploy the backend and canonical `scripts/windows/lila-ws-xiangqi.patch` before
releasing both app builds. `push-local-live.ps1` already hashes, prepares, builds,
and packages this patch, so no deployment-tool change or migration is needed.
Existing native puzzle/play scopes suffice; no new sign-in permission is added.
Older backends do not supply the presence endpoint and will not count the new
native puzzle/game presence until deployment.

## Verification

`GamePresenceTest` checks shared game classification and completed-game removal.
Gateway `PresenceTest` covers web/mobile/Kids account deduplication and cleanup;
`MobilePlayAuthTest` checks endpoint scopes and message restrictions. Flutter
presence tests cover token placement, heartbeat loss, reconnects, late upgrades,
route coverage, background/resume, and disposal; lobby tests cover searches,
cancellation, reconnect, and suspension.
