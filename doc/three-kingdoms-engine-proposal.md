# Three Kingdoms engine proposal

Revised October 30, 2026. Scope: a practical first-release engine for LiXiangQi's `threeKingdoms-v1`, with browser execution, strong play, many adjustable bot levels, and full alternative-line analysis. This proposal replaces the earlier tournament-points objective and research-heavy release plan. No engine implementation is included.

## Recommendation

Build **PikaSan**, a dedicated C++ engine compiled natively and to WebAssembly, using established multiplayer search and Stockfish-family engineering. Aim for the experience of Pikafish: responsive local analysis, reliable legal variations, MultiPV, configurable resources, and computer opponents spanning beginner to strongest available play.

For the first release use:

1. Multiplayer Monte Carlo tree search with each player maximizing its own game result.
2. A substantive handcrafted evaluation, initially requiring no training data.
3. Bounded Max-n tactical search to resolve unstable leaves and inspect critical alternatives.
4. Conventional iterative-deepening alpha-beta during the final duel.
5. A shared evaluator interface that subsequently accepts a compact NNUE trained entirely from engine-generated games.
6. Native self-play and regression testing as routine engineering verification, without grandmaster recruitment or a large research infrastructure.

This is an adaptation of established engine methods, not an attempt to invent a new kind of game AI. The particular combination is an engineering choice for these rules, not a published guarantee of strength. A small automated comparison against optimized Max-n and paranoid baselines should catch a poor choice before integration; it is not an open-ended research competition.

The most important distinction is between reusing powerful techniques and inheriting measured strength. We can do the former immediately. No existing xiangqi network or two-player search can supply the latter unchanged.

## The engine plays to win the individual game

The objective is to become the last surviving player. Elimination in second place is a loss, just like elimination in third place. There is no survival bonus, placement reward, tournament context, or rating-management objective.

Use this explicit terminal utility convention:

| Result                              |                                            Utility |
| ----------------------------------- | -------------------------------------------------: |
| Sole winner                         |                                                  1 |
| Eliminated, whether second or third |                                                  0 |
| Draw among two remaining players    | 0.5 for each survivor; 0 for the eliminated player |
| Draw with all three players active  |                                           1/3 each |

This convention gives full credit to winning and partial credit to sharing the result, with a constant total of one. It does not give second place independent value. A 40% chance of winning beats guaranteed second place, which scores zero. Survival matters only because it preserves the opportunity to win or draw.

There is a real choice in how to value three-way draws. Splitting the result equally is the recommended initial convention, not an inherent law of chess engines. It makes the preference clear: outright win, then shared result, then elimination. Freeze this convention in tests and training metadata. If the product later wants literally only outright wins to count, draws would need a different objective; that is not necessary for an ordinary win-seeking engine.

During an unfinished game, evaluation estimates winning prospects. It must not assign the full win reward merely for capturing the first general. That capture wins an army and creates a duel, which still has to be won.

Both computer opponents independently optimize their own result. They must not share a team objective against the human. Shared immutable model data is fine; sharing a root player's perspective accidentally across bot turns is not.

## Why this cannot be a small Pikafish patch

LiXiangQi has 135 graph intersections, three independently acting players, ownership changes, neutral armies, and phase-dependent check legality. Army origin remains important even after ownership changes. With three players, check is advisory and actual general capture eliminates a player; in the duel, exposing one's own general becomes illegal.

Pikafish's inspected source assumes two colors, 90 squares, 128-bit occupancy, and seven-bit square fields. These need replacement, not an extra variant flag. Its evaluation weights encode ordinary xiangqi. See [Pikafish types](https://github.com/official-pikafish/Pikafish/blob/fec5d430bb2bbff9969d4de09ac86c3b6fa4e138/src/types.h).

