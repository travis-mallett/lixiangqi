# Frontend, themes, and localization

Read this guide for UI behavior, layout, shared components, styling, translated text, or static
asset changes. [Architecture](architecture.md) covers ownership and scope;
[performance](performance.md) covers browser compute and server-resource tradeoffs.

## 1. Correct shared behavior before patching a page

Trace the visible behavior to its actual owner. If a board interaction belongs to the shared
board, explorer, or game module, change that implementation and verify important consumers.
Do not compensate only on the page where a screenshot exposed the problem.

A local change is appropriate when the requirement really is page-specific. Do not move
feature-specific policy into a generic board primitive merely to place it lower in the stack.
Distinguish a defect in shared behavior from a legitimate difference between consumers.

Review relevant consumers such as play, analysis, puzzles, or other uses that actually exist
in the checkout. Do not assume those surfaces share an implementation without tracing it, or
convert unrelated deferred features merely because a shared component changed.

## 2. Prefer de-customization

Ordinary UI work should reuse the existing lichess/LiXiangQi foundation, not invent a new
visual identity for each page. Start with the actual shared components, theme definitions,
layout conventions, and interaction states already used in the repository.

Preserve a clear dependency direction:

`shared theme definitions -> shared components/layouts -> justified page-specific details`

Use existing color, typography, spacing, border, and interaction definitions where they fit.
Do not invent token names, a new design system, or an extra theme layer without first inspecting
what already exists. Reuse semantic definitions, not merely whichever token happens to have
the desired color today.

Avoid one-off button designs, copied style blocks, hardcoded page colors, decorative gradients,
unique shadows, and specificity overrides when shared styling should own the result. Do not
use an unrelated inherited appearance as an excuse for a local override that will complicate
the next global theme change.

When replacing an unnecessary customization, remove the obsolete override rather than layering
another override on top. The intended test is whether changing the relevant top-level theme
definition would update this surface naturally. A future dark-theme color change should not
require hunting through independent page palettes.

Explicitly requested visual departures are allowed. Keep them scoped and intentional without
creating a parallel site-wide styling system. A missing shared semantic role may justify a
shared addition; verify existing consumers before changing its meaning globally.

## 3. Verify layout across widths

For meaningful layout changes, inspect desktop, intermediate-width, and mobile presentations.
Use the project's actual breakpoints and include widths near a changed transition; do not
invent fixed viewport standards or check only the supplied screenshot dimensions.

Check the states affected by the change, not every possible state indiscriminately. Look for
wrapping, overlap, clipping, overflow, fixed-width assumptions, hidden controls, and navigation
that becomes unusable between breakpoints. Include long translated labels and relevant empty,
loading, or error states when they affect the layout.

Preserve existing keyboard, focus, semantic-control, and touch behavior while reusing shared
components. Do not replace a functioning native interaction with a visual imitation merely
to match a screenshot.

A small font, icon, or text change does not require a full redesign. Still inspect its realistic
layout effects: a changed icon box or longer label can affect alignment and wrapping. Verification
should follow impact, not the file extension edited.

Use actual rendering/browser verification when available. Report the viewports and states
checked, and any limits. A CSS read-through is not equivalent to having tested the rendered
mobile layout. Follow [service cleanup](deployment.md#local-service-hygiene) after verification.

## 4. Multilingual interface, not bilingual presentation

LiXiangQi supports multiple user-selected languages. New user-facing English text should
normally use the existing translation system. Reuse a key only when its meaning matches;
otherwise add or update the appropriate source message using the repository's conventions.

Buttons, headings, labels, tooltips, dialogs, settings, and user-visible errors are localization
content. Internal identifiers, developer logs, and code comments are not ordinary UI translation
content. Do not translate every language manually or fabricate translations merely because a
source-language key was added; follow the established translation workflow.

Do not assume every screen should display both English and Chinese.

### Fixed Chinese reference terms

Some xiangqi concepts intentionally retain Chinese terminology as a stable reference alongside
a translated name. For example:

```text
English interface:     Double Chariots Checkmate (双车错)
Vietnamese interface:  [Vietnamese translation] (双车错)
```

The human-readable label is localized; the approved Chinese reference term remains unchanged.
Keep that distinction explicit in the existing data/rendering structure. Do not leave the
English outside i18n, translate away the fixed reference, or add Chinese references to unrelated
labels without a product requirement.

Use existing approved Chinese spellings and terminology rather than inferring them from Western
chess. Do not scatter independent copies across pages when an existing shared definition owns
the concept. Preserve the site's normal localized formatting capabilities without creating a
new translation subsystem for this exception.

The Chinese-language presentation may omit duplicate text and parentheses for a particular
feature.

## 5. Replace assets, do not accumulate alternatives

When an icon, image, SVG, font resource, or other asset is replaced, determine whether the old
asset has remaining consumers. Check imports, templates, CSS, sprites, manifests, dynamic naming,
and generated-resource inputs as relevant.

Prefer replacing the existing canonical asset when it still represents the same role. If a
rename or new format is appropriate, update all relevant references and remove the now-unused
source. Do not leave an unreferenced old icon beside its replacement or retain duplicate names
as a precautionary compatibility layer.

An asset used elsewhere is not obsolete. Neither is retained deferred-feature infrastructure
merely because it is hidden. Preserve genuinely shared assets, licenses, and required source
inputs. Follow the existing build pipeline for generated output and cache invalidation instead
of inventing an asset-delivery mechanism or deleting unrelated files.

## 6. Initial-release navigation boundaries

Preserve `/tournament`, labeled **Tournaments** through the normal localization system, as the
unified initial-release tournament surface. It should continue using the native Lila tournament
repository, game, rating, calendar, and history paths rather than a competing page-specific
system.

Do not advertise or undertake conversion of dedicated Arena discovery, Swiss tournaments,
simultaneous exhibitions, Puzzle Streak, Puzzle Storm, or Puzzle Racer unless explicitly in
scope. Their retained routes, models, structural variant support, and reusable infrastructure
are not dead code. See the [architecture scope policy](architecture.md#6-remove-superseded-material-preserve-deliberate-scope).

## 7. Frontend completion check

Before finishing, verify that the behavior lives at its correct owning layer; shared theme
changes propagate without new local styling debt; relevant widths and translated text fit;
and replaced assets and overrides are actually cleaned up. Preserve unrelated consumers and
report any verification gaps.

For engine or other expensive browser work, also apply [performance](performance.md). For build,
runtime, or deployment requirements introduced by the UI change, inspect
[deployment](deployment.md) rather than assuming a source edit alone is sufficient.
