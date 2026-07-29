const make = (name: string, volume?: number) => {
  site.sound.load(name);
  return () => site.sound.play(name, volume);
};

export const move = () => site.sound.play('move');
export const take = make('learnCapture', 0.4);
export const levelStart = make('learnLevelStart');
export const levelEnd = make('learnLevelComplete');
export const stageStart = make('learnStageStart');
export const stageEnd = make('learnStageComplete');
export const failure = make('learnFailure');
