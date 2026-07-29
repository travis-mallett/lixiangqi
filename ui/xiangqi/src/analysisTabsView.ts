import { licon } from 'lib/licon';

import {
  MAX_ANALYSIS_TAB_TITLE_LENGTH,
  MAX_ANALYSIS_TABS,
  normalizeAnalysisTabTitle,
  type AnalysisTab,
} from './analysisTabs';

interface Options {
  element: HTMLElement;
  tabs: () => AnalysisTab[];
  activeId: () => string;
  pending: () => boolean;
  select: (id: string) => void;
  close: (id: string) => void;
  add: () => void;
  rename: (tab: AnalysisTab, title: string) => void;
}

export class AnalysisTabsView {
  constructor(private readonly options: Options) {}

  render(): void {
    const tabs = this.options.tabs();
    const activeId = this.options.activeId();
    const pending = this.options.pending();
    const elements = tabs.map((tab, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'xiangqi-analysis__tab';
      wrapper.classList.toggle('active', tab.id === activeId);
      wrapper.dataset.tabId = tab.id;

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'xiangqi-analysis__tab-select';
      select.id = `xiangqi-analysis-tab-${tab.id}`;
      select.role = 'tab';
      select.textContent = tab.title;
      select.title = tab.kind === 'game' ? `Database game: ${tab.title}` : tab.title;
      select.disabled = pending;
      select.setAttribute('aria-selected', String(tab.id === activeId));
      select.tabIndex = tab.id === activeId ? 0 : -1;
      select.addEventListener('click', () => this.options.select(tab.id));
      select.addEventListener('dblclick', event => {
        event.preventDefault();
        this.beginRename(tab, select);
      });
      select.addEventListener('keydown', event => {
        if (event.key === 'F2') {
          event.preventDefault();
          this.beginRename(tab, select);
          return;
        }
        if (event.key === 'Delete') {
          event.preventDefault();
          this.options.close(tab.id);
          return;
        }
        const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!direction) return;
        event.preventDefault();
        const target = tabs[(index + direction + tabs.length) % tabs.length];
        this.options.select(target.id);
      });
      wrapper.append(select);

      if (tabs.length > 1) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'xiangqi-analysis__tab-close';
        close.dataset.icon = licon.X;
        close.title = `Close ${tab.title}`;
        close.setAttribute('aria-label', `Close ${tab.title}`);
        close.disabled = pending;
        close.addEventListener('click', () => this.options.close(tab.id));
        wrapper.append(close);
      }
      return wrapper;
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'xiangqi-analysis__tab-add';
    add.dataset.icon = licon.PlusButton;
    add.title = 'New analysis tab';
    add.setAttribute('aria-label', 'New analysis tab');
    add.disabled = pending || tabs.length >= MAX_ANALYSIS_TABS;
    add.addEventListener('click', this.options.add);
    this.options.element.replaceChildren(...elements, add);
  }

  private beginRename(tab: AnalysisTab, select: HTMLButtonElement): void {
    if (this.options.pending() || !select.isConnected) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'xiangqi-analysis__tab-input';
    input.value = tab.title;
    input.maxLength = MAX_ANALYSIS_TAB_TITLE_LENGTH;
    input.spellcheck = false;
    input.setAttribute('aria-label', `Rename ${tab.title}`);

    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      const title = commit ? normalizeAnalysisTabTitle(input.value) : undefined;
      if (title && title !== tab.title) this.options.rename(tab, title);
      this.render();
    };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));

    select.replaceWith(input);
    input.focus();
    input.select();
  }
}
