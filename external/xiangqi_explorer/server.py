"""Read-only HTTP entry point for the independently deployed Xiangqi explorer."""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from .catalog_databases import catalog_is_readable
from .explorer import explore_games
from .game_catalog import (
    get_game,
    query_ancient_manuals,
    query_event,
    query_games,
    query_player,
)


class ExplorerServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False


class ExplorerHandler(BaseHTTPRequestHandler):
    server_version = "LixiangqiExplorer/1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            try:
                readable = catalog_is_readable()
            except Exception:
                readable = False
            status = HTTPStatus.OK if readable else HTTPStatus.SERVICE_UNAVAILABLE
            self._json(
                status,
                {
                    "ok": readable,
                    "system": "xiangqi-explorer",
                    **({} if readable else {"error": "games database unavailable"}),
                },
            )
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        routes: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "/explorer": self._explore,
            "/games": query_games,
            "/games/ancient-manuals": query_ancient_manuals,
            "/games/event": query_event,
            "/games/player": query_player,
            "/games/game": get_game,
        }
        action = routes.get(self.path)
        if action is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            self._json(HTTPStatus.OK, action(self._read_json()))
        except (ValueError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception:
            import traceback

            self.log_error("explorer request failed\n%s", traceback.format_exc())
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "explorer unavailable"})

    @staticmethod
    def _explore(body: dict[str, Any]) -> dict[str, Any]:
        fen = body.get("fen")
        if not isinstance(fen, str) or len(fen) > 200:
            raise ValueError("fen must be a Xiangqi FEN string")
        return explore_games(fen, body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 1_000_000:
            raise ValueError("request body length is invalid")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("request body must be a JSON object")
        return body

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=5")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the read-only Xiangqi explorer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9002)
    args = parser.parse_args()
    server = ExplorerServer((args.host, args.port), ExplorerHandler)
    print(f"Xiangqi explorer listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
