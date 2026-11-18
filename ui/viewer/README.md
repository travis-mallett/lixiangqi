# Shared Xiangqi viewer and embeds

`@lixiangqi/viewer` composes the board with a replay panel: the tree-view move list, variations, comments, keyboard controls, and navigation buttons. It uses the same native notation API and explorer as LiXiangQi. It contains no independent board renderer or rules engine.

One presentation serves every host. A host wide enough for both columns shows the board beside a panel whose move list is exactly as tall as the board; narrower hosts stack the panel under the board. The move list is the shared `lib/tree/columnView` tree view, so a viewer reads like the analysis, study, and wiki boards. An example with comments reserves space for notes. Annotated moves carry a note icon and an accessible label. The display board leaves swipes to the browser, so readers can scroll the host page from the board. The widget is white: it renders the light theme and never offers per-board settings such as flip, sound, or board and piece theme.

`mountViewer(element, source, options, signal)` accepts native imported trees, PGN/WXF/Chinese notation, or `initialFen` plus recorded coordinate moves. `GameViewer.destroy()` releases board and attached feature resources. Callers must abort pending mounts when their container is removed.

The analysis page's **Embed your game** action creates an iframe at `/embed/xiangqi`. The encoded fragment contains article/game content, not executable configuration. Existing `/embed/analysis` and game/study routes use the same viewer. Add `?explorer=1` to the generic embed URL to enable the shared explorer toggle; its endpoint remains controlled by the server.

The host owns the iframe size. The viewer posts `{ type: 'xiangqi-embed:height', height }` to the parent after layout changes and on `pageshow`. Validate the message against the iframe's window and origin before resizing it. Back/Forward through the browser's back-forward cache preserves the live viewer and its selected move. A fresh load starts from the example's configured ply.

Embeds use the deployed LiXiangQi asset catalog and code. Updating themes or board motion requires one normal LiXiangQi deployment. Embeds start muted and never read or write account or browser appearance preferences: a hosting site chooses the appearance for all of its boards at once with the `uiTheme`, `boardTheme`, and `pieceSet` query parameters. Standalone widgets do not load the full site bundle or open a game WebSocket. Short repeated notation imports have a small expiring server cache, while longer imports remain bounded by native parser limits.

Xiangqipedia renders the caption in MediaWiki and mounts the first iframe eagerly. Later frames use native lazy loading. The wiki's `XiangqiBoardsEmbedUrl` setting selects the viewer URL.

The iframe is a public rendering service, so a hosting website depends on LiXiangQi availability. Already loaded examples play locally. No public package publication, standalone distribution, additional account system, or new variant rules are included.
