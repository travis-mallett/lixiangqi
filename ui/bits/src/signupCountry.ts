export function initSignupCountry(form: HTMLFormElement): void {
  const country = form.querySelector<HTMLSelectElement>('[name="country.flag"]');
  const optOut = form.querySelector<HTMLInputElement>('[name="country.optOut"]');
  const choice = form.querySelector<HTMLElement>('.signup-country__opt-out');
  const error = form.querySelector<HTMLElement>('#signup-country-error');
  if (!country || !optOut || !choice || !error) return;

  const clearError = () => {
    error.classList.add('none');
    country.removeAttribute('aria-invalid');
  };
  country.addEventListener('change', () => {
    if (country.value) {
      optOut.checked = false;
      clearError();
    }
  });
  optOut.addEventListener('change', () => {
    if (optOut.checked) {
      country.value = '';
      clearError();
    }
  });
  form.addEventListener(
    'submit',
    event => {
      if (country.value || optOut.checked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      choice.classList.remove('none');
      error.classList.remove('none');
      country.setAttribute('aria-invalid', 'true');
      country.focus();
    },
    true,
  );
}
