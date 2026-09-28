# Xiangqi puzzle classification

Classification logic is maintained in `tools/xiangqi_data/puzzle_mining`.
Each named theme owns an explicit logic version in the classifier registry.
When a theme's behavior changes, increment that theme's version and add a
short entry here. The offline categorizer uses those theme versions when
deciding whether a candidate's per-theme scan is current.
Evidence-only taxonomy changes reuse stored proof. A theme that needs a new
engine proof is queued for a worker that inspects the stored canonical traces;
the canonical verifier line remains unchanged.

Classifier workers write category results to the mining database and notify
their supervisor. When `--catalog-db` is supplied, the supervisor alone carries
completed changes into the authored catalog, coalescing notifications at the
poll interval and flushing at the end of a finite pass. Reconciliation probes
only authored puzzle IDs, so unrelated mining history does not extend the
catalog write transaction. Restarting categorization reconciles already saved
results even when no new classification work remains; no force recheck is needed.

## Double Cannons (重炮杀)

Theme key: `doubleCannons`; logic revision: `1.0`.

Every verified terminal branch must be checkmate, not stalemate. On a rank or
file from the losing general, the first occupied square must contain a winning
cannon and the next occupied square must contain the other winning cannon.
The nearer cannon is the only screen for the farther cannon's checking attack.
Both colors, either axis, and arbitrary spacing qualify. The final move may
move the attacking cannon, place the screen, or uncover the checking line.

The verified terminal board proves this motif directly; no counterfactual
engine inspection or search is needed. Other motifs retain their existing
counterfactual requirements and the single-category branch agreement policy.
The registry addition invalidates older taxonomy snapshots automatically and
reuses stored complete verification traces. No data migration is needed.

Puzzle Studio supports filtering, tag editing, release admission, and audits
through its shared registries. Deploy application code before publishing puzzles
with this theme. The adjacent deployment workspace's `push-local-live.ps1`
packages public assets and translations and validates each puzzle-theme asset
against the build source, including `doubleCannons.webp`, in the prepared release.
Deployment does not publish or reclassify puzzles.

## White Faced General (白脸将)

Theme key: `whiteFacedGeneral`; logic revision: `1.1`.

Only complete verified forced-mate branches qualify. In each terminal position
(checkmate or Xiangqi stalemate):

1. The generals must occupy adjacent files, never the same file.
2. The losing general's horizontal one-step palace move onto the winning
   general's file defines the flying general escape square.
3. That square must be empty: neither side may occupy it.
4. The winning general must have an unobstructed file to that square, and no
   other winning piece may attack it.

Pikafish's `d` inspection after the horizontal step must identify the winning
general as the **only** attacker. All other pieces stay in place; there are no
captures, vertical moves, piece removals, or searches of the continuation.
Revision 1.1 replaces the broader 1.0 rule, which allowed captures and vertical
escapes. Old classification and counterfactual evidence must be reassessed.

The categorizer persists all counterfactual inspections, tied to the canonical
verification assessment, branch, and theme revision. Failed inspections leave
classification pending; current evidence can be reused without engine work.
The existing single-category agreement policy applies across every verified
branch, including when this motif overlaps another category.

Run `scripts/categorize-checkmate-puzzles.py` against the local mining database.
The new revision automatically makes older taxonomy snapshots eligible for
reclassification; no forced same-version rerun or data migration is needed.
Puzzle Studio recognizes the category for filtering, moderation, audits, and
normal release admission. Review its categorized output, then prepare and publish
through the existing Studio workflow. Deploy application code before publishing
the new theme: `push-local-live` packages the theme translations and icon and
checks that the icon exists in the release. Deployment does not publish puzzles.

## Octagonal Horse (八角马)

### Version 1.1

The verified terminal position is checkmate or stalemate (the defending side
has no legal moves). A winning horse occupies a corner of the defending
palace, with the defending general on its diagonally opposite corner. All
four corners of either palace qualify.

The categorizer physically removes that horse, inspects the modified FEN with
Pikafish, and requires at least one newly legal inward orthogonal move by the
defending general. This canonical legal-move check accounts for horse legs,
captures, discovered lines, cannons, flying generals, and every other attack.
The horse is accepted only when one bounded MultiPV=1 root search then shows
that the original forced terminal win is gone. A positive defender mate or a
centipawn result qualifies under the no-mate-found-at-budget policy. A
negative defender mate means another forced win remains. Incomplete, bounded,
illegal, or missing searches remain inconclusive. Every verified branch must
pass.

