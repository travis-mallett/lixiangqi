export {}; // for tsc isolatedModules

const form = document.querySelector<HTMLFormElement>('#dl-form')!;
const button = document.querySelector<HTMLButtonElement>('#dl-button')!;
const error = document.querySelector<HTMLElement>('#dl-error')!;
const untilDate = document.querySelector<HTMLInputElement>('#dl-date-until')!;

function generateSearchParams(): URLSearchParams {
  const params = new URLSearchParams();
  for (const e of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name], select[name]')) {
    let value = e.value;
    if (e instanceof HTMLInputElement) {
      if (e.type === 'checkbox') value = String(e.checked);
      else if (e.type === 'number' && value) value = String(e.valueAsNumber);
    }
    if (value) params.set(e.name, value);
  }
  for (const name of ['since', 'until']) {
    const date = document.querySelector<HTMLInputElement>(`#dl-date-${name}`)!.value;
    const time = document.querySelector<HTMLInputElement>(`#dl-time-${name}`)!.value;
    if (!date) continue;
    const datetime = new Date(`${date}T${time || '00:00:00'}`);
    // A date without a time includes that entire day in the upper bound.
    if (!time && name === 'until') datetime.setDate(datetime.getDate() + 1);
    params.set(name, String(datetime.getTime()));
  }
  return params;
}

function update(): URLSearchParams {
  const params = generateSearchParams();
  const since = params.get('since');
  const until = params.get('until');
  untilDate.setCustomValidity(
    since && until && Number(since) >= Number(until) ? i18n.search.invalidDateRange : '',
  );
  const invalid = [...form.querySelectorAll<HTMLInputElement>('input')].find(input => !input.validity.valid);
  error.textContent = invalid?.validationMessage ?? '';
  button.disabled = !!invalid;
  const apiUrl = document.querySelector<HTMLInputElement>('#dl-api-url input')!;
  const apiPath = document.querySelector<HTMLElement>('#dl-api-url')!.dataset.apiPath;
  apiUrl.value = invalid ? '' : `${location.origin}${apiPath}?${params}`;
  return params;
}

form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', event => {
  event.preventDefault();
  const params = update();
  if (form.reportValidity()) location.assign(`${button.dataset.downloadPath}?${params}`);
});
window.addEventListener('pageshow', update);
update();
