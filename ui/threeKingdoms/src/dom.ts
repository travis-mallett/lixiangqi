export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
export function button(
  text: string,
  action: () => void,
  className = 'button button-empty',
): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}
export function link(text: string, href: string, className = 'button button-empty'): HTMLAnchorElement {
  const a = el('a', className, text);
  a.href = href;
  return a;
}
export function select(
  label: string,
  options: readonly (readonly [string, string])[],
  value: string,
): HTMLLabelElement {
  const wrapper = el('label', 'three-kingdoms__field', label);
  const input = el('select');
  for (const [key, name] of options) {
    const option = el('option', '', name);
    option.value = key;
    input.append(option);
  }
  input.value = value;
  wrapper.append(input);
  return wrapper;
}
export async function request<T>(
  path: string,
  data?: unknown,
  method: string = data === undefined ? 'GET' : 'POST',
  keepalive = false,
): Promise<T> {
  const response = await fetch(`/api/three-kingdoms/${path}`, {
    method,
    keepalive,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || i18n.threeKingdoms.error);
  return body as T;
}
export function errorText(error: unknown): string {
  const key = error instanceof Error ? error.message : '';
  const message = (i18n.threeKingdoms as unknown as Record<string, unknown>)[key];
  return typeof message === 'string' ? message : i18n.threeKingdoms.error;
}
export function download(data: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = link('', url);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
