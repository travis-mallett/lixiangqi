# Performance and resource use

Read this guide when a change affects engine execution, per-user or per-game work, database
access, background processing, browser responsiveness, or high-volume storage. Apply
[architecture](architecture.md) for ownership and [data and migrations](data-and-migrations.md)
when changing persisted representations.

## 1. Optimize for the resources we actually have

Server efficiency is a major LiXiangQi design constraint. Assume limited donations and limited
ability to purchase more server resources. Fishnet may be unavailable; if introduced, it may
have only a few participating nodes. A small initial user base does not imply abundant spare
compute or a dependable volunteer-compute pool.

Prioritize avoidable server CPU, memory, database work, and network traffic. Storage matters,
particularly for game data, but is currently secondary to server compute. Do not trade a large
increase in server work for trivial storage savings.

Favor simple, efficient designs appropriate to this operating model. Neither a compute-heavy
implementation justified by hypothetical future donations nor an elaborate distributed system
built for hypothetical future traffic is the default.

## 2. Place computation deliberately

Ask which work must be trusted and authoritative, which is local to one user's experience,
and which can be reused. Conceptual ownership and execution location are separate decisions:
a shared domain module need not imply expensive server-side execution.

Prefer browser execution for substantial computation that can safely run there. Bot games
should normally use an engine running in the player's own browser rather than a server engine.
Preserve existing server validation and authority for whatever game state, permissions, and
results the product requires. Client-provided calculations are not proof of trusted outcomes.
Do not remove necessary validation merely to save CPU.

A client-side engine also needs a bounded lifecycle. Use existing engine/worker mechanisms
where appropriate; avoid blocking board interaction and rendering. Bound search time, memory,
concurrency, and repeated work according to the feature. Cancel obsolete analysis and release
workers when their consumer is gone. Do not create a fresh engine for every interaction if an
existing lifecycle can safely serve the task.

Check realistic mobile and lower-capability browser behavior. Moving work off the server is
not a success if the page becomes unusable or repeatedly exhausts the device. Reuse existing
loading, failure, and cancellation behavior rather than inventing new infrastructure casually.

If browser execution is unavailable or fails, do not silently start expensive server analysis
as a rescue path. Use an intentional product response, such as a clear unavailable state, or
an explicitly justified alternative. A legitimate fallback must be designed and budgeted; it
is not a reason to revive an obsolete algorithm.

## 3. Do not make Fishnet an assumed dependency

Do not make an otherwise viable core feature depend on prompt access to distributed engine
workers. Design against the currently available capacity, including zero nodes.

Where a feature genuinely needs trusted remote analysis, identify that requirement separately
from optional local analysis. Reuse existing scheduling mechanisms and keep requests bounded.
Define the behavior when capacity is absent or saturated rather than assuming workers will
appear or launching an unbounded queue.

Do not build a new distributed-compute service or provision server engines simply to avoid
acknowledging an unavailable optional capability. Any such architectural commitment needs a
real product requirement and an explicit resource tradeoff.

## 4. Inspect work that multiplies

Give extra attention to work performed per move, websocket message, page request, user, or
game. A small cost repeatedly incurred can matter more than a large one-time administrative
operation. Inspect the actual call path before optimizing a visible symptom.

For a potentially expensive change, identify:

- **Frequency and growth:** what triggers the work and whether it grows per request, player,
  active game, historical record, or whole collection.
- **CPU and allocation:** repeated parsing, serialization, reconstruction, analysis, or large
  temporary objects that could be avoided without obscuring the design.
- **Database access:** unnecessary round trips, repeated lookups, broad scans, oversized reads,
  and whether existing indexes and query patterns match the real workload.
- **Concurrency and lifecycle:** duplicate jobs, uncancelled work, unbounded queues, orphaned
  workers, or repeated computation across consumers.

Prefer eliminating unnecessary work at its owner over hiding it behind a page cache or moving
it into another service. Use shared results, batching, or targeted queries when they preserve
correctness and are simpler than repeated independent work.

Do not add cache layers indiscriminately. A cache should have clear authoritative source data,
bounds, invalidation or refresh behavior, and acceptable staleness. Do not make a derived cache
a competing source of truth or let it hide inconsistent domain calculations.

## 5. Storage and database tradeoffs

For high-volume game data, assess representation size, redundant fields, indexes, read/write
patterns, and conversion cost. Do not maintain both an old and a new field merely to avoid a
one-time migration. Use the canonical target model and migrate under the
[data safety requirements](data-and-migrations.md).

Compact encodings and justified derived fields are acceptable when their semantics and owner
are clear. Denormalization may be appropriate when it meaningfully reduces expensive work;
conceptual purity alone is not a reason to multiply queries. Conversely, small byte savings
do not justify opaque code, lost user information, or excessive decoding cost.

Evaluate indexes against actual access patterns and update costs. Do not propose a new index,
cache, or representation solely because it sounds scalable. If deployment requires creating
or changing an index, account for that operational step in [deployment](deployment.md).

Migration and administrative tooling may use downtime, but still must fit available memory
and storage. Prefer bounded processing for large collections. Include backup and temporary
working-space needs; a smaller final database does not eliminate transition-space requirements.

## 6. Learn from the foundation; limit new machinery

Before replacing an inherited performance-sensitive mechanism, understand what problem it
solves. Lichess may have learned constraints at scales LiXiangQi has not reached. That insight
is valuable even when its deployment resources differ from ours.

Prefer existing project dependencies, worker lifecycles, data access, and scheduling mechanisms.
A new library or service needs enough value to justify its ongoing maintenance and resource
cost. Do not create generic caching, job, or engine frameworks for one feature without a
concrete reason.

Choose an efficient straightforward solution when one exists. A more elaborate optimization
needs evidence or a clear, material cost model. Do not use "avoid premature optimization" to
justify obviously repeated expensive work, or "future scale" to justify unnecessary complexity.

## 7. Verification and reporting

For a performance-sensitive change, compare representative behavior before and after where
practical. Use existing profiling or test tooling first. Measure the relevant quantity: server
CPU or memory, queries, elapsed time, request volume, browser responsiveness, or stored size.
Do not substitute a fast local UI for evidence that server work decreased.

Record workload, environment, and important limitations. Separate measurements from estimates;
do not claim production throughput or a specific speedup without evidence. Test cancellation,
repeat requests, or saturation when the change affects those paths. Verify correctness remains
intact, especially for game state, clocks, and user data.

Keep verification proportionate. A small static icon replacement normally needs no performance
study. Moving engine execution or changing a hot database path does. Report remaining resource
risks rather than adding a large mitigation system without a justified requirement.

Stop task-started engines, services, and launchers after verification; follow
[local-service hygiene](deployment.md#local-service-hygiene).