The verifier categorizer revision is `4`, enabling queued candidates rejected
by the earlier checkmate-only verifier to be examined again. Generic `mate`
and mate-length tags cover both kinds of terminal win in Xiangqi; the stored
`checked` flag continues to distinguish checkmate from stalemate.

The theme key is `octagonalHorse` and its logic revision is `1.1`. Theme
titles use translated names followed by the fixed Chinese reference in
parentheses; Chinese locales display only `八角马`.

## Centroid Pawn Attack (小鬼坐龙廷)

### Version 1.4

The terminal checkmate or stalemate retains the same palace geometry. Test
both inward one-step general moves (horizontal and vertical). Skip a square
occupied by the defender's own piece; capture an enemy non-general on the
destination square. Retain the centroid pawn and inspect attacks after moving
the general and removing any captured piece. The pawn must be the sole attacker
of at least one such destination. Pikafish's `d` command accounts for cannon
screens, horse legs, discovered lines, and flying generals without searching.

Current complete inspections are cached by verification assessment, branch,
and theme revision; identical terminal boards share inspections within one
candidate. Version 1.3 removal evidence cannot authorize this rule. The version
bump schedules existing classifications for reassessment using stored verified
solutions, without reconstruction or a database migration. Restart Categorize
to use this logic; publication remains the separate existing Studio workflow.

### Version 1.3

The terminal position is checkmate or stalemate. It retains the version 1.1
palace geometry. The categorizer removes the centroid pawn, requires a newly
legal inward general move from canonical Pikafish move generation, and then
runs one bounded MultiPV=1 root evaluation. A negative defender mate means a
forced win remains. A positive defender mate or a centipawn result qualifies
under the no-mate-found-at-budget policy; incomplete or bounded evidence is
inconclusive. Removal evidence is stored per branch; pre-1.3 geometry-only
ledgers are reverified rather than inferred from FEN.

### Version 1.1

The terminal position is checkmate. A surviving soldier occupies the center
of the defending side's palace (`e9` against Black or `e2` against Red), and
the defending general is on a corner of its back rank (`d10` or `f10` for
Black, `d1` or `f1` for Red). The soldier must not itself attack the general;
another piece supplies the checking attack while the soldier restricts the
general's escape squares.

### Version 1.0

The earlier matcher identified a center palace soldier with the opposing
general on the center square of the back rank (`e10` against Black or `e1`
against Red). This definition was replaced by version 1.1 because a centered
general is not restricted by the soldier in the required way.

## Reclassifying published puzzles

Use the authored catalog's frozen-release audit described in [Puzzle operations](PUZZLE_OPERATIONS.md).
`categorize-checkmate-puzzles.py` classifies mining candidates; it does not publish or audit the production inventory.
The catalog audit records conclusive positives, conclusive negatives and unresolved evidence separately. Removing a label and retiring a puzzle are explicit, separate decisions.

Verification constructs complete solution branches independently of category
matching. Categorization evaluates each basic kill against those saved branches;
a category qualifies only when it holds across all branches. Multiple categories
can qualify. Generic mate-length tags cannot supply eligibility.

The retained input pool includes both matching and non-matching eligible verified
solutions. Results are keyed by verification assessment, category, category version
and consensus policy. Normal categorization runs only missing or inconclusive
checks. A new category is checked across the pool; a version change reruns only
that category. A new verification assessment requires new category checks.
Completed checks are saved individually so interrupted runs resume naturally.

A complete taxonomy assessment is derived from those current category results.
Category-only changes update the existing publication ID; a different solve gets
a different ID, and returning to an earlier solve reuses its saved identity.
Studio's **Force recheck…** repeats same-version category checks over this same
pool without reconstructing solutions. It is unnecessary for new or updated logic.

## Double Chariots Checkmate (双车错)

