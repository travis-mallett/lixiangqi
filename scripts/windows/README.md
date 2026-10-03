# Windows local preview

Double-click `Start Lixiangqi.cmd` in the repository root. It starts local
MongoDB and Redis, the native Lila websocket service, the read-only Xiangqi
explorer, the Pikafish move worker, the native Xiangqi image exporter, and the full Lixiangqi application.
It then opens `http://lixiangqi.localhost:9663`, a trusted loopback origin that
allows the browser Pikafish engine to use shared memory.

All processes bind to the local machine. Runtime data is under `data/local`,
generated assets are under `public`, and diagnostic output is under `logs`.
The launcher refreshes the disposable preview from a verified production
snapshot, preserving a backup of existing preview content before replacement.
It then applies the native study and analysis schemas while writers remain
stopped. Source games remain in their independent read-only catalog databases.

Set `LIXIANGQI_FISHNET_KEY` to a key registered in the preview database to run
the native server-analysis worker. With no key, startup reports that the local
worker is unconfigured. Browser analysis and other services remain available.
`-StopOnly` stops the application, gateway, explorer, image exporter and both
Pikafish worker modes using process ownership checks.

For a non-interactive check without opening a browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\Start-Lixiangqi.ps1 -NoBrowser
```

Pass `-LanAccess` to serve the site at this computer's local-network address.
Plain HTTP LAN origins cannot expose `SharedArrayBuffer`, so browser Pikafish
analysis requires the default loopback mode or a trusted HTTPS proxy.
