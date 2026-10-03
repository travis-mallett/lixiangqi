import { licon } from 'lib/licon';

import type { AnalysisSuggestionElements } from './analysisSuggestions';

export interface AnalysisSetting {
  name: string;
  label: string;
  type: 'range' | 'checkbox';
  value: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  change?: (value: number | boolean) => void;
}

/** Both clients supply state/callbacks; layout and interaction are owned here. */
export function createAnalysisSettings(settings: AnalysisSetting[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'xiangqi-engine-settings';
  panel.hidden = true;
  for (const setting of settings) {
    const label = document.createElement('label');
    label.classList.toggle('xiangqi-engine-settings__preview-toggle', setting.name === 'lines-preview');
    const text = document.createElement('span');
    text.textContent = setting.label;
    const input = document.createElement('input');
    input.type = setting.type;
    input.dataset.setting = setting.name;
    label.append(text, input);
    if (setting.type === 'checkbox') {
      label.classList.add('xiangqi-engine-settings__toggle');
      input.checked = Boolean(setting.value);
      const toggle = document.createElement('span');
      toggle.className = 'xiangqi-engine-settings__toggle-control';
      toggle.setAttribute('aria-hidden', 'true');
      label.append(toggle);
    } else {
      input.value = String(setting.value);
      if (setting.min !== undefined) input.min = String(setting.min);
      if (setting.max !== undefined) input.max = String(setting.max);
      if (setting.step !== undefined) input.step = String(setting.step);
      const value = document.createElement('span');
      value.className = 'xiangqi-engine-settings__value';
      const update = () => {
        value.textContent = setting.format?.(Number(input.value)) ?? input.value;
      };
      update();
      input.addEventListener('input', update);
      label.append(value);
    }
    input.addEventListener('change', () =>
      setting.change?.(setting.type === 'checkbox' ? input.checked : Number(input.value)),
    );
    panel.append(label);
  }
  return panel;
}

export function createAnalysisGauge(): HTMLElement {
  const gauge = document.createElement('div');
  gauge.className = 'xiangqi-eval';
  gauge.setAttribute('role', 'meter');
  gauge.setAttribute('aria-label', 'Pikafish evaluation from Red’s perspective');
  gauge.setAttribute('aria-valuemin', '0');
  gauge.setAttribute('aria-valuemax', '100');
  gauge.setAttribute('aria-valuenow', '50');
  gauge.innerHTML = '<div class="xiangqi-eval__red"></div><span class="xiangqi-eval__score">+0.00</span>';
  return gauge;
}

export function createAnalysisEngineView(): HTMLElement {
  const engine = document.createElement('section');
  engine.className = 'xiangqi-engine';
  engine.setAttribute('aria-label', 'Pikafish analysis');
  engine.innerHTML = `<div class="bar" aria-hidden="true"><span></span></div>
    <div class="xiangqi-engine__summary">
      <label class="xiangqi-engine__switch"><input type="checkbox" checked><span aria-hidden="true"></span></label>
      <strong class="xiangqi-engine__headline-score">—</strong>
      <div class="xiangqi-engine__identity"><span class="xiangqi-engine__name">Pikafish</span><span class="xiangqi-analysis__substatus" aria-live="polite"></span></div>
      <span class="xiangqi-cloud-badge" hidden>CLOUD</span>
      <button class="xiangqi-icon-button" type="button" aria-expanded="false"></button>
    </div>
    <div class="xiangqi-engine-settings" hidden></div>
    <div class="xiangqi-engine__lines pv_box"></div>
    <button class="xiangqi-engine__more" type="button" hidden aria-expanded="false"></button>`;
  engine.querySelector('label')!.title = i18n.site.toggleLocalEvaluation;
  engine.querySelector('input')!.setAttribute('aria-label', i18n.site.toggleLocalEvaluation);
  const settings = engine.querySelector<HTMLButtonElement>('.xiangqi-icon-button')!;
  settings.dataset.icon = licon.Gear;
  settings.title = settings.ariaLabel = 'Pikafish settings';
  return engine;
}

export function analysisSuggestionElements(
  engine: HTMLElement,
  gauge: HTMLElement,
): AnalysisSuggestionElements {
  return {
    eval: gauge,
    evalFill: gauge.querySelector<HTMLElement>('.xiangqi-eval__red')!,
    evalScore: gauge.querySelector<HTMLElement>('.xiangqi-eval__score')!,
    engineLines: engine.querySelector<HTMLElement>('.xiangqi-engine__lines')!,
    engineScore: engine.querySelector<HTMLElement>('.xiangqi-engine__headline-score')!,
    engineStatus: engine.querySelector<HTMLElement>('.xiangqi-analysis__substatus')!,
    cloudBadge: engine.querySelector<HTMLElement>('.xiangqi-cloud-badge')!,
    moreLines: engine.querySelector<HTMLButtonElement>('.xiangqi-engine__more')!,
  };
}