The theme key is `doubleChariotsMate`, logic revision `1.1`. Only verified checkmate qualifies. Pikafish must identify a winning chariot among the terminal checking pieces. Move the losing general to each adjacent empty palace square, retaining every other piece. Any occupied destination is excluded, regardless of side or piece type. Protecting the checking chariot from capture does not count as blocking an escape. At least one resulting position must have exactly one checking piece: a winning chariot distinct from a terminal checking chariot. Other attacks, including attacks exposed by vacating the original square, disqualify that escape as an exclusive block. Stalemates and a single chariot doing both jobs do not qualify.

Attack inspection uses the same canonical Pikafish oracle as white-faced general, without a search or removal of either chariot. Complete terminal and escape inspection records are bound to the terminal FEN and logic version and reused on later passes. Incomplete evidence remains pending; every verified branch must match before the category is assigned.

Revision 1.1 excludes captures previously allowed by 1.0. Puzzle `BtJ8z` is a regression example: both terminal branches relied on protection of the chariot on f10, rather than exclusive control of an empty escape. Categorization automatically reassesses the changed theme without repeating verification; existing 1.0 attack evidence is stale. Review and publish the resulting catalog changes through Puzzle Studio.

## Elbow, Angler, High Angler, and Palcorner Horse

Theme keys: `elbowHorse`, `anglerHorse`, `highAnglerHorse`, `palcornerHorse`;
initial logic revision: `1.0` for each.

Every verified branch must end in checkmate. A winning horse must occupy files
3 or 7 on the losing side's second, third, or fourth rank respectively; a
Palcorner Horse occupies any corner of the losing palace. Pikafish must identify
that horse as a terminal checker or as an attacker after an adjacent palace step
by the losing general. Empty squares and captures of winning pieces qualify;
losing-side occupants do not. Captured pieces are removed before inspection,
so horse legs and capture of the signature horse are handled by canonical rules.
Shared attack coverage counts; no exclusive attack or removal search is required.

The shared horse-role assessor persists versioned, board-bound attack evidence.
Existing category results remain reusable while the four new checks become
pending automatically in the categorizer and Studio. No data migration is needed.
Studio's category selection, progress, tag filters, audit plans, and release
admission use the existing shared registries. The Themes page uses the existing
localized theme keys with descriptive English text and dedicated post icons.
The adjacent deployment workspace checks all four icons in prepared payloads.
Deploying application assets does not reclassify or publish puzzle content;
use the existing categorization and Studio publication workflow for that.

## Single Horse Captures the King (单马擒王)

Theme key: `singleHorseCapturesKing`; logic revision: `1.0`.

Every verified branch must terminate in stalemate, without check. Inspect all
adjacent palace steps by the losing general, excluding losing-side occupants
and removing captured winning pieces before inspection. Every escape must have
at least one attacker. Across all escapes, exactly one winning horse must
contribute; the only permitted additional attacker is the winning general via
the flying-general rule. The horse must control at least one escape. An empty
escape set or flying-general control alone does not qualify. Additional horses
may remain on the board but must not attack any escape, even redundantly.

The shared horse-role assessor uses canonical Pikafish attack inspections and
persists complete, board-bound, versioned evidence. It performs no continuation
search. Registry-driven categorization, Studio progress, audit selection, tag
editing, and release admission include the new category automatically. Existing
verification remains reusable; the added category becomes pending without a
migration or forced scan. Deployment validates the dedicated theme icon, while
puzzle classification and publication remain part of the normal Studio workflow.

## Horse Cannon Checkmate (马后炮) and horse-post exclusions

`horseCannonMate` starts at `1.0`. Elbow, Palcorner, Angler, and High Angler
Horse advance to `1.1`; Single Horse Captures the King stays at `1.0`.

In each verified checkmate terminal board, a winning cannon must check over
exactly one winning horse. That same screen horse must be the sole attacker
on at least one adjacent palace escape after the general moves and captures
any winning occupant. Losing-side occupants are excluded. Another attacker,
even the winning general or a second horse, prevents that escape from proving
the motif. Other escapes may have shared coverage.

The shared attack assessor proves both the new category and the exclusion:
a terminal horse-cannon mate does not also receive any of the four horse-post
categories, even if another horse qualifies. Cannon screens alone, without an
exclusive escape restriction by that screen horse, do not exclude a horse post.
Complete escape evidence is required before accepting a checking horse when a
horse-screened cannon also checks. New logic versions automatically queue old
horse-post results and invalidate their old evidence. Verification is retained.
Studio uses the shared category registry for selection, audits, and publication;
deployment validates the new icon. No persistent-data migration is required.

