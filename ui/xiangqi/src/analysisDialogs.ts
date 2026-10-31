import { domDialog } from 'lib/view';

export function showEmbedDialog(value: string): void {
  const content = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = i18n.site.embedGame;
  const label = document.createElement('label');
  label.htmlFor = 'xiangqi-embed-html';
  label.textContent = i18n.site.embedHtml;
  const output = document.createElement('textarea');
  output.id = label.htmlFor;
  output.readOnly = true;
  output.rows = 8;
  output.value = value;
  content.append(heading, label, output);
  void domDialog({
    class: 'xiangqi-embed-dialog',
    append: [{ node: content }],
    modal: true,
    show: true,
    focus: 'textarea',
    easyClose: 'clickOutside',
    onShow: () => output.select(),
  });
}

export function showAnalysisKeyboardHelp(): void {
  const content = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = i18n.site.keyboardShortcuts;
  const table = document.createElement('table');
  for (const [keys, description] of [
    ['← / →', i18n.site.keyMoveBackwardOrForward],
    ['Home / End', i18n.site.keyGoToStartOrEnd],
    ['Shift + ← / →', i18n.site.cyclePreviousOrNextVariation],
    ['?', i18n.site.keyboardShortcuts],
  ]) {
    const row = table.insertRow();
    row.insertCell().textContent = keys;
    row.insertCell().textContent = description;
  }
  content.append(heading, table);
  void domDialog({
    class: 'help.keyboard-help',
    append: [{ node: content }],
    modal: true,
    show: true,
    easyClose: 'clickOutside',
  });
}
