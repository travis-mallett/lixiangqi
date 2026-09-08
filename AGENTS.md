# LiXiangQi Agent Instructions

LiXiangQi is an independent xiangqi-focused fork of lichess.

Use the existing lichess architecture as a mature foundation and source of hard-won engineering lessons, but implement for LiXiangQi rather than preserving historical behavior or former-upstream compatibility by default.

The goal is not merely to make a requested change work. Leave the affected system correct, coherent, performant, maintainable, and understandable to human developers.

## Repository scope

### Independent fork

Do not merge, rebase, cherry-pick, or otherwise import commits from `lichess-org/lila`.

Implement future changes specifically for LiXiangQi. Existing lichess code remains valuable reference material, but the repository is not maintained by synchronizing with former upstream.

### Deferred initial-release features

These native Lila subsystems remain available for possible future use but are intentionally not advertised in the initial LiXiangQi navigation:

- dedicated Arena tournament discovery;
- Swiss tournaments;
- simultaneous exhibitions;
- Puzzle Streak;
- Puzzle Storm;
- Puzzle Racer.

Do not spend maintenance or conversion effort on deferred features unless a task explicitly brings them into scope.

Do not delete their routes, models, structural variant support, or reusable infrastructure merely because they are hidden.

The canonical initial-release tournament surface is `/tournament`, labeled **Tournaments**. It uses the native Lila tournament repository, game, rating, calendar, and history paths. Preserve this unified page when maintaining released tournament functionality.

## Engineering approach

### Fix the owning layer

Implement changes at the lowest appropriate layer that conceptually owns the behavior.

Prefer correcting a shared board, game, explorer, domain, service, or other owning module over adding page-specific or caller-specific patches.

Do not avoid fixing the correct shared layer merely because broader regression checking is required.

Lowest appropriate does not mean lowest possible: do not push feature-specific behavior into a generic abstraction that should not own it.

### Fix causes, not symptoms

Avoid compensating for an underlying defect with:

- page-level or UI patches;
- duplicate validation;
- special-case overrides;
- parallel calculations;
- fallback implementations that hide the real failure.

Make the owning implementation correct.

## Prefer the clean final architecture

For substantial redesigns, determine the best permanent design first:

> If we were building this subsystem correctly from scratch today, without historical implementation or compatibility baggage, what would the final architecture be?

Then determine how to migrate the existing system to that state.

Do not let transition difficulty unnecessarily define permanent architecture.

### Keep one canonical implementation

When replacing controlled internal behavior, data formats, schemas, calculations, code, or assets:

- implement the new canonical design;
- migrate callers and existing data;
- remove the superseded implementation;
- remove obsolete fields, branches, configuration, tests, and assets.

Do not retain the previous implementation as a precautionary fallback.

Do not indefinitely support old and new internal formats when controlled data can be migrated.

Backward compatibility requires a concrete consumer or operational need; it is not the default.

External systems and interfaces require appropriate compatibility. LiXiangQi-controlled public interfaces may evolve when justified, but avoid needless disruption to real consumers.

## User data and migrations

User data is precious.

Potentially destructive migrations involving games, accounts, profiles, settings, authentication or registration data, user-created content, or similar persistent user information must preserve a recoverable copy of the pre-migration data.

The backup must allow a faulty implementation or migration to be corrected and rerun from intact original data.

The backup is for recovery, not for retaining permanent runtime support for the old format.

Migration tools should:

- validate important assumptions where practical;
- fail clearly on unexpected conditions;
- preserve information;
- provide meaningful progress or result information;
- verify important migration results.

Keep production data migrations under `tools/data_migration/` with sortable date- or version-prefixed names.

At the current project stage, planned deployment downtime is acceptable. Do not introduce dual-write or zero-downtime migration complexity merely to avoid restarting the service.

## Learn from lichess before redesigning it

Do not assume an unusual inherited lichess design is accidental or poor.

Before materially redesigning an inherited subsystem, investigate why lichess may have chosen it. Consider lessons involving:

- scale;
- database performance;
- concurrency;
- caching;
- failure recovery;
- network or browser constraints;
- security and abuse prevention;
- operational experience.

Inspect surrounding code, analogous implementations, tests, documentation, and history when useful.

After understanding those constraints, choose the architecture that best fits LiXiangQi. Learning from lichess does not mean following it blindly.

## Performance and resources

Server efficiency is an important project constraint.

Assume:

- server resources are limited;
- donations may remain modest;
- Fishnet may be unavailable or have few nodes.

Avoid unnecessary server CPU, memory, database work, and network traffic, especially for code that executes per user, move, or game.

When computation can safely and appropriately happen in the user's browser, prefer that over consuming scarce server compute. For example, bot engines should normally run client-side when product and integrity requirements allow it.

Do not prematurely build complicated scalability infrastructure, but avoid designs that are obviously expensive at higher usage when an equally maintainable efficient design exists.

Storage matters, especially for high-volume game data, but server compute is currently the stronger constraint.

## Maintainability and organization

Optimize the repository for human comprehension as well as correctness.

It is acceptable to move, rename, split, or reorganize code when doing so materially improves structure.

Prefer:

- coherent module responsibilities;
- reasonably sized files;
- predictable folder organization;
- clear ownership;
- small interfaces where appropriate.

Do not preserve confusing historical organization merely to minimize the diff.

Split files along meaningful responsibilities, not arbitrary line-count targets.

### Remove what a change supersedes

When the current change makes code or assets definitively obsolete, remove them after thoroughly checking their usages.

This includes:

- dead functions and branches;
- obsolete fields and configuration;
- old compatibility paths;
- superseded files;
- replaced icons, images, and other assets.

Do not routinely leave the old version beside the new one.

Avoid unrelated cleanup unless it is clearly safe and directly useful to the work at hand.

## Dependencies

Prefer existing project mechanisms and dependencies.

Do not add a library merely to simplify a small task if the functionality already exists or can be implemented straightforwardly without another long-term dependency.

Add dependencies when they provide substantial value that would be unreasonable to reproduce internally.

## UI and theming

For ordinary UI work, prefer shared lichess/LiXiangQi components and theme infrastructure over page-specific customization.

Reuse shared:

- theme variables;
- colors;
- typography;
- spacing;
- components;
- interaction states;
- layout conventions.

Avoid hardcoded page-specific styling when a shared mechanism should own it.

Future theme changes should propagate hierarchically rather than require many individual pages to be restyled.

Specific visual departures are appropriate when explicitly requested or genuinely required.

For meaningful layout changes, verify desktop, intermediate-width, and mobile behavior. Do not optimize only for the viewport where the issue was first observed.

## Internationalization

LiXiangQi is multilingual.

New user-facing English text should normally use the existing translation/i18n system rather than being hardcoded.

Some xiangqi terminology intentionally includes fixed Chinese characters as language-independent reference information, for example:

`[translated name] (双车错)`

Do not assume the site is generally English/Chinese bilingual.

Handle exceptional Chinese-language presentation requirements case by case unless a general system is explicitly designed.

## Deployment

For substantial architectural, runtime, dependency, or data changes, inspect `push-local-live` and determine whether deployment behavior must change.

If deployment requires a migration or other server-side step, integrate it into the deployment process rather than leaving an undocumented manual requirement.

Do not modify deployment tooling when the change has no deployment implications.

## GitHub contribution verification

Any task that prepares a commit, pull request, or push must complete the local checks that correspond to the GitHub workflows before the contribution is handed off. Formatting must happen before the final build, and every formatter or linter fix must be followed by the checks again.

From the repository root, install dependencies if needed, then run the frontend checks when the change touches frontend code or shared assets:

```powershell
pnpm install
pnpm format
pnpm run lint
pnpm run check-format
```

For changes touching `ui/`, `public/`, or the asset build, also run the asset workflow's checks. These are Bash/WSL commands, matching `assets.yml`:

```bash
./ui/build --no-install -p
./ui/test
```

