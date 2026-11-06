# Blog paragraph spacing review — November 5, 2026

Manchu+ (`4wtrgg9Y`) was added through the production post's **Edit Carousel → Add**
control and its homepage card verified. Official status and carousel membership
are separate settings. The writing guide now requires both for official posts.

## Findings and correction

Toast UI 3.2.2 deliberately serializes adjacent visual paragraph nodes with one
newline; its Markdown-to-editor converter inserts an empty visual node between
Markdown paragraphs. One Enter therefore does not mean a Markdown paragraph
boundary. Preserve this editor behavior and document two Enters for paragraphs.
Do not replace every newline globally: lists, quotations and intentional line
breaks have different meanings.

The six published official articles were backed up and inspected through their
editors and public pages. They currently have proper paragraph blocks:

| Article        | ID       | Paragraphs | Line-break tags |
| -------------- | -------- | ---------: | --------------: |
| Pikafish       | RzIGHoys |         19 |               0 |
| Mini Xiangqi   | Izs07M5E |         32 |               0 |
| Jieqi          | XApFEJf7 |         35 |               0 |
| Three Kingdoms | B0sJgBNB |         41 |               0 |
| Basic Kills    | ks4dsSLm |         47 |               0 |
| Manchu+        | 4wtrgg9Y |         44 |               0 |

Their Markdown includes redundant blank lines, which the Markdown parser already
collapses. No body rewrite or production migration is needed. Local recovery
copies and rendered audits are under `blog/paragraph-repair-20261105/` (ignored).

Website blog styling now uses the shared Markdown mixin's normal one-em block
margin instead of two em. The native app's shared `NativeMarkup` renderer used
to turn whitespace-only HTML text nodes between paragraphs into padded text rows.
It now ignores those nodes in both regular block rendering and compact inline
grouping. Intentional `<br>` elements remain line breaks.

## Verification and release

- Frontend format, lint and format check passed; production asset build passed.
- UI suite: 699 tests passed. On Windows the `ui/test` symlink is a text file;
  invoking its target with `node ui/.test/runner.mjs` runs the same suite.
- Flutter analysis passed; full suite: 476 passed, 2 existing skips. Regression
  tests compare paragraph positions with and without HTML formatting whitespace,
  including sections, blockquotes, compact mode and intentional line breaks.
- Compiled styles previewed at 1280px; all six article bodies checked at 768px and
  390px without horizontal overflow. Paragraph margins scale with text size.
- No native Android/iOS integration changes; no device or iOS build claimed.

The carousel action is live. Website spacing requires a normal asset deployment;
native spacing requires an updated main-app release. No backend change, migration,
new dependency, translation, or deployment-tool change is required. Production
deployment was not performed by this task.

Main mobile: shared renderer fix implemented for all blog posts and other markup
consumers. Its independent layout and navigation are preserved. Xiangqi Kids:
not applicable; it has no blog reader, `NativeMarkup` consumer, or homepage
carousel. No deferred variant work is enabled. Existing reconciliation checkpoints
and unrelated pending reviews must not be advanced by this narrow review.
