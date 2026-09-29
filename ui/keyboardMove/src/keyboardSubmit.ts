import type { Opts } from './exports';

interface SubmitOpts {
  isTrusted: boolean;
  force?: boolean;
  yourMove?: boolean;
}
export type Submit = (value: string, options: SubmitOpts) => void;

/** Coordinate input commits explicitly because a1 is also the prefix of a10. */
export function makeSubmit(opts: Opts, clear: () => void): Submit {
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
    const moves = opts.ctrl.legalSans;
    if (!moves) return; // Keep a queued move until the server supplies destinations.
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(text);
    if (match && moves[text]) {
      opts.ctrl.san(match[1], match[2]);
      clear();
    } else if (/^[a-i](?:10|[1-9])$/.test(text)) {
      opts.ctrl.select(text);
      clear();
    } else {
      opts.input.classList.add('wrong');
      site.sound.play('error');
    }
  };
}
