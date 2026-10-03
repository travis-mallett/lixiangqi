# Shared Xiangqi viewer and embeds

`@lixiangqi/viewer` composes the board with a replay panel: the tree-view move list, variations, comments, keyboard controls, and navigation buttons. It uses the same native notation API and explorer as LiXiangQi. It contains no independent board renderer or rules engine.

One presentation serves every host. A host wide enough for both columns shows the board beside a panel whose move list is exactly as tall as the board; narrower hosts stack the panel under the board. The move list is the shared `lib/tree/columnView` tree view, so a viewer reads like the analysis, study, and wiki boards. An example that carries annotations always keeps its note box in that place, so navigating never moves the list or the controls. The widget is white: it renders the light theme and never offers per-board settings such as flip, sound, or board and piece theme.

`mountViewer(element, source, options, signal)` accepts native imported trees, PGN/WXF/Chinese notation, or `initialFen` plus recorded coordinate moves. `GameViewer.destroy()` releases board/audio/feature resources. Callers must abort pending mounts when their container is removed.

The analysis page's **Embed your game** action creates an iframe at `/embed/xiangqi`. The encoded fragment contains article/game content, not executable configuration. Existing `/embed/analysis` and game/study routes use the same viewer. Add `?explorer=1` to the generic embed URL to enable the shared explorer toggle; its endpoint remains controlled by the server.

A hosting page owns the iframe size, and the widget's height depends on its width, so an embedded viewer posts `{ type: 'xiangqi-embed:height', height }` to its parent whenever that height changes. A host that listens can size the frame to the rendered board instead of reserving a fixed height and leaving empty space; a host that ignores the message keeps its own fixed size.

Embeds use the deployed LiXiangQi asset catalog and code. Updating themes or board motion requires one normal LiXiangQi deployment. Embeds start muted and never read or write account or browser appearance preferences: a hosting site chooses the appearance for all of its boards at once with the `uiTheme`, `boardTheme`, and `pieceSet` query parameters. Standalone widgets do not load the full site bundle or open a game WebSocket. Short repeated notation imports have a small expiring server cache, while longer imports remain bounded by native parser limits.

The private Xiangqipedia extension only emits a caption and a lazy iframe, passing the existing recorded article data. Configure its `XiangqiBoardsEmbedUrl` to point at the desired LiXiangQi deployment. The normal deployment script packages the changed extension. Wiki revisions remain authoritative and unchanged.

The iframe is a public rendering service, so a hosting website depends on LiXiangQi availability. Already loaded examples play locally. No public package publication, standalone distribution, additional account system, or new variant rules are included.
