"""Plain CSV rankings and nearest-unused-candidate level proposals."""

import csv
import json
import statistics
from itertools import pairwise
from pathlib import Path

from .store import snapshot

FIELDS = [
    "bot id",
    "Elo",
    "games",
    "wins",
    "draws",
    "losses",
    "nodes",
    "MultiPV",
    "expectedRank",
    "maxCandidateLoss",
]


def values(bot):
    return dict(
        zip(
            FIELDS,
            (
                bot.id,
                bot.elo,
                bot.games,
                bot.wins,
                bot.draws,
                bot.losses,
                bot.nodes,
                bot.MultiPV,
                bot.expectedRank,
                bot.maxCandidateLoss,
            ),
            strict=True,
        )
    )


def write_csv(path, fields, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def export(path, output):
    bots, counts = snapshot(path)
    ranked = sorted(bots, key=lambda b: (-b.elo, b.id))
    write_csv(
        output,
        ["rank", *FIELDS],
        [{"rank": i, **values(b)} for i, b in enumerate(ranked, 1)],
    )
    return {
        "totalGamesCompleted": counts.get("completed", 0),
        "totalBots": len(bots),
        "gameStatuses": counts,
        "ratingRange": [ranked[-1].elo, ranked[0].elo],
        "medianGamesPerBot": statistics.median(b.games for b in bots),
        "minimumGamesPerBot": min(b.games for b in bots),
        "maximumGamesPerBot": max(b.games for b in bots),
        "weakestBotProfile": values(ranked[-1]),
        "strongestBotProfile": values(ranked[0]),
    }


def propose(bots, count=720, gap_threshold=25):
    if count < 2 or len(bots) < count:
        raise ValueError(f"Need at least {count} distinct candidates")
    by_id = {b.id: b for b in bots}
    low, high = by_id["endpoint-low"], by_id["endpoint-high"]
    if high.elo <= low.elo:
        raise ValueError(
            "Endpoint Elo span is not positive; play more games before proposing levels"
        )
    remaining = [b for b in bots if b.id not in {low.id, high.id}]
    rows = []
    for level in range(1, count + 1):
        target = low.elo + (high.elo - low.elo) * (level - 1) / (count - 1)
        if level == 1:
            bot = low
        elif level == count:
            bot = high
        else:
            bot = min(remaining, key=lambda b: (abs(b.elo - target), b.id))
            remaining.remove(bot)
        rows.append(
            {
                "level": level,
                **values(bot),
                "target Elo": target,
                "Elo error": bot.elo - target,
            }
        )
    ordered = sorted(
        [b for b in bots if low.elo <= b.elo <= high.elo], key=lambda b: b.elo
    )
    gaps = [
        {"from": a.elo, "to": b.elo, "gap": b.elo - a.elo}
        for a, b in pairwise(ordered)
        if b.elo - a.elo > gap_threshold
    ]
    warnings = {
        "productionDeployment": False,
        "gapThreshold": gap_threshold,
        "largePoolGaps": gaps,
        "distantTargets": [
            r["level"] for r in rows if abs(r["Elo error"]) > gap_threshold
        ],
        "unratedSelectedBots": [r["bot id"] for r in rows if not r["games"]],
        "ratingReversals": [
            b["level"] for a, b in pairwise(rows) if b["Elo"] < a["Elo"]
        ],
        "botsOutsideEndpointSpan": sum(not low.elo <= b.elo <= high.elo for b in bots),
        "maximumAbsoluteEloError": max(abs(r["Elo error"]) for r in rows),
    }
    return rows, warnings


def levels(path, output, count=720, gap_threshold=25):
    bots, _ = snapshot(path)
    rows, warnings = propose(bots, count, gap_threshold)
    write_csv(output, ["level", *FIELDS, "target Elo", "Elo error"], rows)
    Path(str(output) + ".summary.json").write_text(
        json.dumps(warnings, indent=2), encoding="utf-8"
    )
    return warnings
