import type { LiconValue } from 'lib/licon';
import { hl, bind, dataIcon, type VNode } from 'lib/view';

export function roundAction(
  label: string,
  action: () => void,
  options: { icon?: LiconValue; disabled?: boolean; text?: boolean; name?: string } = {},
): VNode {
  return hl(
    `button.fbt${options.name ? `.${options.name}` : ''}`,
    {
      key: options.name ?? label,
      attrs: { type: 'button', disabled: !!options.disabled, title: label, 'aria-label': label },
      hook: bind('click', () => {
        action();
      }),
    },
    options.icon && !options.text ? [hl('span', { attrs: dataIcon(options.icon) })] : label,
  );
}
