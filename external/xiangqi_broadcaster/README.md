# LiXiangQi Broadcaster

The native companion watches UTF-8 Xiangqi score files produced by board software
or a score editor. It sends complete batches to the canonical broadcast push API;
the server owns rules, notation, game matching, broadcast delays and permissions.
The companion contains no chess parser or second rules implementation. Multiple
selected files are submitted atomically. A rejected batch is reported and retried,
never recorded as successfully uploaded. Unchanged accepted data uses no network.

Build the downloadable Python 3.11+ application with
`python tools/build_broadcaster.py`. Run the resulting
`public/downloads/lixiangqi-broadcaster.pyz` with Python. The desktop interface uses
Tk (included with the standard Windows/macOS Python installer). Enter a complete
round URL, an access token with `study:write`, and select the score files. Tokens
remain in memory and are never written to a config file, log, URI or command line.

On Windows, `python lixiangqi-broadcaster.pyz --install-protocol` registers the
`lixiangqi-broadcaster://open?url=<encoded full round URL>` handler for the current
account. Launching a link opens the configuration window; it does not start an
upload. The full server origin is retained. HTTPS is required outside loopback,
and redirects are refused to prevent credential forwarding.

For unattended operation on any supported Python platform, set
`LIXIANGQI_BROADCAST_TOKEN` privately and run:

```
python -m external.xiangqi_broadcaster --headless https://HOST/broadcast/EVENT/ROUND/ROUND_ID --file board1.pgn --file board2.pgn
```

Use `--once` for an explicit one-shot upload. Stop with Ctrl+C. Native coordinate,
WXF and Chinese moves all use the same server notation parser, including comments,
variations, clocks, results and chapter metadata. Input is bounded to 2 MB and
partial file writes are retried. Hardware that produces only chess positions must
provide a native Xiangqi score export before it can supply this client.
