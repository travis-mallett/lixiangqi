import type { Opts } from './exports';

interface SubmitOpts {
  isTrusted: boolean;
  force?: boolean;
  yourMove?: boolean;
}
export type Submit = (value: string, options: SubmitOpts) => void;

/** Coordinate input commits explicitly because a1 is also the prefix of a10. */
export function makeSubmit(opts: Opts, clear: () => void): Submit {
  let resolving = false;
  const wrong = (error?: unknown) => {
    opts.input.classList.add('wrong');
    opts.input.setCustomValidity(error instanceof Error ? error.message : i18n.nvui.invalidMove);
    site.sound.play('error');
  };
  const commands: Record<string, () => void> = {
    resign: () => opts.ctrl.resign(true, true),
    draw: () => opts.ctrl.draw(),
    next: () => opts.ctrl.next(),
    upv: () => opts.ctrl.vote(true),
    downv: () => opts.ctrl.vote(false),
    clock: () => opts.ctrl.speakClock?.(),
    zerk: () => opts.ctrl.goBerserk?.(),
    who: () => {
      if (opts.ctrl.opponent) site.sound.say(opts.ctrl.opponent, false, true);
    },
    help: () => opts.ctrl.helpModalOpen(true),
    '?': () => opts.ctrl.helpModalOpen(true),
  };
  return (value, options) => {
    if (!options.isTrusted) return;
    const text = value.trim().toLowerCase();
    if (!text) return;
    if (commands[text]) {
      commands[text]();
      clear();
      return;
    }
    if (Object.keys(commands).some(command => command.startsWith(text))) return;
    if (!options.force && !options.yourMove) return;
    const moves = opts.ctrl.legalMoves;
    if (!moves) return; // Keep a queued move until the server supplies destinations.
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(text);
    if (match && moves[text]) {
      opts.ctrl.move(match[1], match[2]);
      clear();
    } else if (/^[a-i](?:10|[1-9])$/.test(text)) {
      opts.ctrl.select(text);
      clear();
    } else if (opts.ctrl.resolveNotation && !resolving) {
      resolving = true;
      void opts.ctrl
        .resolveNotation(value.trim())
        .then(move => {
          if (!move || opts.input.value.trim().toLowerCase() !== text) return;
          const parts = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(move);
          if (!parts || !opts.ctrl.legalMoves?.[move]) throw new Error(i18n.nvui.invalidMove);
          opts.ctrl.move(parts[1], parts[2]);
          clear();
        })
        .catch(wrong)
        .finally(() => {
          resolving = false;
        });
    } else if (!resolving) wrong();
  };
}
