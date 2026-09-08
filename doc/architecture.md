# Architecture and engineering decisions

Read this guide for shared behavior changes, substantial refactoring, internal API changes,
or redesign of an inherited subsystem. It expands the root `AGENTS.md`; it is not an inventory
of the current checkout. Verify actual modules, callers, commands, and deployment behavior
before making implementation claims.

For specialized work, also read [data and migrations](data-and-migrations.md),
[frontend](frontend.md), [performance](performance.md), or [deployment](deployment.md).

## 1. Independent fork, mature foundation

LiXiangQi is an independent xiangqi-focused fork. Do not merge, rebase, cherry-pick, or otherwise
import commits from `lichess-org/lila`. Implement changes specifically for LiXiangQi rather
than synchronizing with the former upstream repository.

Studying lichess code, tests, documentation, and history is encouraged. An unfamiliar design
may encode lessons about concurrency, large game collections, abuse, failure recovery, or
operating cost. Do not assume an awkward-looking implementation is poor engineering or merely
historical clutter.

Before materially departing from an inherited design, establish:

- What responsibility it owns and what guarantees it provides.
- Why it may have been designed that way, distinguishing evidence from hypotheses.
- Which constraints still apply to LiXiangQi, including its tighter server-compute budget.
- Why the proposed alternative is better without losing an important guarantee.

Investigate proportionately to the impact. A deep redesign needs a substantive review; an
isolated icon replacement does not require an upstream architecture investigation. When the
rationale cannot be established, record the uncertainty rather than inventing a historical
explanation. Learning from lichess does not require preserving every inherited choice.

## 2. Fix the lowest appropriate owning layer

Find the abstraction that conceptually owns the behavior, not just the page where its defect
was observed. Trace its implementation, callers, state, and relevant tests before choosing
where to change it.

A board interaction shared across the site normally belongs in the shared board, explorer,
or other actual owning module. Correcting only the analysis page while other consumers retain
the defect is not a complete shared-behavior fix. Verify affected consumers instead of using
fear of regressions to justify a local patch.

Lowest appropriate does not mean lowest possible. Page-specific presentation belongs at the
page level when it is genuinely specific. Do not insert feature policy into a generic primitive
that cannot correctly apply it to its other consumers.

Avoid compensating layers: duplicate calculations, page overrides, wrapper chains, or repeated
validation introduced solely to mask an incorrect shared implementation. Necessary validation
at a trust boundary is different from a patch that hides incorrect domain logic.

## 3. Design the target state, then the transition

For a substantial redesign, ask what we would build today without legacy implementation or
data-format baggage. This thought experiment removes historical constraints, not real product
requirements, data fidelity, external contracts, security, or resource limits.

Keep three analyses distinct:

1. **Target design:** responsibilities, canonical representation, interfaces, and invariants.
2. **Existing-system evidence:** inherited design lessons, callers, stored information, external
   consumers, and operational constraints.
3. **Transition:** caller changes, data conversion, backups, deployment ordering, and removal
   of the superseded implementation.

Use the evidence to challenge and refine the target before implementation. Do not let the
smallest compatible diff become the target merely because it is easiest to deploy.

The preferred result is one correct runtime implementation with controlled callers and data
migrated to it. Old-format readers, old/new branches, dual writes, compatibility shims, and
precautionary fallbacks should not remain simply because a previous design existed. Historical
format knowledge belongs in explicit migration tooling.

For example, a redesign of `game5` clock storage should choose the best final clock model,
convert existing records, and remove the old runtime interpretation. Adding a parallel field
and maintaining both algorithms is not the default solution. Exact conversion feasibility
must still be established; a clean model is not permission to invent missing historical data.
See [data and migrations](data-and-migrations.md).

## 4. Canonical ownership and necessary compatibility

One source of truth means clear authority, not a ban on every derived representation. A cache,
search projection, compact storage encoding, or external-protocol adapter may be legitimate
when its owner, derivation, and consistency requirements are explicit. It must not become a
second independently maintained interpretation of the same domain concept.

