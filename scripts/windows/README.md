# Windows local preview

Double-click `Start Lixiangqi.cmd` in the repository root. It starts local
MongoDB and Redis, the native Lila websocket service, the read-only Xiangqi
explorer, the Pikafish Fishnet move worker, and the full Lixiangqi application.
It then opens `http://lixiangqi.localhost:9663`, a trusted loopback origin that
allows the browser Pikafish engine to use shared memory.

All processes bind to the local machine. Runtime data is under `data/local`,
generated assets are under `public`, and diagnostic output is under `logs`.
When `data/local/xiangqi-puzzle-mining.sqlite3` exists, the launcher
synchronizes its accepted puzzles and selector paths into Lila. Source games
remain in their independent read-only catalog databases and are resolved there
by the puzzle player.

For a non-interactive check without opening a browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\Start-Lixiangqi.ps1 -NoBrowser
```

Pass `-LanAccess` to serve the site at this computer's local-network address.
Plain HTTP LAN origins cannot expose `SharedArrayBuffer`, so browser Pikafish
analysis requires the default loopback mode or a trusted HTTPS proxy.
