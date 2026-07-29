import { opposite } from 'chessops';
import { parseFen } from 'chessops/fen';

import type { Puzzle } from './interfaces';

export const getNow = (): number => Math.round(performance.now());

export const puzzlePov = (puzzle: Puzzle): Color => opposite(parseFen(puzzle.fen).unwrap().turn);

const loadSound = (name: string, volume?: number, delay?: number) => {
  setTimeout(() => site.sound.load(name), delay || 1000);
  return () => site.sound.play(name, volume);
};

export const sound: {
  good: () => Promise<void>;
  wrong: () => Promise<void>;
  end: () => Promise<void>;
} = {
  good: loadSound('puzzleStormGood', 0.9, 1000),
  wrong: loadSound('error', 1, 1000),
  end: loadSound('puzzleStormEnd', 1, 5000),
};
