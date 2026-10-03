import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import quote, urlunsplit

from .client import Broadcaster, destination, snapshot


class NativeBroadcasterTest(unittest.TestCase):
    def test_full_destination_and_native_uri(self):
        url = "https://lixiangqi.org/broadcast/native/round-1/abcd1234"
        self.assertEqual(destination(url), ("https://lixiangqi.org", "abcd1234"))
        self.assertEqual(destination("lixiangqi-broadcaster://open?url=" + quote(url, safe="")), destination(url))
        credential_url = urlunsplit(("https", "user:secret@example.org", "/broadcast/a/b/abcd1234", "", ""))
        for bad in ["http://example.org/broadcast/native/one/abcd1234", credential_url, "https://example.org/analysis", url + "?token=private"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                destination(bad)

    def test_native_utf8_batches_preserve_complete_input(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = [Path(temp) / "one.pgn", Path(temp) / "two.pgn"]
            first = '[Red "甲"]\n\n1. a4a5 (1. h3e3) i10i9 {[%clk 0:01:00]} *'
            second = '[Black "乙"]\n\n1. 炮二平五 *'
            paths[0].write_text(first, encoding="utf-8-sig", newline="\n")
            paths[1].write_text(second, encoding="utf-8", newline="\n")
            self.assertEqual(snapshot(paths).decode(), first + "\n\n" + second)
            paths[1].write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "empty"):
                snapshot(paths)

    def test_real_http_retries_rejected_batch_and_deduplicates_only_acknowledged_input(self):
        received = []
        replies = [{"games": [{"error": "Illegal Xiangqi move"}]}, {"games": [{"moves": 2}]}]

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers["Authorization"], self.rfile.read(int(self.headers["Content-Length"]))))
                body = json.dumps(replies.pop(0)).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                # Send FIN before closing, avoiding a Windows reset that discards the response.
                self.connection.shutdown(socket.SHUT_WR)
                self.connection.settimeout(2)
                try:
                    self.connection.recv(1)
                except TimeoutError:
                    pass

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "native.pgn"
                path.write_text("1. a4a5 i10i9 *", encoding="utf-8")
                client = Broadcaster(f"http://127.0.0.1:{server.server_port}/broadcast/native/one/abcd1234", "test-secret", [path])
                with self.assertRaisesRegex(ValueError, "Illegal Xiangqi"):
                    client.tick()
                self.assertEqual(client.tick(), 1)
                self.assertIsNone(client.tick())
                self.assertEqual(len(received), 2)
                self.assertEqual(received[0], ("/api/broadcast/round/abcd1234/push", "Bearer test-secret", b"1. a4a5 i10i9 *"))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
