import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initSignupCountry } from '../src/signupCountry';

test('registration reveals opt-out only after blank submission and preserves a usable form', () => {
  const dom = new JSDOM(`<form>
    <select name="country.flag"><option value=""></option><option value="CN">China</option></select>
    <div class="signup-country__opt-out none"><input type="checkbox" name="country.optOut"></div>
    <p id="signup-country-error" class="none"></p>
  </form>`);
  const form = dom.window.document.querySelector('form')!;
  const country = form.querySelector('select')!;
  const optOut = form.querySelector('input')!;
  const choice = form.querySelector('div')!;
  const error = form.querySelector('p')!;
  initSignupCountry(form);
  let submitted = 0;
  form.addEventListener('submit', () => submitted++);
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  const change = (el: Element) => el.dispatchEvent(new dom.window.Event('change'));
  assert(choice.classList.contains('none'));
  assert.equal(submit(), false);
  assert.equal(submitted, 0);
  assert(!choice.classList.contains('none'));
  assert(!error.classList.contains('none'));
  assert.equal(dom.window.document.activeElement, country);
  optOut.checked = true;
  change(optOut);
  assert.equal(submit(), true);
  assert(error.classList.contains('none'));
  country.value = 'CN';
  change(country);
  assert.equal(optOut.checked, false);
  assert.equal(submit(), true);
  optOut.checked = true;
  change(optOut);
  assert.equal(country.value, '');
  optOut.checked = false;
  change(optOut);
  assert.equal(submit(), false);
});
