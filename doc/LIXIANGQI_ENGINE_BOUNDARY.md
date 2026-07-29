# Lixiangqi engine boundary

Lixiangqi starts from the unmodified upstream Lichess tree. The only supported
game is standard Xiangqi. It does not inherit Lishogi, Shogi roles, drops,
promotion, color terminology, board geometry, or database variant semantics.

## Upstream authority

- Lichess owns the application shell, accounts, pairing, clocks, messaging,
  tournaments, studies, moderation, and presentation outside the board.
- Lixiangqi owns its ported standard-Xiangqi contract, 9x10 board
  configuration, WXF renderer, UCI rank-10 encoding, themes, and piece assets.
  PyChess remains the attributed upstream source for those ports.
- Official Pikafish owns legal-move generation, FEN transitions, check and
  end-state detection, every position evaluation, engine search, best-move
  choice, and principal variation shown by Lixiangqi.
- `chessgroundx`, as used by PyChess, owns variable board dimensions and the
  intersection-centered piece transforms. Lichess's 8x8 chessground geometry
  must not be stretched into a 9x10 board.

## Integration rule

No Xiangqi rule may be independently invented in Lixiangqi. Server operations
cross the rules boundary and fail closed if the rules library is unavailable.
The browser contains no local chess or Fairy-Stockfish analysis runtime;
analysis requests cross the server boundary to the pinned Pikafish process.
Shared fixtures check the rules boundary against standard Xiangqi positions.

The first implementation is intentionally stateless. A rules request contains
the initial FEN and complete move list, making retries deterministic and keeping
native engine state out of Lichess actors. Persistent Pikafish sessions are
guarded independently, with command access serialized per engine process.

## Single-game product policy

The persisted game kind is Xiangqi; it is not exposed as a selectable variant.
Game setup offers Red, Random, and Black with ordinary Lichess color discs.
Chess-only controls (variant selector, castling, promotion, en passant, opening
book, Syzygy, and chess piece themes) are hidden or replaced only where a
Xiangqi position makes them invalid.