Likewise, shared ownership does not imply that all execution belongs on the server. Reuse
appropriate shared logic and interfaces while respecting client/server trust boundaries and
[the server-compute budget](performance.md).

Compatibility requires an identified consumer or operational need. Preserve compatibility
needed to interact with external systems LiXiangQi does not control. LiXiangQi-controlled public
APIs may evolve, but assess actual users and avoid needless disruption; ownership alone does
not make a breaking change harmless.

When compatibility is necessary, keep it at the relevant boundary where possible. Explain
why coordinated migration is insufficient and, for a temporary bridge, its removal condition.
Do not quietly introduce permanent internal legacy support as an implementation convenience.
An intentional product fallback is allowed; silently substituting an obsolete calculation
when the correct one fails is not.

## 5. Maintainability and human navigation

Organize code so a human can predict where a responsibility belongs. Split long or confusing
files along coherent responsibilities, not arbitrary line counts. Avoid both oversized
multi-purpose files and excessive fragmentation into trivial wrappers.

Move, rename, or reorganize files when it materially improves ownership and navigation. Update
imports, build configuration, tests, documentation, and asset references affected by the move.
Do not leave forwarding modules or duplicate locations solely to preserve the old structure.

The task boundary follows the responsibility being corrected, not just the first file showing
the symptom. Necessary structural refactoring is welcome. Unrelated architectural cleanup is
not automatically authorized by a nearby defect; report consequential unrelated findings
rather than turning every task into a repository-wide rewrite.

Prefer existing mechanisms and dependencies. Add a library only when its real value justifies
its maintenance, resource, and integration costs. Do not build an elaborate new framework for
one use case, or reimplement a substantial proven capability merely to claim zero dependencies.

## 6. Remove superseded material, preserve deliberate scope

Trace usages before deleting replaced functions, fields, configuration, modules, icons, or
other assets. Include dynamic references, routes, templates, build inputs, and generated-resource
sources where relevant. Lack of a navigation link or an obvious text reference is not proof
that something is dead.

Remove material made obsolete by the current change; do not leave old and new implementations
or assets side by side without an actual remaining consumer. Update tests for intentionally
replaced behavior while preserving coverage of unrelated invariants. Do not remove a failing
test merely because it exposes a regression.

### Initial-release exception: retained deferred subsystems

The following native Lila subsystems are intentionally not advertised in initial-release
navigation but remain in the repository for possible future use:

- Dedicated Arena tournament discovery.
- Swiss tournaments.
- Simultaneous exhibitions.
- Puzzle Streak, Puzzle Storm, and Puzzle Racer.

Do not spend maintenance or conversion effort on their deferred pages unless the task explicitly
includes them. Do not delete their routes, models, structural variant support, or reusable
infrastructure merely because they are hidden. Shared changes must not casually break or
remove retained infrastructure; this does not authorize a full conversion of deferred pages.

The canonical initial-release tournament surface is `/tournament`, labeled **Tournaments**.
Preserve its unified use of the native Lila tournament repository, game, rating, calendar, and
history paths. Do not replace it with competing discovery surfaces during unrelated work.

## 7. Investigation, verification, and durable decisions

Use independent subagent investigations when they materially improve coverage of a substantial
or cross-cutting task. Give each a bounded question; request findings with files, symbols,
callers, tests, and uncertainties rather than raw logs. Avoid overlapping editing assignments.
The main agent remains responsible for architecture, integration, and verification.

Run the relevant existing checks and add targeted regression coverage for changed behavior.
Inspect important consumers of shared changes. Use a fresh review for consequential work,
particularly migrations and shared game behavior. Report checks actually run, failures, and
verification gaps; do not substitute intention for evidence.

Record durable ownership or decision rationale when future developers would otherwise need
to rediscover it. Keep task logs, speculative explanations, and obvious code narration out of
permanent architecture documentation. Update deployment integration when necessary, and follow
[local-service cleanup requirements](deployment.md#local-service-hygiene).
