import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

test('lifetime checkout defaults to $250 and submits larger custom donations without renewal', async () => {
  document.documentElement.lang = 'en-US';
  const cash = await import('../../../public/javascripts/vendor/cash.min.js');
  Object.assign(globalThis, { $: cash.default, location: window.location });
  let customAmount = '500';
  let submitted: FormData | undefined;
  let order: any;
  let subscription: any;
  mock.module('lib', { namedExports: { myUserId: () => 'donor' } });
  mock.module('lib/view', {
    namedExports: { prompt: async () => customAmount, spinnerHtml: '' },
  });
  mock.module(new URL('../src/bits.ts', import.meta.url).href, {
    namedExports: { contactEmail: () => {} },
  });
  mock.module('lib/xhr', {
    namedExports: {
      form: (data: Record<string, any>) => {
        const form = new FormData();
        for (const [key, value] of Object.entries(data)) form.set(key, String(value));
        return form;
      },
      jsonAnyResponse: async (_url: string, options: { body: FormData }) => {
        submitted = options.body;
        return { json: async () => ({ order: { id: 'TEST-ORDER' } }) };
      },
      json: async () => {
        throw new Error('Capture failed');
      },
    },
  });
  (window as any).paypalOrder = {
    Buttons: (options: any) => {
      order = options;
      return { render: () => {} };
    },
  };
  (window as any).paypalSubscription = {
    Buttons: (options: any) => {
      subscription = options;
      return { render: () => {} };
    },
  };
  document.body.innerHTML = `<div class="plan_checkout">
    <group class="freq">
      <input type="radio" name="freq" id="freq_monthly" value="monthly" checked>
      <input type="radio" name="freq" id="freq_onetime" value="onetime">
      <input type="radio" name="freq" id="freq_lifetime" value="lifetime">
    </group>
    <group class="dest"><input type="radio" name="dest" value="self" checked></group>
    <div class="amount_choice"><group class="amount">
      <div class="regular-amount"><input type="radio" name="plan" class="default" data-amount="10" checked></div>
      <div class="lifetime-amount none"><input type="radio" name="plan" id="plan_lifetime" data-amount="250"></div>
      <div class="other"><input type="radio" name="plan" id="plan_other"><label for="plan_other">Other amount</label></div>
    </group></div>
    <div class="gift"><input class="user-autocomplete"></div>
    <input type="checkbox" id="cover-fees"><label for="cover-fees"></label>
    <div class="service"><div class="paypal paypal--order"></div></div><p id="error"></p>
  </div>`;
  const { initModule } = await import('../src/bits.checkout');
  initModule({
    stripePublicKey: '',
    pricing: {
      currency: 'USD',
      fractionDigits: 2,
      default: 10,
      min: 1,
      max: 10000,
      lifetime: 250,
      giftMin: 2,
      feeRate: 0.04,
      feeFixed: 0.35,
    },
  });
  $('#freq_lifetime').trigger('click');
  assert.equal($('.regular-amount').hasClass('none'), true);
  assert.equal($('.lifetime-amount').hasClass('none'), false);
  assert.equal($('.amount_choice').hasClass('none'), false);
  await order.createOrder();
  assert.equal(submitted!.get('amount'), '250');
  assert.equal(submitted!.get('freq'), 'lifetime');

  const enterAmount = async (amount: string) => {
    customAmount = amount;
    $('.other label').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    await order.createOrder();
  };
  await enterAmount('500');
  assert.equal(submitted!.get('amount'), '500');
  $('#cover-fees').prop('checked', true);
  await order.createOrder();
  assert.equal(submitted!.get('amount'), '520');
  $('#cover-fees').prop('checked', false);
  await enterAmount('100');
  assert.equal(submitted!.get('amount'), '250');
  await enterAmount('');
  assert.equal($('#plan_lifetime').prop('checked'), true);
  assert.equal(submitted!.get('amount'), '250');
  $('#freq_monthly').trigger('click');
  assert.equal($('.regular-amount input').prop('checked'), true);
  // A failed approval callback must show feedback without relying on the PayPal SDK's onError hook.
  const error = document.getElementById('error')!;
  const scroll = mock.fn();
  error.scrollIntoView = scroll;
  await order.onApprove({ orderID: 'TEST-ORDER' });
  assert.equal(error.textContent, String(i18n.patron.paymentError));
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(scroll.mock.callCount(), 1);
  error.textContent = '';
  await subscription.onApprove({ subscriptionID: 'TEST-SUBSCRIPTION' });
  assert.equal(error.textContent, String(i18n.patron.paymentError));
  assert.equal(scroll.mock.callCount(), 2);
});