### Throat Cutting Checkmate (大刀剜心)

`throatCuttingMate`, logic `1.0`, requires the final three verified plies: a winning chariot captures an opposing advisor on e9 (Black palace) or e2 (Red palace), the other opposing advisor recaptures that chariot on the same square, and the remaining winning chariot moves to deliver checkmate. A board-bound Pikafish attack inspection must identify that final moving chariot as the sole checker. Stalemate, double check, and a discovered check by another piece do not qualify. Stored decision boards are replayed and checked against the terminal board; missing or inconsistent sequence evidence remains inconclusive. Every verified branch must qualify under the existing consensus policy.

### Small Throat Cutting Checkmate (小刀剜心)

`smallThroatCuttingMate`, logic `1.0`, uses the same sequence and attack-evidence implementation as Throat Cutting Checkmate. Only the piece choices differ: a winning pawn captures the central advisor on e9 (Black palace) or e2 (Red palace), the other advisor recaptures that pawn, and a winning chariot or pawn makes the final move and is the sole checker in the checkmate position. All verified branches must qualify. Missing sequence evidence remains inconclusive; stalemate, another finishing piece, and double check are excluded.

### Double Chariots Threatening the Advisor (双车胁士)

`doubleChariotsThreateningAdvisor` checks the complete verified line for a winning-side capture of the losing advisor on e9 (Black palace) or e2 (Red palace), with winning chariots on d9/f9 or d2/f2 immediately before the capture. Any number of verified moves may follow. The terminal position must satisfy the canonical Double Chariots Checkmate proof: a chariot checks, and a different chariot exclusively blocks at least one empty palace escape. The category reuses that implementation and its persisted terminal inspections; it does not impose Throat Cutting's sole-checker restriction. All branches must meet both requirements. Missing or inconsistent sequence evidence remains inconclusive. Its version combines sequence revision `1.0` with the current Double Chariots Checkmate revision so changes to either invalidate prior verdicts.

### Moon Scooping Checkmate (海底捞月)

`moonScoopingMate` combines sequence revision `1.0` with the current White-Faced General revision. A winning cannon move must establish a new same-file attack ordered cannon → losing general → losing chariot from the defender's home edge toward the attacker, with the general the sole screen. The general may already be advanced at the puzzle root. Pikafish legal-move inspection, with the attacker to move on that board, must confirm the cannon capture threat.

Track the individual cannon and threatened chariot through the complete verified ledger. The threat must persist until that defender leaves the file or is captured. A surviving winning chariot must then enter the exposed file (or capture the defender there), and that same chariot must check the general on that file in the terminal position. The defender may return to interpose and be captured. The cannon may be sacrificed after dislodging the defender. There is no move-count limit, material-balance restriction, fixed cannon route, or requirement that the cannon occupy the literal back rank rather than another square behind the general.

The terminal position must independently pass the shared White-Faced General proof: at least one empty horizontal escape is prevented exclusively by the opposing general. Stalemate and a purely material-winning endpoint do not qualify. Every verified branch must satisfy the sequence and terminal requirements; incomplete sequence or attack evidence remains inconclusive. Rear-attack inspections are versioned and reusable, and the existing White-Faced General inspection is shared. No engine search is performed by this detector.

