# Tiantian rules adversarial review

Reviewed September 5, 2026 by four specialist subagents covering maintainability,
behavior and implementation, senior code review, and robustness. Findings were
adjudicated against the current checkout and the documented policy. Existing
unrelated working-tree changes were preserved.

## Implemented findings

| Priority | Finding                                                                                                                                                                          | Resolution                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Imported unrestricted histories were assigned the default Tiantian ruleset. Replaying a sufficiently repeated import could reject a history that had just imported successfully. | Imported mainlines explicitly retain unrestricted semantics. A 20-ply repeated import now has a regression for policy and full replay equality.                                                                                                    |
| P1       | Replay serialization treated any ended position with check as checkmate. A natural-limit draw delivered by check could trigger checkmate effects after reload.                   | Replay mate flags require a winning checkmate. Tests contrast a real checking move ending in a draw with a real mating move.                                                                                                                       |
| P2       | Stalemate wins share the legacy `Mate` status and could trigger checkmate audio/animation and incorrect descriptive text.                                                        | Presentation checks the ending reason, with a check-state fallback for older records. Stalemate remains a win; result sounds and descriptions distinguish it. End events also refresh the termination reason and clear obsolete variation notices. |
| P2       | Standalone `Game.fromState` snapshots implicitly asserted Tiantian semantics without adjudication history.                                                                       | The factory is explicitly unrestricted and documented. Live game creation remains `XiangqiRules.initialGame`.                                                                                                                                      |
| P2       | One policy object mixed board threat interpretation, sequence limits, and lifecycle decisions.                                                                                   | Extracted package-private `TiantianThreats` and `TiantianSequences`; `TiantianRules` retains counters, precedence, and permitted-move orchestration.                                                                                               |
| P2       | Candidate restrictions repeatedly computed identical pre-move threats and complete recapture move lists.                                                                         | Reuse a lazy threat context per position, compute exchange replies once, and short-circuit legal recapture searches through shared king safety. No global cache or new engine dependency.                                                          |
| P2       | Replay carried and re-decoded a `Decoded` value that every subsequent iteration discarded.                                                                                       | Fold directly over the immutable game.                                                                                                                                                                                                             |
| P2       | Chase comments contradicted exemptions; policy and identity contracts were implicit.                                                                                             | Corrected the comment, named rule limits, documented physical identities, policy inputs/outputs, and national-policy extension boundaries.                                                                                                         |

The public legality/policy seam remains intact. The extracted classifier is
explicitly Tiantian-specific; shared movement remains in `XiangqiRules`. A future
Chinese national rules implementation can select a separate policy and reuse
movement, replay, persistence lifecycle, and presentation. It will still need
edition-specific classification, tests, and possibly its own versioned state
payload. The current Tiantian counters are not a universal national-rules model.

## Decisions and remaining evidence gaps

The review did not change adjudication results based on uncertain web analogies.
The [Asian Xiangqi Federation rules](https://www.asianxiangqi.org/axf_rules.htm)
support several documented chase exemptions and legal recapture concepts, but
they do not establish Tencent's current algorithm. An
[official Guangxi event announcement from 2020](https://www.thepaper.cn/newsDetail_forward_6742394)
describes event-specific treatment of alternating check/chase that differs from
historical Tiantian behavior. Older rules are therefore insufficient evidence
for replacing the current screenshot-derived policy.

The controlling screenshot referenced in `TIANTIAN_RULES.md` could not be
recovered for this review. Its exact clauses should be archived with the project
when available. Chase classification and alternating-sequence edge cases still
need comparison against reproducible current-app examples. Passing tests proves
the documented implementation contract, not exact parity with Tencent's
unpublished classifier.

Synthetic sequence tests remain useful for exact 6/12/18 boundaries, mutual
forcing, and permitted-move exhaustion. They should not be mistaken for complete
end-to-end evidence: real mutual-forcing and all-continuations-forbidden game
records would strengthen coverage further.

The following suggestions were deferred after reconciliation:

- A generic rule engine or universal fact schema: premature with one implemented
  adjudication policy and likely to encode the wrong national-rules assumptions.
- A wholesale rewrite of `MoveResult`/`State` or serialized reason enums: useful
  follow-up only with a concrete schema need; it would expand compatibility work
  beyond these fixes. Existing reason keys are preserved.
- Broad board-generation optimization: the focused reuse and short-circuit
  changes remove demonstrably repeated work. No latency or speedup claim is made
  without a dedicated benchmark.

## Verification

The review adds import/replay consistency, snapshot-policy, checked-draw replay,
true mate, and frontend ending-presentation regressions. Board-level threat
fixtures cover the documented operational classifier and compare targeted
recapture checks with complete legal capture generation.

Final results:

- `xiangqi/testOnly *Tiantian* *Xiangqi*`: 59 passed.
- `round/testOnly *StepBuilderTest *RematcherTest *AiTurnCoordinatorTest`: 11 passed.
- `node ui/.test/runner.mjs adjudication`: 2 passed.
- `tsc -b ui/round/tsconfig.json --pretty false`: passed.
- Targeted Scala formatting, frontend formatting, and `git diff --check`: passed.

The Scala runs compile the affected round dependency graph. This review does
not claim a fresh full application or browser smoke test. The initial formatter
invocation rejected wildcard paths on Windows; rerunning with explicit paths
completed successfully.
