export interface Opts {
  recap?: Recap;
  user: LightUser;
  navigation: boolean;
  costs?: {
    amount: number;
    currency: string;
  };
}

interface NbWin {
  total: number;
  win: number;
}
export interface Counted<A> {
  value: A;
  count: number;
}
export interface Sources {
  friend: number;
  simul: number;
  swiss: number;
  pool: number;
  lobby: number;
  ai: number;
  arena: number;
}

export interface RecapPerf {
  key: Exclude<Perf, 'fromPosition'>;
  games: number;
}

export interface Recap {
  year: number;
  createdAt: number;
  puzzles: {
    nbs: NbWin;
    votes: {
      nb: number;
      themes: number;
    };
  };
  games: {
    perfs: RecapPerf[];
    moves: number;
    nbs: NbWin;
    nbRed: number;
    opponents: Counted<LightUser>[];
    timePlaying: number;
    sources: Sources;
    firstRedMoves: Counted<string>[];
  };
}
