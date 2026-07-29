import { extractHashParameters } from './hashRouting';
import type { LearnProgress, LearnOpts } from './learn';
import { RunCtrl } from './run/runCtrl';
import { gtz } from './score';
import { SideCtrl } from './sideCtrl';
import { byId as stageById } from './stage/list';

export class LearnCtrl {
  data: LearnProgress = this.opts.storage.data;
  sideCtrl: SideCtrl;
  runCtrl: RunCtrl;

  constructor(
    readonly opts: LearnOpts,
    readonly redraw: () => void,
  ) {
    this.setStageLevelFromHash();
    this.sideCtrl = new SideCtrl(this, opts);
    this.runCtrl = new RunCtrl(opts, redraw);

    window.addEventListener('hashchange', () => {
      this.setStageLevelFromHash();
      this.sideCtrl.updateCategId();
      this.runCtrl.initializeLevel();
      this.redraw();
    });
  }

  setStageLevelFromHash = () => {
    const params = extractHashParameters();
    const stage = params.stageId ? stageById[params.stageId] : undefined;
    this.opts.stageId = stage && !stage.comingSoon ? stage.id : null;
    if (!stage || stage.comingSoon) {
      this.opts.levelId = null;
      return;
    }
    const saved = this.data.stages[stage.key]?.scores ?? [];
    const resume = stage.levels.find(level => !saved[level.id - 1])?.id ?? 1;
    this.opts.levelId = Math.min(Math.max(params.levelId ?? resume, 1), stage.levels.length);
  };

  inStage = () => this.opts.stageId !== null;

  isStageIdComplete = (stageId: number) => {
    const stage = stageById[stageId];
    if (!stage || stage.comingSoon) return false;
    const scores = this.data.stages[stage.key]?.scores ?? [];
    return stage.levels.every(level => gtz(scores[level.id - 1] ?? 0));
  };

  stageProgress = (stage: (typeof stageById)[number]) => {
    const scores = this.data.stages[stage.key]?.scores ?? [];
    return [stage.levels.filter(level => gtz(scores[level.id - 1] ?? 0)).length, stage.levels.length];
  };
}
