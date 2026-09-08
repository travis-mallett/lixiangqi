# Video library

Lixiangqi stores video catalog records in MongoDB and embeds the original media
from YouTube or Bilibili. It does not upload, proxy, or stream video files.

## Administration

Accounts with the `MANAGE_VIDEOS` permission see **Add video**, **Manage videos**,
and **Reorder** controls on `/video`. The permission is included in the built-in
Admin role and can also be granted independently. Every admin endpoint enforces
this permission on the server; hiding the controls is only a convenience.

Add a video by pasting a YouTube or Bilibili URL. **Fetch details** previews the
provider metadata and fills empty title, author, and description fields. Editors
can then set tags, skill levels, language, start time, paid-promotion disclosure,
and Draft or Published status. Draft and Archived videos never appear in public
lists or search. Archiving is the intentionally recoverable delete operation.

The management page supports text and status filters, highlights unavailable or
failed metadata, and provides publish/unpublish actions. The reorder page changes
the default order of published videos by drag-and-drop or keyboard-accessible
move buttons. Create, edit, status, refresh, and reorder operations are recorded
in the moderation log.

## Deployment

For an existing installation, deploy the application code first—the BSON reader
remains compatible with legacy video documents—then run
`bin/mongodb/video-cms-migration.js` once against the main database. The migration
adds provider, publication, ordering, and metadata-health fields and replaces the
legacy indexes. Fresh databases receive these indexes from
`bin/mongodb/indexes.js`.

The adjacent beta deployment workspace's `push-local-live.cmd` packages and
applies this migration automatically while application writers are stopped. It
backs up only the video collection, verifies the backup and migration, and
restores the original namespace if activation or readiness checks fail. Other
deployment methods should run the migration with equivalent maintenance and
rollback protection.

`video.youtube.api_key` is optional. When empty, YouTube metadata uses the public
oEmbed endpoint (title, author, and thumbnail only). Configure the key to also
retrieve description, duration, publish date, and availability. Bilibili uses its
public metadata endpoint configured by `video.bilibili.url`. In production, up to
`video.metadata.refresh_max` of the oldest published metadata records are refreshed
daily.
