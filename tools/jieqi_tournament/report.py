"""Reports use whole six-game deals so every engine faces the same opposition."""

import json
import random
from collections import Counter, defaultdict
from html import escape
from pathlib import Path

ENGINES = ("abjchess", "jqe", "pikajieqi")
NAMES = {"abjchess": "AB-JChess", "jqe": "jqe", "pikajieqi": "PikaJieQi"}
RESULTS = {"1-0": 1.0, "1/2-1/2": 0.5, "0-1": 0.0}


def score(game, engine):
    red = RESULTS[game["result"]]
    return red if game["red"] == engine else 1 - red


def bootstrap(values, seed=20261102, samples=10000):
    """Percentile interval, resampling independent deals rather than correlated games."""
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    n = len(values)
    means = sorted(sum(rng.choices(values, k=n)) / n for _ in range(samples))
    return [means[int(samples * 0.025)], means[int(samples * 0.975) - 1]]


def statistics(games, engine, clusters):
    scores = [score(game, engine) for game in games]
    return {
        "games": len(scores), "wins": scores.count(1.0), "draws": scores.count(0.5),
        "losses": scores.count(0.0), "score": sum(scores) / len(scores) if scores else None,
        "winRate": scores.count(1.0) / len(scores) if scores else None,
        "score95": bootstrap(clusters),
    }


def summarize(games, expected_deals):
    grouped = defaultdict(list)
    for game in games:
        if game.get("status") == "completed":
            if game.get("result") not in RESULTS:
                raise ValueError("Completed game has no valid result")
            grouped[game["dealIndex"]].append(game)
    expected = {(a, b) for a in ENGINES for b in ENGINES if a != b}
    complete = {}
    for deal, group in grouped.items():
        combinations = [(g["red"], g["black"]) for g in group]
        if len(combinations) != len(set(combinations)):
            raise ValueError("Duplicate game in deal")
        if set(combinations) == expected:
            complete[deal] = group
    balanced = [g for group in complete.values() for g in group]
    rows = {}
    pairwise = {}
    for engine in ENGINES:
        relevant = [g for g in balanced if engine in (g["red"], g["black"])]
        clusters = [sum(score(g, engine) for g in group if engine in (g["red"], g["black"])) / 4
                    for group in complete.values()]
        rows[engine] = statistics(relevant, engine, clusters)
        for opponent in ENGINES:
            if engine >= opponent:
                continue
            pair = [g for g in relevant if opponent in (g["red"], g["black"])]
            paired = [sum(score(g, engine) for g in group if {g["red"], g["black"]} == {engine, opponent}) / 2
                      for group in complete.values()]
            pairwise[f"{engine} vs {opponent}"] = statistics(pair, engine, paired)
    return {
        "plannedDeals": expected_deals, "completeDeals": len(complete),
        "includedGames": len(balanced), "savedGames": len(games),
        "excludedGames": len(games) - len(balanced),
        "complete": len(complete) == expected_deals,
        "preliminary": len(complete) < 30,
        "intervalMethod": "95% percentile bootstrap of complete six-game deals; 10000 resamples; seed 20261102",
        "engines": rows, "pairwise": pairwise,
        "terminations": dict(Counter(g.get("termination") for g in balanced)),
    }


def chart(summary, config):
    if summary["includedGames"] == 0:
        return None
    total = summary["includedGames"]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">',
             '<rect width="1600" height="1000" fill="#f7f8f5"/>',
             '<g font-family="Segoe UI,Arial,sans-serif" fill="#25322c">',
             '<text x="80" y="100" font-size="48" font-weight="650">Three Jieqi engines, tested on LiXiangQi rules</text>',
             f'<text x="80" y="155" font-size="28">{total} games · {config["movetime"] / 1000:g} s/move · 1 thread per engine · shipped WebAssembly builds in Node.js</text>',
             '<text x="80" y="212" font-size="28">Match score against the other two engines (win = 1, draw = ½, loss = 0)</text>']
    for tick in range(0, 101, 25):
        x = 350 + 9.4 * tick
        parts += [f'<path d="M{x} 265 V710" stroke="#d4dacd"/>',
                  f'<text x="{x}" y="752" text-anchor="middle" font-size="25">{tick}%</text>']
    for index, engine in enumerate(ENGINES):
        row = summary["engines"][engine]
        y = 310 + index * 150
        x = 350 + row["score"] * 940
        parts += [f'<text x="80" y="{y + 40}" font-size="32" font-weight="600">{escape(NAMES[engine])}</text>',
                  f'<rect x="350" y="{y}" width="{x - 350:.2f}" height="60" fill="#648c36"/>',
                  f'<text x="1330" y="{y + 40}" font-size="35" font-weight="600">{row["score"] * 100:.1f}%</text>',
                  f'<text x="350" y="{y + 100}" font-size="24">{row["wins"]} wins · {row["draws"]} draws · {row["losses"]} losses</text>']
        if row["score95"]:
            low, high = [350 + v * 940 for v in row["score95"]]
            parts.append(f'<path d="M{low:.2f} {y + 30} H{high:.2f} M{low:.2f} {y + 17} V{y + 43} M{high:.2f} {y + 17} V{y + 43}" fill="none" stroke="#15251c" stroke-width="3"/>')
    label = "PRELIMINARY · " if summary["preliminary"] or not summary["complete"] else ""
    parts += [f'<text x="80" y="836" font-size="26">{label}{summary["completeDeals"]} matched deals; each engine plays both colors against each opponent.</text>',
              '<text x="80" y="885" font-size="25">Whiskers: 95% deal-bootstrap intervals. These results describe this test, not universal engine strength.</text>',
              '<text x="80" y="934" font-size="25">Source: LiXiangQi tournament game records · Equal opponents and time budgets · No evaluation adjudication</text>',
              '</g></svg>']
    return "\n".join(parts)


def write_report(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    games = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((directory / "games").glob("*.json"))]
    planned = manifest["config"]["deals"]
    summary = summarize(games, planned)
    if planned is None:
        summary["complete"] = summary["excludedGames"] == 0
        summary["continuous"] = True
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    graphic = chart(summary, manifest["config"])
    if graphic:
        (directory / "results.svg").write_text(graphic, encoding="utf-8")
    return summary
