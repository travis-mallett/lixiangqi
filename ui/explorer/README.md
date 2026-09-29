# Shared Xiangqi explorer

`@lixiangqi/explorer` owns the opening database controller, request types, and view used by analysis, player/event pages, and optional embeds. It is separate from board rendering and replay navigation. Hosts supply position changes and callbacks for selecting a move or game.

Call `destroy()` on removal. Embeds pass `persistPreferences: false` so they do not read/write account browser settings. Database requests are aborted when superseded or disposed. Styling lives in `css/` and is imported by each host bundle.
