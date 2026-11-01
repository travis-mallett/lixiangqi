import { hl, onInsert, type VNode } from 'lib/view';

/** Keep file text outside textarea.value, whose getter normalizes CR and CRLF. */
export class PgnImportInput {
  text = '';
  originalFile?: File;
  originalVersion = 0;
  loading = false;
  private revision = 0;

  get version(): number {
    return this.revision;
  }

  cancelRead(): void {
    this.revision++;
    this.loading = false;
  }

  edit(text: string): void {
    this.cancelRead();
    this.text = text;
  }

  /** A confirmed import can clear accepted content while a replacement is still loading. */
  clearContent(): void {
    this.text = '';
    this.originalFile = undefined;
  }

  async load(read: Promise<string>, file?: File): Promise<boolean> {
    const revision = ++this.revision;
    this.loading = true;
    try {
      const text = await read;
      if (revision !== this.revision) return false;
      this.text = text;
      this.originalFile = file;
      this.originalVersion = revision;
      return true;
    } catch (error) {
      if (revision === this.revision) throw error;
      return false;
    } finally {
      if (revision === this.revision) this.loading = false;
    }
  }
}

/** Use an explicitly supplied same-site URL, never a guessed header in ambiguous input. */
export function studyExportLinks(
  value: string,
  origin: string,
): { study: string; chapter?: string } | undefined {
  try {
    const url = new URL(value.trim(), origin);
    if (url.origin !== origin || url.username || url.password) return;
    const match = /^\/study\/(\w{8})(?:\/(\w{8}))?(?:\.pgn)?\/?$/.exec(url.pathname);
    if (match)
      return {
        study: `/study/${match[1]}.pgn`,
        chapter: match[2] ? `/study/${match[1]}/${match[2]}.pgn` : undefined,
      };
  } catch {
    // A partially entered URL has no download actions yet.
  }
  return undefined;
}

export function pgnImportHelp(
  source: string,
  setSource: (value: string) => void,
  failed: boolean,
  input: PgnImportInput,
): VNode {
  const links = studyExportLinks(source, window.location.origin);
  const originalFile = input.originalFile;
  return hl('details.pgn-import-help', { attrs: { open: failed } }, [
    hl('summary', i18n.study.olderPgnExport),
    hl('p', i18n.study.olderPgnExportExplanation),
    hl('p', i18n.study.olderPgnExportInstructions),
    hl('label.form-label', { attrs: { for: 'pgn-original-study' } }, i18n.study.originalStudyUrl),
    hl('input#pgn-original-study.form-control', {
      attrs: { type: 'text', placeholder: `${window.location.origin}/study/…`, autocomplete: 'off' },
      hook: onInsert<HTMLInputElement>(el => {
        el.value = source;
        el.addEventListener('input', () => setSource(el.value));
      }),
    }),
    source && !links && hl('p.form-help', i18n.study.originalStudyUrlHelp),
    links &&
      hl('div.pgn-import-help__downloads', [
        hl('a.button.button-empty', { attrs: { href: links.study, download: true } }, i18n.study.studyPgn),
        links.chapter &&
          hl(
            'a.button.button-empty',
            { attrs: { href: links.chapter, download: true } },
            i18n.study.chapterPgn,
          ),
      ]),
    hl('p', i18n.study.olderPgnWithoutOriginal),
    originalFile &&
      hl(
        'a.button.button-empty',
        {
          key: input.originalVersion,
          attrs: { download: originalFile.name },
          hook: {
            insert(vnode) {
              (vnode.elm as HTMLAnchorElement).href = URL.createObjectURL(originalFile);
            },
            destroy(vnode) {
              URL.revokeObjectURL((vnode.elm as HTMLAnchorElement).href);
            },
          },
        },
        i18n.study.keepOriginalPgnFile,
      ),
  ]);
}