From PowerShell on the prepared Windows checkout, run the same commands through Bash:

```powershell
bash -lc './ui/build --no-install -p'
bash -lc './ui/test'
```

These checks use the repository versions of Node 24 and pnpm 11 declared by `.node-version` and `package.json`.

Frontend formatting uses Oxfmt (`pnpm format` / `pnpm run check-format`); Scala formatting uses Scalafmt and requires its own checks. On Windows, use the repository's bundled Java 21 and SBT launcher because global `sbt.bat` is unreliable when the checkout path contains spaces. The prepared checkout uses:

```powershell
& .tools\jdk-21\jdk-21.0.11+10\bin\java.exe '-Dsbt.server.autostart=false' -jar .tools\sbt\sbt-launch-2.0.3.jar scalafmtAll
& .tools\jdk-21\jdk-21.0.11+10\bin\java.exe '-Dsbt.server.autostart=false' -jar .tools\sbt\sbt-launch-2.0.3.jar scalafmtCheckAll
& .tools\jdk-21\jdk-21.0.11+10\bin\java.exe '-Dsbt.server.autostart=false' -jar .tools\sbt\sbt-launch-2.0.3.jar -Depoll=true 'test;stage'
```

If the bundled JDK directory has a different patch version, discover the current `java.exe` below `.tools\jdk-21` and preserve the same launcher form. `-Depoll=true` and `test;stage` are SBT arguments after `-jar` and the launcher path. `scalafmtCheckAll` must pass after formatting, and `test;stage` is the backend build parity check from `server.yml`. For broad release or GitHub preparation, run all applicable frontend and asset checks as well as the Scala checks above. Before committing, stage the intended files, then run the staged lint checks plus staged-diff validation:

```powershell
pnpm exec lint-staged
git diff --cached --check
```

Do not use a blanket staging command; stage only the intended files. Inspect the cached diff and status after these checks. If any check changes files or fails, fix the files, stage the result, and rerun the complete relevant sequence. Stop project-owned services started during verification with `scripts/windows/Start-Lixiangqi.ps1 -StopOnly` before finishing.

## Local service hygiene

Do not leave project-owned development services or launchers running after verification.

If a task starts the LiXiangQi web application, `lila-ws`, SBT, the XiangQi explorer, Pikafish worker, or another project-owned service, stop the processes started by that task before finishing.

After a failed startup, check for project-owned SBT and forked JVM processes whose command lines reference this checkout or its local `lila-ws` configuration and clean them up.

Do not terminate unrelated Java, SBT, Python, Node, or other processes.

After verification, run:

`scripts/windows/Start-Lixiangqi.ps1 -StopOnly`

Its cleanup logic validates both executable path and command line before stopping processes.

## Investigation and verification

For nontrivial work, understand the relevant architecture before editing.

As appropriate, investigate:

- the true owning layer;
- important callers and consumers;
- stored-data implications;
- performance implications;
- existing tests;
- relevant lichess architecture;
- deployment implications;
- external compatibility requirements.

Use subagents for substantial, cross-cutting, unfamiliar, or architecture-heavy work when independent investigation improves coverage or keeps noisy exploration out of the main context.

The main agent remains responsible for synthesizing findings and choosing the final design.

Verify changes at the level appropriate to their impact. A shared lower-level fix should receive broader verification rather than being replaced by a safer-looking surface patch.

## Review standard

For significant work, review more than whether the feature works or the code compiles.

Ask:

1. Is the behavior implemented where it actually belongs?
2. Is there one canonical implementation?
3. Did the change leave obsolete code, data support, or assets behind?
4. Did compatibility concerns unnecessarily compromise the permanent design?
5. Is user data recoverable if a migration is wrong?
6. Did we understand relevant lichess architecture before departing from it?
7. Is server work reasonably efficient?
8. Is the result easier for a human developer to understand and maintain?
9. Are UI changes using shared styling and responsive where relevant?
10. Does deployment tooling account for new operational requirements?

A successful change should leave the affected subsystem closer to the architecture we would choose if building it correctly today.
