# Shared Xiangqi viewer and embeds

`@lixiangqi/viewer` composes the board with navigation, move variations, annotations, keyboard controls, flip, optional sound, and theme controls. It uses the same native notation API and explorer as LiXiangQi. It contains no independent board renderer or rules engine.

`mountViewer(element, source, options, signal)` accepts native imported trees, PGN/WXF/Chinese notation, or `initialFen` plus recorded coordinate moves. `GameViewer.destroy()` releases board/audio/feature resources. Callers must abort pending mounts when their container is removed.

The analysis page's **Embed your game** action creates an iframe at `/embed/xiangqi`. The encoded fragment contains article/game content, not executable configuration. Existing `/embed/analysis` and game/study routes use the same viewer. Add `?explorer=1` to the generic embed URL to enable the shared explorer toggle; its endpoint remains controlled by the server.

Embeds use the deployed LiXiangQi asset catalog and code. Updating themes or board motion requires one normal LiXiangQi deployment. Embeds have local controls and start muted; they do not read or write account or browser appearance preferences. Standalone widgets do not load the full site bundle or open a game WebSocket. Short repeated notation imports have a small expiring server cache, while longer imports remain bounded by native parser limits.

The private Xiangqipedia extension only emits a caption and a lazy iframe, passing the existing recorded article data. Configure its `XiangqiBoardsEmbedUrl` to point at the desired LiXiangQi deployment. The normal deployment script packages the changed extension. Wiki revisions remain authoritative and unchanged.

The iframe is a public rendering service, so a hosting website depends on LiXiangQi availability. Already loaded examples play locally. No public package publication, standalone distribution, additional account system, or new variant rules are included.
