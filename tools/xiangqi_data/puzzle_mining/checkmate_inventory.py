"""Read canonical puzzle inventory for the checkmate terminal dashboard."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass

from .patterns import CHECKMATE_MATCHERS
from .sources import is_native_source


@dataclass(frozen=True)
class InventoryCounts:
    total: int = 0
    live_site_games: int = 0
    local_database: int = 0


@dataclass(frozen=True)
class CategoryInventory:
    theme: str
    label: str
    counts: InventoryCounts


@dataclass(frozen=True)
class CheckmateInventory:
    categories: tuple[CategoryInventory, ...]
    counts: InventoryCounts


def theme_label(theme: str) -> str:
    """Turn registry identifiers into readable labels without a second registry."""
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", theme).title()


def load_checkmate_inventory(connection: sqlite3.Connection) -> CheckmateInventory:
    """Count current canonical matches, including work from earlier sessions.

    A puzzle can count in multiple categories, but counts and source totals
    count it only once. Pending re-verification does not remove an existing
    canonical puzzle; withdrawn puzzles do not count. Aggregate in SQLite so
    dashboard memory and result transfer depend on categories and sources,
    rather than the number of puzzles. Callers should throttle full refreshes.
    """
    themes = tuple(matcher.name for matcher in CHECKMATE_MATCHERS)
    if not themes:
        return CheckmateInventory((), InventoryCounts())
    placeholders = ",".join("?" for _ in themes)
    rows = connection.execute(
        f"""
        WITH matches AS (
          SELECT DISTINCT p.id, c.source_database, theme.value AS theme
          FROM puzzles p
          JOIN candidates c ON c.id = p.candidate_id
          JOIN json_each(p.themes) theme
          WHERE p.verification_status = 'active'
            AND theme.value IN ({placeholders})
        )
        SELECT theme, source_database, count(*) AS total
        FROM matches GROUP BY theme, source_database
        UNION ALL
        SELECT NULL, source_database, count(DISTINCT id)
        FROM matches GROUP BY source_database
        """,
        themes,
    )
    grouped: dict[str | None, list[int]] = {theme: [0, 0] for theme in themes}
    grouped[None] = [0, 0]
    for theme, database, total in rows:
        native = is_native_source(database)
        grouped[theme][0 if native else 1] += total

    def counts(theme: str | None) -> InventoryCounts:
        users, local = grouped[theme]
        return InventoryCounts(users + local, users, local)

    return CheckmateInventory(
        tuple(CategoryInventory(theme, theme_label(theme), counts(theme)) for theme in themes),
        counts(None),
    )
