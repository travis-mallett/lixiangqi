import { h } from 'snabbdom';

export const loading = () => h('span', { attrs: { role: 'status' } }, i18n.site.loading);
