import flatpickr from 'flatpickr';

import { use24h } from 'lib/i18n';

site.load.then(() => {
  document.querySelectorAll<HTMLElement>('[data-position-variants]').forEach(group => {
    const variant = group.querySelector<HTMLSelectElement>('select')!;
    const form = group.closest('form')!;
    const disabled = new WeakMap<HTMLInputElement | HTMLSelectElement, boolean>();
    const toggle = (selector: string, variants: string) => {
      const visible = variants.split(' ').includes(variant.value);
      form.querySelectorAll<HTMLElement>(selector).forEach(field => {
        field.classList.toggle('none', !visible);
        field.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => {
          if (!disabled.has(input)) disabled.set(input, input.disabled);
          input.disabled = !visible || disabled.get(input)!;
        });
      });
    };
    const update = () => {
      toggle('.position', group.dataset.positionVariants!);
      toggle('.ruleset', group.dataset.rulesetVariants!);
      const kingdoms = variant.value === 'threeKingdoms';
      for (const name of ['clockTime', 'clockIncrement']) {
        const input = form.querySelector<HTMLSelectElement>(`select[name$="${name}"]`);
        if (!input) continue;
        for (const option of input.options) {
          option.disabled =
            kingdoms &&
            !(name === 'clockTime' ? ['7', '10', '15'].includes(option.value) : option.value === '0');
          option.hidden = option.disabled;
        }
        if (input.selectedOptions[0]?.disabled && !input.disabled)
          input.value = name === 'clockTime' ? '15' : '0';
      }
      for (const name of ['berserkable', 'streakable', 'conditions.bots']) {
        const input = form.querySelector<HTMLInputElement>(`input[type="checkbox"][name$="${name}"]`);
        if (!input) continue;
        if (!disabled.has(input)) disabled.set(input, input.disabled);
        input.disabled = kingdoms || disabled.get(input)!;
        input.closest('.form-group')?.classList.toggle('none', kingdoms);
        if (kingdoms) input.checked = false;
      }
      form.querySelector<HTMLElement>('.three-kingdoms-tournament-help')?.classList.toggle('none', !kingdoms);
    };
    variant.addEventListener('change', () => {
      update();
      if (variant.value === 'threeKingdoms') {
        const duration = form.querySelector<HTMLSelectElement>('select[name$="minutes"]');
        const minutes = Number(
          form.querySelector<HTMLSelectElement>('select[name$="clockTime"]')?.value ?? 15,
        );
        const minimum = Math.ceil((minutes * 3 * 0.8 + 0.25) * 3);
        if (duration && Number(duration.value) < minimum) {
          const option = [...duration.options].find(o => Number(o.value) >= minimum);
          if (option) duration.value = option.value;
        }
      }
    });
    update();
  });

  $('.flatpickr').each(function (this: HTMLInputElement) {
    flatpickr(this, {
      minDate: 'today',
      maxDate: new Date(Date.now() + 1000 * 3600 * 24 * 31 * 6),
      dateFormat: 'Z',
      altInput: true,
      altFormat: 'Y-m-d h:i K',
      monthSelectorType: 'static',
      disableMobile: true,
      time_24hr: use24h(),
    });
  });
});
