# Bot-level calibration tool

This Windows-only research tool measures fixed Pikafish policies against the
ten Tiantian reference levels used to design Lixiangqi's computer strengths.
It is not imported by the site or by the production Pikafish worker.

The optimizer has one objective: a color-balanced match score of 50%, where a
win is 1, a draw is 0.5, and a loss is 0. It does not optimize style,
human-likeness, or similarity to Tiantian's move choices.

## Run

```powershell
.\Launch Bot Level Calibration.cmd
```

The launcher opens the desktop GUI and stores local results under `data/`.
Tiantian automation is screen-coordinate and image based, so it requires the
expected Windows display, application layout, and installed Pikafish binary.

## Repository layout

- `bot_level_calibrator/` contains the optimizer, persistence, Pikafish client,
  Tiantian automation, recovery, and GUI.
- `tests/` contains unit and regression coverage.
- `piece_catalog/` contains source reference images used for board recognition.
- `data/` contains machine-local databases, games, screenshots, diagnostics,
  and exports. Git ignores these generated artifacts except for its README.
- `METHODOLOGY.md` records the final calibration method, release profiles,
  evidence limitations, and future work.
- `ALGORITHM_REVIEW.md` records the design decisions that led to the final
  one-coordinate model.

## Strength model

The policy has two continuous regimes:

- Levels below the bestmove floor use 149 nodes and sample between adjacent
  Pikafish ranks. Expected rank 1.21, for example, means rank 1 with 79%
  probability and rank 2 with 21% probability.
- At and above the floor, `MultiPV=1` always plays Pikafish `bestmove`, and
  nodes are the only strength parameter.

`MultiPV` only asks Pikafish to report enough ranked candidates. It is derived
from expected rank and is never independently optimized. There are no
temperature, tail-mixture, lapse, or behavior-matching controls.

Tiantian Level 1 starts from live map Level 1 (Custom Bot choice 0): 149 nodes,
MultiPV 16, expected rank 9.5, and a 600-centipawn candidate-loss limit.
It uses the shared production score-aware rank distribution and mate handling. It retains the shared production master-book policy throughout
calibration: consult the book for bot turns 1–10, with book selection fading
from 100% to 10%, and use a 5,000,000-node bestmove search when a selected book
turn has no legal book move. Lookup failures use the current engine profile,
matching production. From bot turn 11 onward, only the current engine profile
plays. The book endpoint defaults to http://127.0.0.1:9002 and can be set with
LIXIANGQI_EXPLORER_URL; run the explorer to exercise the book policy.

Level 1 uses the 149-node rank/bestmove boundary. Below the boundary it
optimizes expected rank, requests at least 16 candidates, and retains the
production sampler and 600-centipawn limit. Above it, it increases nodes. Its
opening policy stays fixed while the engine strength is optimized. Existing
levels retain their 149-node boundary and book-free calibration behavior.

See [METHODOLOGY.md](METHODOLOGY.md) for the release table and statistical
method. Production behavior is documented in
[`doc/PLAY_WITH_COMPUTER.md`](../../../../doc/PLAY_WITH_COMPUTER.md).
