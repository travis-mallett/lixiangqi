# KingdomFish engine proposal

Revised November 1, 2026. The full proposal now belongs to the standalone
[KingdomFish repository](https://github.com/travis-mallett/KingdomFish), alongside
its engine source, tests, protocol, and self-play training tools.

**[Read the canonical full proposal](https://github.com/travis-mallett/KingdomFish/blob/main/docs/proposal.md).**

KingdomFish implements Game of the Three Kingdoms first, with stable player
identities and utility capacity for future four-player xiangqi. It uses named,
versioned rule profiles and a Pikafish-style command lifecycle with explicit
multiplayer position, clock, and utility extensions.

The initial engine uses multiplayer MCTS, tactical Max-n, final-duel alpha-beta,
and a handcrafted evaluator. A compact NNUE replaces the evaluator inside the
same search engine; it does not replace search. Native and browser builds support
that model format, and self-play supplies training data without human games.
No network is designated as the stronger shipping default until it passes
export-parity and equal-time match checks.

This is a standalone development engine, not a strength-qualified release or a
claim of grandmaster-level play. LiXiangQi integration, canonical rules migration,
and deployment changes are explicitly deferred. This documentation update does
not change LiXiangQi's existing engine or game behavior.
