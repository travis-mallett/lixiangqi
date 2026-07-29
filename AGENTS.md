# Lixiangqi contributor scope

## Initial-release deferred features

The following native Lila subsystems remain in the repository for possible future use, but they are intentionally not advertised in the initial Lixiangqi navigation:

- dedicated Arena tournament discovery;
- Swiss tournaments;
- simultaneous exhibitions;
- Puzzle Streak;
- Puzzle Storm;
- Puzzle Racer.

Do not spend maintenance or conversion effort on these deferred pages unless a task explicitly brings one of them into scope. Do not delete their routes, models, structural variant support, or reusable infrastructure merely because they are hidden.

The canonical initial-release tournament surface is `/tournament`, labelled **Tournaments**. It uses the native Lila tournament repository, game, rating, calendar, and history paths. Preserve that unified page when maintaining currently released features.
