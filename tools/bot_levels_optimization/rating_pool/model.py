"""Candidate generation, ordinary Elo, and nearby-rating matchmaking."""

import math
import random
from dataclasses import asdict, dataclass

from external.pikafish_worker.ai import StrengthProfile

from ..profiles import HIGH, LOW, validate_endpoints


@dataclass
class Bot:
    id: str
    nodes: int
    MultiPV: int
    expectedRank: float
    maxCandidateLoss: int | None
    elo: float = 1500.0
    games: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    lastOpponent: str | None = None

    def profile(self):
        return StrengthProfile(
            self.nodes, self.MultiPV, self.expectedRank, self.maxCandidateLoss
        )

    def row(self):
        return asdict(self)


def generate(count: int, seed: int):
    if count < 2:
        raise ValueError("At least two bots are required")
    validate_endpoints()
    bots = [
        Bot(name, p.nodes, p.multi_pv, p.expected_rank, p.max_candidate_loss)
        for name, p in (("endpoint-low", LOW), ("endpoint-high", HIGH))
    ]
    rng = random.Random(seed)
    seen = {tuple(asdict(b.profile()).values()) for b in bots}
    while len(bots) < count:
        # Independent settings explore the parameter space rather than assuming a strength curve.
        nodes = round(LOW.nodes * (HIGH.nodes / LOW.nodes) ** rng.random())
        multipv = rng.randint(1, 16)
        rank = round(rng.uniform(1, min(9, multipv)), 6)
        loss = rng.randint(0, 600)
        key = (nodes, multipv, rank, loss)
        if key not in seen:
            seen.add(key)
            bots.append(Bot(f"bot-{len(bots):05d}", *key))
    return {bot.id: bot for bot in bots}


def rate(red: Bot, black: Bot, result: str, k: float):
    score = {"1-0": 1.0, "1/2-1/2": 0.5, "0-1": 0.0}[result]
    expected = 1 / (1 + 10 ** max(-300, min(300, (black.elo - red.elo) / 400)))
    change = k * (score - expected)
    red.elo += change
    black.elo -= change
    for bot, actual in ((red, score), (black, 1 - score)):
        bot.games += 1
        bot.wins += actual == 1
        bot.draws += actual == 0.5
        bot.losses += actual == 0


def match(bots, busy, rng, window=100):
    available = [b for b in bots.values() if b.id not in busy]
    if len(available) < 2:
        return None
    least = min(b.games for b in available)
    first = rng.choice([b for b in available if b.games == least])
    others = [b for b in available if b.id != first.id]
    width = window
    while True:
        nearby = [b for b in others if abs(b.elo - first.elo) <= width]
        if nearby:
            break
        width *= 2
    fresh = [
        b for b in nearby if b.id != first.lastOpponent and b.lastOpponent != first.id
    ]
    second = rng.choice(fresh or nearby)
    return (first, second) if rng.randrange(2) else (second, first)


def validate_settings(k, window):
    if not all(math.isfinite(v) and v > 0 for v in (k, window)):
        raise ValueError("K and matchmaking window must be finite and positive")