Fairy-Stockfish is convenient when new games fit its existing model. Its official supported constraints include two players, a rectangular board, and at most 12 by 10 squares. Three Kingdoms does not fit. See [Fairy-Stockfish FAQ](https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/FAQ#can-the-gamevariant-xyz-be-supported).

| Approach                                                     | Decision                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Configure Fairy-Stockfish                                    | Cannot express this game within its supported architecture                                                |
| Modify Pikafish throughout                                   | Possible, but substantial replacement of its game-specific assumptions is unavoidable                     |
| Dedicated engine with selected Stockfish/Pikafish components | Recommended; makes the changed responsibilities explicit                                                  |
| Train a large AlphaZero system before shipping               | Unnecessary prerequisite for this release                                                                 |
| Keep raising the current placeholder's node cap              | Insufficient; it lacks tactical search, caching, efficient state transitions, and a substantial evaluator |

PikaSan can be a derivative engine without retaining every Pikafish subsystem. Start with a clean source layout, selectively adapt useful components, preserve attribution and licenses, and pin donor revisions. Avoid maintaining a broad multi-variant framework solely to accommodate this one game.

The final duel still uses the Three Kingdoms topology, transferred armies, and possibly neutral pieces. It needs its own alpha-beta move generator; it cannot launch ordinary Pikafish on a translated position.

## What to reuse from strong engines

| Technique                                          | Application                                                  |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Compact positions and reversible make/unmake       | All search modes                                             |
| Precomputed attacks and movement paths             | Adapt to the 135-point graph                                 |
| Incremental hashing and bounded caches             | All modes, with history-correct identities                   |
| Iterative deepening and last completed results     | Tactical Max-n and duel alpha-beta                           |
| Capture, history, and principal-variation ordering | Tactical and duel search; priors for MCTS                    |
| Quiescence and tactical extensions                 | Adapt to advisory checks, real turn order, and appropriation |
| Alpha-beta and principal-variation search          | Final duel; also the paranoid benchmark                      |
| Compact quantized NNUE                             | Subsequent evaluation upgrade using self-generated data      |
| MultiPV, search limits, stop, and resource options | Public engine interface                                      |
| Automated matches and reproducible benchmarks      | Every material change                                        |
| Skill-based alternative move selection             | Weaker bot levels                                            |

Two-player negamax flips the sign of a scalar after each move. That is incorrect for three independent players: another player's gain does not uniquely specify which opponent loses. Ordinary alpha-beta bounds cannot be applied unchanged to Max-n. This is the central search adaptation, not a reason to discard established engine engineering.

Do not initially transplant null-move pruning, futility margins, late-move reductions, or static exchange evaluation into the three-player phase. Their correctness or practical safety depends on assumptions that may fail here. In the duel, introduce these selectively after the basic search is verified, with variant-specific tuning rather than copied constants.

## Search for the first release

### Multiplayer MCTS as the main search

Use established UCT-style multiplayer MCTS. Each search edge stores visit count and accumulated utilities for all three seats. Selection at a node uses the acting player's utility plus an exploration term. Backpropagation preserves fixed seat identities and never negates a scalar by ply parity.

Use handcrafted evaluation at leaves instead of relying on long, random full-game rollouts. Add heuristic move priors or progressive bias from captures, general safety, activity, and previous search information. Ensure every legal root move receives consideration; weak priors must not permanently hide defenses. A learned policy can later replace heuristic priors, but it is not a first-release dependency.

MCTS is useful here because it concentrates effort without assuming the two opponents are a coalition. It also produces root alternatives and can stop at arbitrary time budgets. Its principal weakness is overlooking narrow tactical refutations, which the tactical layer addresses.

The established multiplayer literature compares Max-n, paranoid search, and MCTS approaches and reports advantages for own-utility MCTS in several games. It also describes multiplayer solver extensions. Those findings motivate this choice without establishing strength for our rules. See [Search Policies in Multi-Player Games](https://dke.maastrichtuniversity.nl/m.winands/documents/policies.pdf). [OpenSpiel's MCTS implementation](https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/algorithms/mcts.py) is a useful independent implementation reference.

Keep tree memory bounded. Reuse compatible subtrees between played moves and analysis requests. Initially cache evaluations separately instead of merging the entire MCTS tree into a transposition graph; shared nodes with different repetition histories are easy to handle incorrectly.

### Tactical Max-n search

At unstable leaves and for critical root candidates, use a bounded three-utility tactical search. Each actor chooses its own best continuation. Prioritize general captures, exposed generals, cannon screens, major captures, and appropriation transitions. Search intervening actors in their actual order, including passes.

Do not search only captures: quiet defenses, interference with another army's attack, and counterthreats can decide the result. In three-player play a check is not a forced evasion. The tactical generator must reflect that rule rather than inherit chess's check-only response logic.

Return unresolved estimates when the tactical budget expires. A terminal position on one predicted line is not a proof that the line is forced. Only promote a result to a proven label when the required reply coverage supports it.

Reserve a bounded fraction of effort for tactical work and measure the cost. Running a large tactical search at every MCTS leaf would simply recreate the full-width branching problem.

### Duel alpha-beta

After elimination, use iterative deepening, alpha-beta, transposition tables, move ordering, and quiescence on the same rules kernel. Start with these well-understood components before adding selective reductions. Win, draw, and loss map to 1, 0.5, and 0 for each survivor; the eliminated player remains at zero.

The three-player search can call a budgeted duel search when a branch enters that phase. Translate its evaluation back to the fixed three-seat vector. Keep bounds, exact results, and heuristic estimates distinct. Do not launch unlimited nested searches.

### Small engineering comparison

Retain optimized Max-n and paranoid search as offline comparison agents. Paranoid search treats both opponents as minimizing the root player's utility; it can search deeper but models cooperation that need not exist. It is a useful opponent and robustness test, not the default bot personality.

Compare at equal elapsed time on representative opening, tactical, and duel positions. Count actual wins and draws across rotated seats. If the proposed hybrid repeatedly loses to the simpler baseline at browser budgets, use the measured winner before adding more complexity. This is a finite integration check, not a requirement to discover the globally best multiplayer algorithm.

## Evaluation without human data

### Build a real classical evaluator first

The current evaluator is mainly material, development, soldier advancement, and large survival bonuses. Replace those survival bonuses with the terminal objective above and evaluate the actual mechanisms that create wins.

| Feature family       | Required considerations                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Material             | Current controller, original army, phase-dependent piece values, and usable rather than merely nominal strength |
| General safety       | Threats from each opponent, turn order before capture is possible, escape squares, guards, flying-general lines |
| Mobility             | Legal useful moves, constrained horses, blocked pieces, palace access, and neutral blockers                     |
| Cannons and chariots | Screens, open paths, river branches, pins where legally relevant, and coordination                              |
| Soldiers             | Army-specific direction, crossed river, advancement, and controlled entry squares                               |
| Army capture         | Tactical feasibility, acquired usable pieces, and the resulting duel position                                   |
| Opponent interaction | Threats between the other players and who benefits from a capture race                                          |
| Endgames and draws   | Duel king safety, conversion, repetition proximity, and quiet-move limits                                       |

Compute cheap incremental terms frequently and expensive mobility/threat terms only where measured benefit justifies their cost. Separate attack generation from UI inspection so search does not build notation strings or render-oriented objects.

Generate bounded per-seat estimates from these features. A softmax can provide a convenient initial constant-sum value vector for MCTS, but its outputs are heuristic shares, not calibrated winning probabilities. Label them as an evaluation until calibration exists. Terminal outcomes always override the heuristic.

Handcrafted evaluation gives an immediately usable baseline. It does not guarantee modern NNUE strength. Modern engine design also includes improving evaluation through self-generated data, so provide that path from the outset rather than designing a dead end.

### Add NNUE through self-play

No human game collection is necessary. Generate games using the classical engine, save searched positions and terminal results, train a compact evaluator, and compare the exported candidate against the previous version. Repeat when it improves play.

Store the complete state, actor, rules version, search budget, root alternatives, and final outcome. Use both terminal outcomes and stronger search targets; training only on the placeholder's evaluations would teach its errors. Hold out entire games and opening families, and include older engine versions as opponents.

Use a sparse, incrementally updated quantized model with three-player output semantics. Features must distinguish piece origin from controller, neutral pieces, active players, turn order, and the two phases. Ownership transfers require correct bulk updates or full accumulator refreshes. Compare incremental output against full recomputation on every transition category.

A small value-only network is sufficient for the first learned upgrade. A policy head, large teacher, graph network, Gumbel search, and population-based reinforcement-learning infrastructure are optional later improvements. They do not block release.

Stockfish documents the underlying [NNUE implementation techniques](https://github.com/official-stockfish/nnue-pytorch/blob/ec2ead9feeb5677b828536fc53000d1379a1d207/docs/nnue.md), and Fairy-Stockfish describes its [variant training approach](https://fairy-stockfish.github.io/about-nnue/). Their existing feature encodings and datasets need adaptation; their network weights cannot simply be reused for this game.

## MultiPV is a core capability

Support `MultiPV` from 1 through at least 16, limited by the number of distinct legal root moves. Make the internal representation capable of returning all legal root moves for development and bot selection. Forced pass is an action; it must survive line serialization and replay.

For each root alternative return the move, acting seat, utility vector, representative legal continuation, search effort, and result status. All alternatives refer to the same root position and objective. Their statistics need not have identical visits, but less-explored alternatives must not appear equally reliable.

In MCTS, distribute a minimum exploration budget across requested candidates and spend additional effort resolving their ordering. Do not simply print the sixteen largest noisy means after giving fifteen candidates one visit each. Rank with an explicit, tested root-selection rule and distinguish provisional from final results. Strongest move selection may use visit count with tactical/proven-result overrides; displayed values describe that same search, not a separate inconsistent calculation.

For duel alpha-beta, use conventional repeated root searches or excluded-root MultiPV searches, publishing completed iterations. Requested MultiPV consumes the same total time budget unless the caller explicitly requests more time. More lines generally reduce effort on the best line.

A low-prior move outside the current displayed list must still be discoverable. MultiPV is an output and resource-allocation request, not permission to permanently restrict legal search to those moves.

Expose familiar controls: `Threads`, `Hash` or total search memory, `MultiPV`, `Skill Level`, `go movetime`, `go nodes`, `go depth` where meaningful, `go infinite`, `stop`, and `searchmoves`. Use versioned three-player position and result extensions. Ordinary UCI has no standard three-player score vector, so do not claim unchanged UCI compatibility.

MCTS visits, maximum path depth, and completed alpha-beta depth are different quantities. Report them accurately. A search reaching one deep line has not analyzed every move to that depth.

## Many bot levels without many engines

Use one engine and one evaluation model with a versioned strength profile. Keep skill independent from raw device speed and from the user-facing analysis MultiPV setting.

| Control                                                | Purpose                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Node or simulation budget with wall-clock safety limit | Reproducible approximate effort across devices                     |
| Tactical budget                                        | Adjust immediate tactical reliability                              |
| Candidate selection temperature                        | Increase preference for alternatives as level decreases            |
| Permitted evaluation loss                              | Bound how far a weakened choice can depart from the best estimate  |
| Mistake frequency and severity                         | Produce occasional plausible errors rather than uniform randomness |
| Minimum response delay                                 | Presentation only; adds no artificial thinking strength            |

Internally search a suitable candidate set, then weaken selection deliberately. For candidate utilities `q`, a starting sampling rule is proportional to `exp((q - best) / temperature)`, restricted by the profile's permitted loss. These are heuristic values before calibration, so tune the temperature to their actual scale. Use separate controls for ordinary inaccuracies and occasional larger errors.

Do not use only uniform random legal moves. Do not make every low-level move independently nonsensical. Do not leave a hidden deep tactical solver at full strength while claiming a beginner level. At the same time, avoid reducing effort so far that root candidates are not evaluated meaningfully; controlled selection can produce a weaker but more coherent opponent.

For the strongest level disable artificial weakening, retain all tactical safeguards, and choose the strongest searched move. Analysis always runs unweakened unless explicitly requested otherwise. Bot sampling must not alter displayed engine recommendations.

Begin with an internal 0–20 skill scale and map the site's chosen number of levels onto it. Numbers are product controls, not asserted Elo ratings. Expand the visible level count without creating new evaluators or search implementations.

Calibrate profiles in automated round robins across all seat permutations and several time budgets. Require broadly increasing average results, not a win in every pairing. Check that the lowest profile loses convincingly to simple legal baselines and that intermediate levels are separated. Human feedback can later improve naturalness without blocking initial shipping.

Support seeded randomness for reproducible tests and varying seeds for normal play. Avoid knowing or adapting to a human's private information or changing strength midgame without an explicit adaptive-mode product decision.

## Canonical rules and browser delivery

Use a compact board and piece lists, precomputed graph rays, and reversible state updates. A simple 135-entry board plus multiword occupancy is a better first implementation than inventing rectangular magic bitboards for a branching graph. Moves need at least eight-bit square identifiers; move buffers must accommodate multiple controlled armies.

Preserve all rule-relevant state: controllers, origin armies, active seats, actor, elimination, pass count, quiet plies, total plies, and repetition history. Cache identities must account for draw history; the existing repetition hash alone is not a safe exact-score transposition key.

Keep `TK1` at the application boundary if possible. Retain its exact stable repetition semantics even if internal search uses a different incremental hash. Training symmetries must transform actual historical positions or replay: stored hashes cannot be rotated into new histories.

The permanent architecture should have one canonical C++ rules kernel used by native training, WASM rules and engine builds, and a narrow JVM binding for server validation. Keep clocks, authorization, persistence, and game settlement in Scala. The server needs neither search nor neural weights.

Develop against the current Scala rules as a temporary differential oracle. Freeze reviewed fixtures, migrate consumers, then retire the superseded rules/search implementation. Do not retain two competing production move generators. The native JVM binding adds packaging and memory-safety responsibilities; fuzz inputs, run sanitizers, validate the ABI, and fail clearly on incompatible binaries. Prototype this boundary early so it does not become a late integration surprise.

Run the engine in a persistent worker with a bounded tree and cached weights. Reuse existing content hashes, download progress, integrity checking, and browser storage. Single-thread WASM is the baseline; add a separate threaded build where cross-origin isolation permits it. Emscripten documents the need for [separate threaded and unthreaded builds](https://emscripten.org/docs/porting/pthreads.html).

Cancellation must work during search. Use cooperative search slices for a single-thread worker and appropriate atomic signaling for shared-memory workers; queued JavaScript messages cannot interrupt an indefinitely synchronous WASM call. Carry request IDs and position revisions through every response, and discard stale results.

The shared analysis panel should expose time/effort, alternatives, arrows, legal previews, and per-player evaluation using existing themes and i18n. Store model and score-format versions with saved evaluations. Preserve comments, arrows, and variations when invalidating obsolete derived scores.

Both bots run on the user's device as today. Time management must leave room for server delivery and browser delays. Closing or suspending the host page still prevents local computation; stronger search does not remove that limitation. Do not add a production search service as a hidden dependency.

## Practical implementation sequence

| Milestone                      | Deliverable and acceptance                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. Rules and protocol          | Winning objective, terminal utilities, move/state fixtures, MultiPV/result schema, skill profile contract                     |
| 2. Fast shared kernel          | Native and WASM legality parity, make/unmake checks, root legal-move counts, JVM binding spike                                |
| 3. Complete classical engine   | Handcrafted evaluation, multiplayer MCTS, bounded tactical Max-n, duel alpha-beta, time/stop support                          |
| 4. Alternatives and levels     | MultiPV 1/4/16, unweakened analysis, seeded bot weakening, automated level ladder                                             |
| 5. Integration                 | Persistent browser worker, shared analysis UI, model-ready evaluator interface, coherent deployment artifacts                 |
| 6. First-release qualification | Correctness suite, clear improvement over the placeholder and simple baselines, browser stability and acceptable move latency |
| 7. Learned evaluation upgrade  | Self-generated dataset, compact NNUE, exported-model parity, automated promotion if stronger                                  |

Milestones 1–6 are the initial engineering release path. Milestone 7 can run alongside integration if compute and time allow; it is the most valuable planned strength upgrade. There is no mandatory five-to-nine-month program, expert tournament, giant network, or human training dataset.

Avoid assigning a new confident calendar estimate without knowing staffing and the native/WASM spike results. Bound work by demonstrable deliverables. If time is constrained, defer threading, learned policy, and sophisticated pruning before sacrificing rules correctness, useful evaluation, MultiPV, or bot controls.

The minimum automated tournament runner needs local jobs, reproducible seeds, opening/state fixtures, recorded engine versions, and result summaries. It does not need a distributed Fishtest service. Test candidates against several frozen versions and simple independent opponents, rotating seats. Compare equal elapsed-time budgets and the actual shipping browser artifact, not only native throughput.

## Release verification without grandmasters

The initial claim should be a serious, substantially stronger variant engine using established methods. No grandmaster-level claim is necessary for release, and the absence of grandmaster testing does not block engineering progress.

Require:

- No unexplained native/WASM/temporary-reference rules disagreements across the conformance corpus and randomized legal games.
- Correct replay of every emitted PV, including passes, ownership transfers, and elimination transitions.
- Tactical fixtures for immediate general capture, defenses, cannon screens, neutral armies, and duel checkmate/stalemate.
- Equal-time automated results showing clear improvement over the current engine and simple baselines, reported by seat and phase.
- MultiPV roots that are distinct and legal; incomplete alternatives never presented as equally completed alpha-beta searches.
- Reproducible weakening, a broadly ordered bot ladder, and no artificial weakening in strongest analysis.
- Responsive stop/navigation, bounded memory, successful long-game runs, and browser failure recovery.

An automated match should be the statistical unit: the three players' results are correlated. Use fixed test batches and uncertainty estimates rather than inventing standard chess Elo from small three-player samples. Substantial regressions must block release; proving superiority over all possible engines is unnecessary.

The current placeholder gives a useful concrete baseline. In the earlier read-only Node 24.15.0 sample, the initial position had 44 legal moves; 12,000 nodes completed depth two and 100,000 completed depth three. Those were single workstation samples, not browser benchmarks. Record comparable measurements for the replacement while judging playing strength by games and tactical results rather than node count alone.

## Deployment and licensing

The existing sibling `Z:/Work/Scripts/lixiangqi-beta-deployment/push-local-live.ps1` builds the Scala.js Three Kingdoms artifact before frontend assets and includes core source in build fingerprints. Implementation must replace that dependency with coherent native/WASM kernel artifacts, preserve stale-build rejection, package matching server binaries, and include evaluator/protocol compatibility in manifests. Update local startup and WebSocket consumers too.

Preserving position/event formats should avoid game-data migration. Any necessary persisted-data conversion must retain recoverable originals and run through the existing dated deployment migration system. Remove the obsolete placeholder engine at cutover; rollback should restore a coherent previous release, not silently activate a weak fallback behind the same engine name.

Pikafish code and official weights have different terms. Preserve GPL obligations for copied code and distribute the corresponding source/build materials. Official Pikafish weights impose separate usage restrictions and do not evaluate this variant anyway. Train our own weights with recorded data provenance. See [Pikafish](https://github.com/official-pikafish/Pikafish) and [network terms](https://github.com/official-pikafish/Networks#nnue-license).

## Main implementation hazards

| Hazard                                          | Engineering response                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Rewarding second place                          | Both elimination places score zero; no placement bonus        |
| Bots effectively form a team                    | Actor-specific utility selection and seat-isolation tests     |
| Narrow MCTS tactical misses                     | Bounded tactical search and critical-root verification        |
| Too-shallow Max-n                               | Use it selectively; main search allocates effort through MCTS |
| Transplanting invalid pruning                   | Start conservatively; adapt and test each heuristic           |
| Ownership corrupts evaluation                   | Bulk updates/full refresh and recomputation comparisons       |
| Phase transition changes legality midline       | Shared transition primitives and explicit duel tests          |
| False probability or depth precision            | Label heuristic values and search effort accurately           |
| MultiPV shows poorly explored moves as reliable | Minimum candidate effort and provisional-result metadata      |
| Weak levels are still tactically superhuman     | Weaken tactical effort and move selection together            |
| Weak levels play arbitrary nonsense             | Controlled plausible errors and level-ladder testing          |
| Search exceeds browser memory or deadlines      | Hard budgets, persistent workers, cooperative cancellation    |
| Self-play reinforces a narrow weakness          | Historical opponents, tactical fixtures, held-out games       |
| Server and browser drift                        | One canonical kernel and coherent artifact/version checks     |

The practical goal is to put proven engine components around the exact game: efficient state transitions, selective multiplayer search, tactical lookahead, conventional duel search, a meaningful evaluator, and explicit controls for analysis and strength. That delivers a usable first engine without human data, while leaving a direct route to self-trained NNUE and stronger search within the same architecture.
