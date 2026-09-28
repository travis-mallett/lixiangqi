"""Project completed verifier evidence into the small, authoritative playback contract."""

import math
import re


def validate_playback(value, primary):
    if not isinstance(value, dict) or set(value) - {
        "objective",
        "solutions",
        "startingCp",
    }:
        raise ValueError("invalid playback metadata")
    if value.get("objective") not in {"mate", "tactic"}:
        raise ValueError("missing puzzle objective")
    lines = value.get("solutions")
    if not isinstance(lines, list) or not lines or lines[0] != primary:
        raise ValueError("playback primary differs from published solution")
    for line in lines:
        if (
            not isinstance(line, list)
            or not line
            or len(line) > 255
            or any(
                not isinstance(move, str)
                or not re.fullmatch(r"[a-i](?:10|[1-9])[a-i](?:10|[1-9])", move)
                for move in line
            )
        ):
            raise ValueError("invalid playback solution")
    cp = value.get("startingCp")
    if value["objective"] == "tactic" and (type(cp) is not int or cp <= 0):
        raise ValueError("tactical playback needs its verified starting advantage")
    return value


def from_evidence(puzzle, evidence):
    primary = puzzle["line"].split()[1:]
    traces = [
        branch.get("verification", branch) for branch in evidence.get("branches", [])
    ]
    if not traces or any(not trace.get("verified") for trace in traces):
        raise ValueError("complete verified branches required")
    canonical = next(
        (
            trace
            for trace in traces
            if trace.get("moves", [])[: len(primary)] == primary
        ),
        None,
    )
    if canonical is None:
        raise ValueError("verified evidence does not contain the published solution")
    verified_objective = canonical.get("objective")
    objective = {
        "mate": "mate",
        "advantage": "tactic",
    }.get(verified_objective)
    if objective is None:
        raise ValueError("verified objective required")
    lines = [primary]
    for trace in traces:
        if trace.get("objective") != verified_objective:
            raise ValueError("mixed solution objectives")
        moves = trace["moves"]
        # Categorization may shorten the playable tactical endpoint. Only the
        # canonical prefix is authoritative in that case; never truncate siblings.
        if len(primary) < len(canonical["moves"]) and moves != canonical["moves"]:
            raise ValueError("alternate branch requires a categorized endpoint")
        line = primary if moves == canonical["moves"] else moves
        if line not in lines:
            lines.append(line)
    value = {"objective": objective, "solutions": lines}
    if objective == "tactic":
        score = canonical["decisions"][0]["analysis"]["lines"][0]["score"]
        if (
            score["kind"] != "cp"
            or score.get("bound")
            or not math.isfinite(score["value"])
        ):
            raise ValueError("verified tactical CP baseline required")
        value["startingCp"] = score["value"]
    return validate_playback(value, primary)