The sequence follows the [Chinese annotated maneuver](https://www.xiangqiqipu.com/Article/View-15039.html) and its cannon-sacrifice variation, with the material-winning example continued to an actual mate for categorizer tests.

### Iron Bolt and Small Iron Bolt

Iron Bolt (`ironBolt`) and Small Iron Bolt (`smallIronBolt`), both logic `1.1`, require terminal checkmate with a winning cannon and losing general on file e. Exactly two pieces intervene: one losing advisor and one losing elephant, in either order. No other piece may intervene. Any other winning cannon must be off the losing side's back rank at the terminal position (rank 10 for Red's cannon, rank 1 for Black's). A second cannon is not required, and losing-side cannons are unaffected. Other pieces outside the cannon–general segment remain unrestricted. Version `1.1` causes earlier verdicts for both categories to be reassessed. Iron Bolt requires a winning chariot in the terminal checker list, and Small Iron Bolt requires a winning pawn. Additional simultaneous checkers are allowed. Stalemate does not qualify. Both use one shared formation predicate and the existing validated terminal checker inspection, persisting versioned board-bound proof without continuation searches. Every verified branch must match. Studio tagging, filtering, audits, and publication support both. Restart Studio and run Categorize to assess existing inventory. Theme pages and icons already exist; normal deployment asset validation handles them without a script or schema migration.

### Old Pawn Searching the Mountain

Old Pawn Searching the Mountain (`oldPawnSearchingMountain`, logic `1.1`) requires terminal checkmate where the final winning move moves a pawn one file left or right along the losing side's back rank (rank 10 for Red's pawn, rank 1 for Black's), and that same pawn gives check. The pawn must already occupy the back rank before the move; advancing onto it does not qualify. Additional checking pieces remain allowed. The final decision board is replayed using the shared final-move validator, and saved evidence is bound to that board, the final move, and the terminal position. Missing or inconsistent move evidence remains inconclusive. Version `1.1` invalidates earlier verdicts for normal recategorization. A pawn merely occupying that rank does not qualify. Stalemate does not qualify. One terminal Pikafish checker inspection supplies board-bound, versioned evidence reused by categorization. Every verified branch must match. Studio categorization, editing, filtering, audits, and publication support the category. Restart Studio and run Categorize to assess retained inventory. The Theme page and icon already exist and use automatic deployment asset validation; no migration or deployment-script change is required.

### Stalemate, Leisurely Stroll, Headhunter Cannon, and Cross-Check

Headhunter Cannon uses logic `1.1`; the other three categories use `1.0`. `stalemateMate` matches every verified terminal stalemate, regardless of which winning piece moved. `leisurelyStrollMate` additionally requires that the final winning move moved the general. The final decision board is replayed to verify the piece and bind the move to the terminal board; missing or inconsistent final-decision evidence remains inconclusive. Both categories reject checkmate and positions with legal replies. Neither requires engine inspection beyond existing verification.

`headhunterCannonAttack` matches a terminal win (checkmate or stalemate) where the losing general is on file e and the nearest occupied square in either direction on that file is a winning cannon. Any intervening piece disqualifies that cannon, regardless of color or type. The unscreened alignment remains required. At terminal checkmate, no winning cannon may appear in the terminal checker list, including as part of a multiple check. One Pikafish terminal checker inspection establishes this condition; missing or invalid evidence remains inconclusive. Existing stalemate matches remain allowed without inspection. Version `1.1` causes earlier Headhunter verdicts to be reassessed.

`crossCheckAttack` requires verified terminal checkmate and an enemy checker attacking the winning general immediately before the final winning move. One Pikafish checker inspection of the validated final decision board establishes the prior check; the verifier owns legality of the final move, its resolution of check, and terminal mate. Saved inspection evidence is bound to that pre-move board, final move, terminal board, and logic version. Missing, stale, malformed, or failed inspections remain inconclusive. Stalemate and an ordinary checkmate played from a position without check do not qualify.

The categories use the existing every-branch consensus and versioned recategorization paths. Studio editing, filtering, audits, and publication admit all four. Theme pages, translated names, lessons, and images already exist; deployment discovers these assets automatically. No schema or production-data migration is necessary.

### Flanking Trio Checkmate (三子归边)

`flankingTrioMate`, logic `1.3`, requires the same winning chariot, horse, and cannon in one flank of enemy territory from the starting solution position through every move to checkmate. The fixed box is files a–e or e–i, including the center file, and ranks 6–10 when Black loses or 1–5 when Red loses. Exactly those three winning non-pawn pieces must occupy that box throughout the entire solution. Enemy occupants are unrestricted. Both boxes are checked at every position: two qualifying trios are forbidden, and a trio entirely on the shared center file does not qualify. A trio that forms later, loses or replaces a member, temporarily leaves the box, or switches flanks disqualifies the solution.

Winning pawns are permitted in either flank, but throughout the entire solution every winning pawn must stay at least two orthogonal steps from the nearest square of the losing palace (files d–f, ranks 8–10 for Black or 1–3 for Red). This is geometric distance, independent of occupants or legal moves: a black pawn on d5 is allowed, d4 is forbidden, and c4 is allowed at distance two from d3. The restriction applies to the initial position and after every move. Other winning non-pawn pieces outside the identified box are allowed.

Original squares identify pieces throughout replay. All three of those same pieces must move at least once during the solution; movement by other pieces of the same type does not count. Each of those exact three pieces must also have checked the losing general or controlled at least one palace escape at some position during the solution. Contributions are tracked by original identity, not piece type, at the starting position and after every move. The standard palace-escape helper excludes defending occupants and moves the general before inspecting attacks, removing any captured winning occupant; occupying an escape alone does not count. Shared control counts and need not be exclusive. At least one of the surviving trio must check in the terminal position; additional winning checkers are allowed. Stalemate does not qualify. The saved proof is bound to the initial board, moves, identities, flank, and terminal board. Missing or inconsistent move ledgers remain inconclusive. Pikafish inspects the terminal checker list, then earlier positions and hypothetical palace escapes as needed. Repeated boards reuse an inspection, and positive assessment stops once all three contributions are proved. A non-match requires complete contribution coverage; missing or malformed evidence remains inconclusive. Proof records bind each inspection to its ply, general move, and board. No continuation search is performed. Every verified branch must qualify under the existing consensus policy.

The CnYRJ regression covers all three saved branches: its horse and chariot enter the left arena during the solution, its cannon remains on a1, and its black pawn stays on d5. All branches are rejected under `1.3`: the trio is absent initially and the cannon never moves. The version change invalidates prior category verdicts for normal recategorization. Studio categorization, audits, editing, filtering, release admission, Theme page, and deployment asset validation already support the theme; no schema or production-data migration is needed.

### Double, Triple, and Quadruple Check Checkmate

`doubleCheckMate`, `tripleCheckMate`, and `quadrupleCheckMate`, each logic `1.0`, require a verified terminal checkmate with exactly two, three, or four distinct winning-side pieces checking the losing general, respectively. A triple check does not also qualify as a double check, and a quadruple check qualifies only for the quadruple-check category. Stalemate and nonterminal checks do not qualify. Piece types, escape-blocking roles, and which piece moved last do not affect these categories.

One terminal Pikafish checker inspection supplies the proof. The existing board-bound attack-evidence validator rejects missing squares, duplicate checker identities, and mismatched boards; a losing-side checker also invalidates the evidence. All three categories reuse saved inspections for the same verification, branch, and logic version, recomputing their own outcomes from the checker count. No continuation search is needed. Every verified branch must satisfy the same exact count under the existing branch-consensus policy; missing inspection evidence remains inconclusive.

The shared registry queues existing verified inventory automatically. Studio tag editing, filtering, audits, and release admission support all three categories. Their Theme pages, lessons, and icons already exist, and deployment packages those assets through the existing mechanism. No schema, data migration, or deployment-script change is required.

### Servant Crowding Master Attack (臣压君)

`servantCrowdingMasterAttack`, logic `1.0`, requires a verified terminal checkmate or stalemate. Every orthogonally adjacent destination within the losing general's palace must be occupied by a losing-side piece. Diagonals and squares outside the palace are not movement paths. An empty square or a winning-side occupant disqualifies the pattern, even if the square is attacked or the occupant is protected. The checking piece, number of checkers, and previous moves do not matter.

This is a direct terminal geometry match using the shared palace-step geometry; it performs no attack inspections, piece removals, or engine searches. Every verified branch must qualify. The registry queues retained verified inventory for the new category automatically. Studio tag editing, filtering, audits, and release admission support the category. The Theme page, lesson, and icon already exist; no deployment-script or data migration change is required.

### Smothered Cannon (闷宫)

`smotheredCannon`, logic `1.2`, checks the position immediately before the winning side's final move. All adjacent palace destinations must be occupied by the losing side's own pieces, except that at most one destination may instead be controlled by the winning side. For that remaining step, move the losing general there, remove any captured winning occupant, and inspect attacks with the defending side to move. Any winning attacker suffices; shared control is allowed. Two or more destinations not occupied by defending pieces disqualify the pattern, even if every destination is attacked. Control established only by the final move does not satisfy the pre-move condition.

The verified terminal position must be checkmate with exactly one piece in Pikafish's checker list: a winning cannon whose sole screen is a losing-side advisor. Double and triple checks do not qualify. The cannon need not make the last move. The detector replays the last stored decision to bind the two boards and persists complete, versioned attack evidence. Missing or inconsistent required decision boards remain inconclusive, and every verified branch must qualify. It uses the shared palace-step builder and attack-evidence validation without continuation searches. Adding the registry entry queues existing eligible inventory automatically; Studio editing, filtering, audits, and publication already support this theme.

### Spring Horse Checkmate (拔簧马)

`springHorseMate`, logic `1.0`, examines only the final two positions of each verified mating branch. Immediately before mate, the winning chariot occupies the leg of a winning horse that would otherwise attack the losing general. The final move takes that same chariot off the leg. On the terminal board, that same horse must be the sole checker, and the moved chariot must be the sole attacker on at least one initially empty adjacent palace escape after the losing general moves there.

The detector replays the last verified decision and checks it against the terminal board. Horse-leg geometry comes from the shared attack helper; empty escapes and exclusive control use the existing palace-step builder and board-bound Pikafish attacker inspections. Occupied escape squares, shared coverage on every escape, another chariot supplying the exclusive control, double checks, and stalemate do not qualify. Other escapes may have shared coverage. Earlier moves impose no additional conditions.

Complete evidence is versioned and bound to the previous board, final move, terminal board, and each inspected escape. Missing or inconsistent final-decision evidence remains inconclusive. Every verified branch must qualify. This detector performs attack inspections only, without continuation searches. The registry automatically queues the added category for retained verified inventory and exposes it in Studio audits; no schema migration or forced scan is needed.

## Chariot Mating Methods (车杀)

Theme key: `chariotMatingMethods`; logic revision: `2.0`.

Every verified checkmate branch is inspected on each solution turn and at the
terminal board. If the losing general is checked, every Pikafish checker must
be a winning-side chariot. A chariot check combined with a horse, cannon,
soldier, general, or any other checker does not qualify. When the winning side
is not in check, its moving piece must be a chariot; a winning-side check
allows any legal piece to answer it. The terminal position must contain the
final check inspection and that inspection must have at least one winning
chariot checker.

The complete, move-bound attack ledger is persisted per verification branch.
The shared registry queues retained verified inventory, and Puzzle Studio uses
the same version for normal categorization, audits, filtering, tagging, and
publication admission. The existing theme-page entry and `chariotMatingMethods`
asset are already part of the application asset packaging, so no schema or
deployment allowlist change is required.

## Mating Methods by Piece Type

The remaining 14 piece-type themes use the same trace-level contract as
`chariotMatingMethods`, with the category's piece set substituted for
chariots. The single-piece sets are horse, cannon, and soldier; the combined
sets are the corresponding two-, three-, and four-piece combinations already
listed by `PuzzleTheme.pieceTypeMates`.

On every board where the losing side is to move, all checkers must be winning
pieces from the selected category. A double or triple check is therefore valid
when every checker belongs to the category, but one checker from any other
piece type makes the category fail. On a board where the winning side is not in
check, its selected move must also be made by a winning piece from the
category. If the winning side is in check, its legal evasion may move any
piece. The terminal board must contain at least one category checker.

Logic revision `2.0` additionally requires every named piece type to make at
least one winning move while the winner is not in check, within each verified
branch. A stationary piece, even one giving check, does not supply a missing
move type. Check evasions do not supply it either. Thus a chariot-only attack
cannot receive any combined piece-type category. Each branch must satisfy
the complete rule independently; participation cannot be pooled across branches.
The earlier subset rule incorrectly classified `xrG6c` under all eight sets
containing chariots. Its three retained solutions now match only
`chariotMatingMethods` in this family; `doubleChariotsMate` and `mateIn8`
remain independently valid.

Each category has its own versioned, move-bound evidence ledger. The 15
themes are registered with the offline matcher and classifier, exposed to
Puzzle Studio audits and normal categorization, and admitted by the catalog
publication allowlist. Their existing theme assets are already packaged, so
deployment needs no separate static allowlist or migration.
