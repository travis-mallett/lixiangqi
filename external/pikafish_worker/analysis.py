"""Native study/game Fishnet worker and private external-engine provider.

Both transports use the existing persistent Pikafish UCI bridge. The application
owns rules, adjudication, resource budgets, and validation of submitted lines.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import logging
import os
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from tools.xiangqi_data.pikafish import Pikafish

LOG = logging.getLogger(__name__)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, endpoint: str, token: str | None = None):
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError("The endpoint must be an HTTP(S) URL")
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.opener = build_opener(NoRedirect())

    def post(self, path: str, value: dict):
        headers = {"Content-Type": "application/json", "User-Agent": "lixiangqi-worker/6.0.0"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = Request(self.endpoint + path, data=json.dumps(value).encode(), headers=headers, method="POST")
        with self.opener.open(request, timeout=45) as response:
            raw = response.read()
            return json.loads(raw) if raw else None


def external_snapshot(snapshot: dict) -> dict:
    def pv(line):
        score = line["score"]
        kind = "cp" if "cp" in score else "mate"
        return {kind: score["red" + kind.title()], "moves": line["pvMoves"]}
    return {"time": snapshot["timeMs"], "depth": snapshot["depth"], "nodes": snapshot["nodes"],
            "pvs": [pv(line) for line in snapshot["lines"]]}


def provide_external(client: Client, engine: Pikafish, job: dict, threads: int = 1, hash_mb: int = 128) -> None:
    work = job["work"]
    search = {key: work[key] for key in ("depth", "nodes", "movetime") if work.get(key) is not None}
    last_sent = 0.0
    path = "/api/external-engine/work/" + job["id"]
    stream = engine.search_stream(initial_fen=work["initialFen"], moves=work["moves"], search=search,
                                  legal_moves=work["legalMoves"], multi_pv=work["multiPv"],
                                  threads=min(work["threads"], threads), hash_mb=min(work["hash"], hash_mb))
    with contextlib.closing(stream):
        for snapshot in stream:
            done = snapshot["bestMove"] is not None
            now = time.monotonic()
            if done or now - last_sent >= 0.25:
                client.post(path, {"secret": job["secret"], "analysis": external_snapshot(snapshot), "done": done})
                last_sent = now


def analyse_game(client: Client, engine: Pikafish, job: dict, threads: int, hash_mb: int) -> None:
    moves = job["moves"].split()
    positions = job["positions"]
    if len(positions) != len(moves) + 1 or len(moves) > 600:
        raise ValueError("Server work does not describe the complete native game")
    if job["ruleset"] not in {"unrestricted-v1", "tiantian-v1"}:
        raise ValueError("Unsupported Xiangqi ruleset")
    evaluations: list[dict | None] = [None] * len(positions)
    skip = set(job["skipPositions"])
    last_sent = time.monotonic()
    path = "/fishnet/analysis/" + job["work"]["id"] + "?stop=true"
    metadata = {"name": "Pikafish", "version": engine.name, "nnue": True}
    # Work backwards so the mainline endpoint gains useful progress first.
    for index in reversed(range(len(positions))):
        position = positions[index]
        if index in skip:
            evaluations[index] = {"skipped": True}
        elif position["result"] != "*":
            score = {"cp": 0} if position["result"] == "1/2-1/2" else {"mate": 0}
            evaluations[index] = {"score": score, "pv": "", "depth": 0, "nodes": 0, "time": 0}
        else:
            stream = engine.search_stream(initial_fen=job["position"], moves=moves[:index],
                                          search={"nodes": job["work"]["nodes"]},
                                          legal_moves=position["legalMoves"], threads=threads, hash_mb=hash_mb)
            with contextlib.closing(stream):
                final = None
                for final in stream:
                    pass
            if final is None or final["bestMove"] is None:
                raise RuntimeError("Pikafish did not finish this position")
            line = final["lines"][0]
            score = line["score"]
            kind = "cp" if "cp" in score else "mate"
            evaluations[index] = {"score": {kind: score[kind]}, "pv": " ".join(line["pvMoves"]),
                                  "depth": line["depth"], "nodes": line["nodes"],
                                  "time": line["timeMs"], "nps": line["nps"]}
        if index == 0 or time.monotonic() - last_sent > 10:
            client.post(path, {"engine": metadata, "analysis": evaluations})
            last_sent = time.monotonic()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("fishnet", "external"))
    parser.add_argument("--endpoint", default=os.environ.get("LIXIANGQI_URL", "http://localhost:9663"))
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--hash", type=int, default=128, dest="hash_mb")
    parser.add_argument("--once", action="store_true", help="Process one acquired job, then exit")
    args = parser.parse_args()
    if not 1 <= args.threads <= 64 or not 1 <= args.hash_mb <= 16384:
        parser.error("Invalid worker thread or hash limit")
    secret_name = "LIXIANGQI_FISHNET_KEY" if args.mode == "fishnet" else "LIXIANGQI_ENGINE_PROVIDER_SECRET"
    secret = os.environ.get(secret_name)
    if not secret:
        parser.error(f"Set {secret_name} in the worker environment")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = Client(args.endpoint, secret if args.mode == "fishnet" else None)
    engine = Pikafish()
    if not engine.installed:
        parser.error(f"Pikafish is not installed at {engine.executable}")
    try:
        while True:
            job = None
            try:
                job = client.post("/fishnet/acquire" if args.mode == "fishnet" else "/api/external-engine/work/acquire",
                                  {} if args.mode == "fishnet" else {"providerSecret": secret})
                if not job:
                    time.sleep(1)
                    continue
                if args.mode == "fishnet":
                    analyse_game(client, engine, job, args.threads, args.hash_mb)
                else:
                    provide_external(client, engine, job, args.threads, args.hash_mb)
                LOG.info("Completed native analysis job")
                if args.once:
                    return
            except HTTPError as error:
                if error.code in {401, 403}:
                    raise RuntimeError("Worker credentials were rejected") from error
                LOG.warning("Analysis request failed with HTTP %s", error.code)
                if args.mode == "fishnet" and job:
                    client.post("/fishnet/abort/" + job["work"]["id"], {})
                elif job and error.code != 404:
                    client.post("/api/external-engine/work/" + job["id"], {
                        "secret": job["secret"], "done": True,
                        "error": "The engine returned analysis that does not satisfy the native rules or resource limits"})
                if args.once:
                    raise
                time.sleep(2)
            except (OSError, ValueError, RuntimeError) as error:
                LOG.error("Native analysis failed: %s", error)
                if args.mode == "fishnet" and job:
                    client.post("/fishnet/abort/" + job["work"]["id"], {})
                elif job:
                    client.post("/api/external-engine/work/" + job["id"], {
                        "secret": job["secret"], "done": True, "error": "The native engine could not complete this search"})
                if args.once:
                    raise
                time.sleep(5)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
