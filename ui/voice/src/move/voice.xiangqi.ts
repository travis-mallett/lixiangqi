import type { MoveRootCtrl, MoveUpdate } from 'lib/game/moveRootCtrl';
import type { QuestionOpts } from 'lib/types';
import { jsonSimple } from 'lib/xhr';

import type { Entry, VoiceCtrl } from '../interfaces';
import type { VoiceMove } from './interfaces';
import { extraCoordinates } from './xiangqiCoordinates';

/** Xiangqi input uses coordinate phrases and authoritative destinations, never chess SAN. */
export function initModule({
  root,
  voice,
  initial,
}: {
  root: MoveRootCtrl;
  voice: VoiceCtrl;
  initial: MoveUpdate;
}): VoiceMove {
  let current = initial;
  let entries: Entry[] = [];
  let request: { prompt: string; action: (accepted: boolean) => void } | undefined;
  let generation = 0;
  let disposed = false;
  const wordsFor = (value: string, tag: string) =>
    entries
      .filter(entry => (entry.val ?? entry.tok) === value && entry.tags.includes(tag))
      .map(entry => entry.in);
  const squares = (location: string) =>
    wordsFor(location[0], 'file').flatMap(file =>
      wordsFor(location.slice(1), 'rank').map(rank => `${file} ${rank}`),
    );
  const phrases = () =>
    [...(current.board?.destinations() ?? [])].flatMap(([from, destinations]) =>
      destinations.flatMap(to =>
        squares(from).flatMap(a => squares(to).map(b => [`${a} ${b}`, from, to] as const)),
      ),
    );
  const respond = (accepted: boolean) => {
    const action = request?.action;
    request = undefined;
    root.redraw();
    action?.(accepted);
  };
  const confirm = (prompt: string, action: () => void) => {
    request = {
      prompt,
      action: accepted => {
        if (accepted) action();
      },
    };
    root.redraw();
  };
  const commands: Record<string, () => void> = {
    yes: () => respond(true),
    no: () => {
      respond(false);
      current.board?.cancelInput();
    },
    flip: () => root.flipNow(),
    clock: () => root.speakClock?.(),
    draw: () => confirm(i18n.site.offerDraw, () => root.offerDraw?.(true, true)),
    resign: () => confirm(i18n.site.resign, () => root.resign?.(true, true)),
    takeback: () => confirm(i18n.site.proposeATakeback, () => root.takebackYes?.()),
    rematch: () => root.rematch?.(true),
    next: () => root.nextPuzzle?.(),
    upvote: () => root.vote?.(true),
    downvote: () => root.vote?.(false),
    solve: () => root.solve?.(),
    help: () => voice.showHelp('list'),
    vocabulary: () => voice.showHelp('list'),
    'mic-off': () => voice.mic.stop(),
    stop: () => voice.mic.stop(),
    blindfold: () => root.blindfold?.(!root.blindfold?.()),
  };
  const commandEntries = () =>
    entries.filter(
      entry =>
        (entry.tags.includes('command') || entry.tags.includes('choice')) && commands[entry.val ?? entry.tok],
    );
  async function initGrammar() {
    const id = ++generation;
    const grammar: { entries: Entry[] } = await jsonSimple(
      site.asset.url(`compiled/grammar/move-${voice.lang()}.json`),
    );
    if (disposed || id !== generation) return;
    entries = [...grammar.entries, ...extraCoordinates(voice.lang())];
    voice.mic.initRecognizer(
      [
        ...new Set([
          ...entries
            .filter(entry => entry.tags.includes('file') || entry.tags.includes('rank'))
            .map(entry => entry.in),
          ...commandEntries().map(entry => entry.in),
        ]),
      ],
      {
        listenerId: 'xiangqi',
        listener: (heard, type) => {
          if (type !== 'full' || disposed) return;
          const command = commandEntries().find(entry => entry.in === heard);
          if (command) {
            commands[command.val ?? command.tok]();
            return;
          }
          if (request || !current.canMove) return;
          const matches = phrases().filter(([phrase]) => phrase === heard);
          const moves = new Set(matches.map(([, from, to]) => `${from}${to}`));
          if (moves.size !== 1) return;
          const [, from, to] = matches[0];
          if (current.board?.allowsMove(from, to)) root.pluginMove(from, to, undefined);
        },
      },
    );
  }
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      voice.mic.removeListener('xiangqi');
      voice.mic.stop();
    },
    { once: true },
  );
  void initGrammar().catch(() => voice.mic.stop());
  return {
    ctrl: voice,
    initGrammar,
    update: update => {
      current = update;
    },
    promotionHook: () => () => {},
    prefNodes: () => [],
    allPhrases: () => [
      ...phrases().map(([phrase, from, to]): [string, string] => [phrase, `${from}${to}`]),
      ...commandEntries().map(entry => [entry.in, entry.val ?? entry.tok] as [string, string]),
    ],
    listenForResponse: (prompt, action) => {
      request = { prompt, action };
    },
    question: (): QuestionOpts | false =>
      request
        ? {
            prompt: request.prompt,
            yes: { action: () => respond(true) },
            no: { action: () => respond(false) },
          }
        : false,
  };
}
