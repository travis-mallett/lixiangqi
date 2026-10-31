"""Public catalog reads and authenticated internal player-profile writes."""

from __future__ import annotations

import argparse
import json
import hmac
import os
import threading
from pathlib import Path
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from .catalog_databases import catalog_is_readable
from . import player_catalog
from tools.games_database import players
from .explorer import explore_games, master_book_moves
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
        if self.path == '/internal/players':
            token = os.environ.get('LIXIANGQI_PLAYER_TOKEN', '')
            if token_file := os.environ.get('LIXIANGQI_PLAYER_TOKEN_FILE'):
                token = Path(token_file).read_text().strip()
            if not token or not hmac.compare_digest(self.headers.get('Authorization', ''), f'Bearer {token}'):
                self._json(HTTPStatus.FORBIDDEN, {'error': 'forbidden'})
                return
            try:
                self._json(HTTPStatus.OK, player_catalog.write(self._read_json()))
            except ValueError as error:
                self._json(HTTPStatus.BAD_REQUEST, {'error': str(error)})
            except Exception:
                self.log_error('Player catalog update failed')
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {'error': 'player update failed'})
            return
        routes: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            '/players': player_catalog.read,
            "/explorer": self._explore,
            "/opening-book": self._opening_book,
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
    def _opening_book(body: dict[str, Any]) -> dict[str, Any]:
        fen = body.get("fen")
        if not isinstance(fen, str) or not fen.strip() or len(fen) > 200:
            raise ValueError("fen must be a Xiangqi FEN string")
        return {"moves": master_book_moves(fen)}

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
        self.send_header("Cache-Control", "no-store" if self.path.startswith('/internal/') else "public, max-age=5")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Xiangqi catalog service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9002)
    args = parser.parse_args()
    server = ExplorerServer((args.host, args.port), ExplorerHandler)
    stop = threading.Event()

    def maintain_players() -> None:
        while not stop.is_set():
            try:
                with closing(players.connect()) as db, db:
                    players.refresh_stats(db)
            except Exception:
                import traceback
                traceback.print_exc()
            stop.wait(60)

    maintenance = threading.Thread(target=maintain_players, daemon=True)
    maintenance.start()
    print(f"Xiangqi explorer listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        maintenance.join(timeout=30)
        server.server_close()


if __name__ == "__main__":
    main()
