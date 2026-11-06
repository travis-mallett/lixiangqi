# LiXiangQi blog writing guide

These instructions apply to every future LiXiangQi blog post, including announcements, tutorials, historical articles, captions, introductions, and revisions to existing posts. Read this guide before drafting and review the complete article against it before saving or publishing.

## Voice and editorial approach

Use [Basic Kills.odt](Basic%20Kills.odt) as the author’s writing sample. Favor direct explanations, concrete board examples, and personal observations the author actually supplied. Keep technical detail when it helps readers understand the game. Do not invent anecdotes, manufacture enthusiasm, or replace the author’s voice with promotional copy.

Rewrite weak passages as a whole; swapping a few flagged words is insufficient. These patterns are editing prompts, not proof of AI authorship. Preserve necessary uncertainty, accurate terminology, useful punctuation, and the author’s normal American English. Do not introduce errors or forced informality to seem human.

## Checklist

### Repeated vocabulary

1. Check for: Stock words: delve, tapestry, testament, pivotal, vibrant, and similar defaults.
2. Check for: Generic praise that could describe almost any product.
3. Check for: Repeated adjective clusters instead of specific properties.
4. Check for: Unnecessary synonym changes for the same technical term.
5. Check for: Elaborate substitutes where “is,” “has,” or a concrete verb works.

### Manufactured emphasis

6. Check for: Announcing that a distinction matters before explaining its consequence.
7. Check for: Unnecessary “not X, but Y” comparisons.
8. Check for: Forcing examples or benefits into groups of three.
9. Check for: Repeated dramatic fragments that give ordinary points artificial weight.
10. Check for: Question-and-answer slogans replacing an actual explanation.

### Empty significance

11. Check for: Grand claims about legacy, importance, or cultural impact.
12. Check for: Unsupported superlatives and claims of unprecedented achievement.
13. Check for: Sentence endings that attach vague symbolism to an ordinary fact.
14. Check for: Claims about broader trends without evidence connecting them.
15. Check for: Celebrating the existence of coverage instead of explaining its contents.

### Predictable structure

16. Check for: Generic openings that could introduce any subject.
17. Check for: Paragraphs announcing what the next paragraph will explain.
18. Check for: The same claim repeated in the intro, body, and conclusion.
19. Check for: Mechanical transitions between already connected ideas.
20. Check for: Automatic future-prospects sections and recap endings.

### Attribution and factual precision

21. Check for: Unnamed authorities standing in for a specific source.
22. Check for: Turning one source's opinion into a supposed consensus.
23. Check for: Citations that fail to support the surrounding claim.
24. Check for: Repeated source-availability disclaimers interrupting the story.
25. Check for: Invented quotations, broken references, or unresolved placeholders.

### Sentence rhythm

26. Check for: Several sentences with identical openings or grammatical shapes.
27. Check for: Uniform paragraph lengths imposed on uneven material.
28. Check for: Stacked hedges that obscure an answer already known.
29. Check for: Long noun phrases where a person or piece can perform an action.
30. Check for: Abstract explanations that would be clearer as a board example.

### Formatting

31. Check for: Bold emphasis scattered through ordinary prose.
32. Check for: Lists used where a connected paragraph reads better.
33. Check for: Title-case subheadings that make every section look like a promotion.
34. Check for: Repeated dashes, colons, and ellipses creating a mechanical cadence.
35. Check for: Chatbot preambles, drafting notes, research-process commentary, verification reports, artwork-production notes, and editing instructions left in the article or captions.

### Keeping the author's voice and the game correct

36. Check for: Keep the author's actual anecdotes; invent none.
37. Check for: Keep opinions attached to concrete experiences or implementation choices.
38. Check for: Do not replace precise rules with catchy but inaccurate simplifications.
39. Check for: Preserve real uncertainty about historical attribution and engine verification.
40. Check for: Read the whole section after editing; isolated word substitutions are insufficient.

