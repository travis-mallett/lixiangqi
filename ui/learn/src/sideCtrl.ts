import { type Prop, propWithEffect } from 'lib';

import type { LearnCtrl } from './ctrl';
import type { LearnProgress, LearnOpts } from './learn';
import { availableStages, stageIdToCategId, totalInteractiveLevels } from './stage/list';

export class SideCtrl {
  data: LearnProgress;
  categId: Prop<number>;

  constructor(
    readonly ctrl: LearnCtrl,
    readonly opts: LearnOpts,
  ) {
    this.data = ctrl.data;
    this.categId = propWithEffect(this.getCategIdFromStageId() ?? 0, ctrl.redraw);
  }

  reset = () => this.opts.storage.reset();
  activeStageId = () => this.opts.stageId || availableStages[0].id;
  getCategIdFromStageId = () => stageIdToCategId(this.activeStageId());
  updateCategId = () => this.categId(this.getCategIdFromStageId() ?? this.categId());

  progress = () => {
    const complete = availableStages.reduce((total, stage) => {
      const scores = this.data.stages[stage.key]?.scores ?? [];
      return total + stage.levels.filter(level => (scores[level.id - 1] ?? 0) > 0).length;
    }, 0);
    return Math.round((complete / Math.max(1, totalInteractiveLevels)) * 100);
  };
}