## Research references

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing): recurring rhetorical, attribution, and citation problems; includes the “that distinction matters” pattern.
- [ETBI library guide](https://library.etbi.ie/cs/sources2/aisigns): repetition, transitions, hedging, structure, and formatting.
- [Pew Research Center](https://www.pewresearch.org/data-labs/2026/08/20/how-much-of-the-internet-is-written-with-ai/): vocabulary and grammatical patterns across large collections of writing, with limits on individual attribution.
- [Kobak et al., Science Advances (2025)](https://arxiv.org/abs/2406.07016): corpus-level evidence of vocabulary changes associated with LLM-assisted writing.

## LiXiangQi content checks

- Verify implementation claims against current owning code and the published rules. Distinguish historical variants, optional rules, and the rules actually implemented here.
- Cite sources near the claims they support. Prefer authentic Chinese sources for Chinese history and rules when available; retain precise attribution and acknowledge genuine disagreements.
- Explain what a player can actually do on LiXiangQi. Avoid unverified claims such as world first, best, or unprecedented.
- Use accurate board artwork and piece arrangements. Supply canonical SVG grids as image-generation references when needed; verify palace lines, dimensions, and movement examples.
- Do not add routine image credits for LiXiangQi's own artwork, screenshots, diagrams, or AI-generated images. Leave the Image credit field empty for these assets. Keep provenance and production details in internal notes. Include third-party attribution only when required by its license or permission; prefer assets without an attribution requirement when practical. A historical source citation may identify the document pictured when that helps the reader understand it.
- When revising published content, preserve a recoverable copy first. Check images, links, tables, and rule qualifications after the editor converts the content.
- Follow the user’s requested publication state. Every published official LiXiangQi post must also be added to the homepage carousel. After publishing, use **Edit Carousel → Add** on the post and verify its card on the homepage. Official status alone does not add it. Use **Pin** only when explicitly requested; do not promote private drafts.

## Keep production notes out of the published article

Write for readers interested in xiangqi, not for the person commissioning the article. Apply this rule to the introduction, body, captions, footnotes, ending, and Image credit field.

- Remove statements about how the article was researched, checked, written, illustrated, or assembled. Examples to remove include “the scan was checked against its printed text,” “sources are linked beside the claims they support,” “version information was checked,” and “diagram made with our shared board renderer.” Report that work privately to the user or record it in internal research notes.
- Do not announce AI-generated artwork, explain the production tools, add self-credits such as “Layout and translation: LiXiangQi,” or append an image-credit or methodology footer by default. Do not restore credits the user has removed.
- Keep captions about what the image shows and why it matters. Keep useful source links attached naturally to historical facts; do not narrate the act of citing them.
- Preserve uncertainty that changes a reader's understanding of the history or rules, but cut defensive disclaimers about the author's process or claims the article never makes. State practical availability limits where readers choose how to play, rather than in a production-note footer.
- Review self-references such as “in this article,” “our research,” “we verified,” and “for readers of our article.” Replace them with the actual subject or a natural link when useful. First-person experiences supplied by the author remain welcome; this rule does not remove the author's voice.
- Before publishing, ask of each aside: does this help the reader understand the game, history, or pictured example, or does it merely describe our work producing the post? Remove the latter.

## Paragraphs and rendered verification

- Store distinct paragraphs as Markdown blocks separated by one blank line. A single newline is a line break inside a paragraph, so it has no paragraph margin.
- The current Toast UI visual editor treats one Enter as a line break when serialized; use two Enters between prose paragraphs. Pasted HTML paragraphs also need a saved-page check: the editor can join adjacent paragraphs with single newlines. Do not assume the editor preview is the published result.
- Do not add repeated empty paragraphs, extra `<br>` tags, or nonbreaking spaces to tune visual spacing. Paragraph spacing belongs to website styles and the native app renderer. Extra blank lines in Markdown are not a substitute for fixing either renderer.
- Check the saved article on desktop, a narrow browser viewport, and the native mobile renderer when changing formatting. Distinct prose paragraphs must render as separate `<p>` elements, with a modest gap; intentional line breaks, lists, quotations, tables, images and captions must retain their structure. Native rendering must ignore whitespace-only HTML text nodes between blocks.
- Audit existing content before bulk editing. Preserve a recoverable copy of any published source that needs correction; do not rewrite correctly structured articles merely to alter visual margins.
