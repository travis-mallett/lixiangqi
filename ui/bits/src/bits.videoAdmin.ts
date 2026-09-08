import Sortable from 'sortablejs';

import { json as xhrJson, url as xhrUrl } from 'lib/xhr';

type MetadataPreview = {
  provider: string;
  canonicalUrl: string;
  title?: string;
  author?: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  available: boolean;
};

site.load.then(() => {
  wireMetadataPreview();
  wireTagPicker();
  wireReordering();
});

function wireMetadataPreview(): void {
  const button = document.querySelector<HTMLButtonElement>('.video-metadata-preview');
  const source = document.querySelector<HTMLInputElement>('#form3-sourceUrl');
  const result = document.querySelector<HTMLElement>('.video-metadata-result');
  if (!button || !source || !result) return;

  const field = (name: string) =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#form3-${name}`);
  button.addEventListener('click', async () => {
    const endpoint = button.dataset.previewUrl;
    if (!endpoint || !source.value.trim()) {
      renderPreviewMessage(result, 'Video URL required', 'Enter a YouTube or Bilibili link first.', true);
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Fetching…';
    button.setAttribute('aria-busy', 'true');
    result.classList.add('loading');
    renderPreviewMessage(result, 'Fetching video details', 'Checking the external provider…');
    try {
      const preview = await xhrJson<MetadataPreview>(xhrUrl(endpoint, { url: source.value.trim() }));
      source.value = preview.canonicalUrl;
      setIfEmpty(field('title'), preview.title);
      setIfEmpty(field('author'), preview.author);
      setIfEmpty(field('description'), preview.description);
      renderPreview(result, preview);
    } catch (error) {
      renderPreviewMessage(
        result,
        'Could not fetch this video',
        error instanceof Error ? error.message : 'Check the URL and try again.',
        true,
      );
    } finally {
      result.classList.remove('loading');
      button.disabled = false;
      button.textContent = originalLabel;
      button.removeAttribute('aria-busy');
    }
  });
}

function setIfEmpty(field: HTMLInputElement | HTMLTextAreaElement | null, value?: string): void {
  if (field && !field.value.trim() && value) field.value = value;
}

function renderPreview(result: HTMLElement, preview: MetadataPreview): void {
  result.replaceChildren();
  result.classList.remove('error');
  if (preview.thumbnail) {
    const image = document.createElement('img');
    image.src = preview.thumbnail;
    image.alt = 'External video thumbnail';
    result.append(image);
  }
  const text = document.createElement('div');
  text.className = 'video-metadata-result__copy';
  const heading = document.createElement('strong');
  const detail = document.createElement('span');
  const duration = preview.duration ? ` • ${formatDuration(preview.duration)}` : '';
  heading.textContent = preview.available
    ? `${preview.provider} video connected`
    : `${preview.provider} video unavailable`;
  detail.textContent = preview.available
    ? `Details imported${duration}. Review them before saving.`
    : 'The provider reports that this video cannot currently be played.';
  text.append(heading, detail);
  result.append(text);
}

function renderPreviewMessage(result: HTMLElement, heading: string, detail: string, error = false): void {
  result.replaceChildren();
  result.classList.toggle('error', error);
  const copy = document.createElement('div');
  copy.className = 'video-metadata-result__empty';
  const title = document.createElement('strong');
  title.textContent = heading;
  const message = document.createElement('span');
  message.textContent = detail;
  copy.append(title, message);
  result.append(copy);
}

function wireTagPicker(): void {
  const input = document.querySelector<HTMLInputElement>('#form3-tags');
  const selected = document.querySelector<HTMLElement>('.video-tag-picker__selected');
  const options = [...document.querySelectorAll<HTMLButtonElement>('.video-tag-option')];
  if (!input || !selected) return;

  const render = () => {
    const tags = parseTags(input.value);
    selected.replaceChildren(...tags.map(tagChip));
    for (const option of options) {
      const active = !!option.dataset.tag && tags.includes(normalizeTag(option.dataset.tag));
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-pressed', String(active));
    }
  };

  const update = (tags: string[]) => {
    input.value = tags.join(', ');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  };

  input.addEventListener('input', render);
  selected.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.video-tag-remove');
    const tag = button?.dataset.tag;
    if (tag) update(parseTags(input.value).filter(current => current !== normalizeTag(tag)));
  });
  for (const option of options)
    option.addEventListener('click', () => {
      const tag = option.dataset.tag && normalizeTag(option.dataset.tag);
      if (!tag) return;
      const tags = parseTags(input.value);
      update(tags.includes(tag) ? tags.filter(current => current !== tag) : [...tags, tag].slice(0, 20));
      input.focus();
    });
  render();
}

function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]/)
        .map(normalizeTag)
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function tagChip(tag: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'video-tag-chip';
  const label = document.createElement('span');
  label.textContent = tag;
  const remove = document.createElement('button');
  remove.className = 'video-tag-remove';
  remove.type = 'button';
  remove.dataset.tag = tag;
  remove.setAttribute('aria-label', `Remove ${tag} tag`);
  remove.textContent = '×';
  chip.append(label, remove);
  return chip;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function wireReordering(): void {
  const list = document.querySelector<HTMLOListElement>('.video-reorder-list');
  const value = document.querySelector<HTMLInputElement>('#video-order-value');
  if (!list || !value) return;

  const updateValue = () => {
    value.value = [...list.children]
      .map(item => (item as HTMLElement).dataset.videoId)
      .filter((id): id is string => !!id)
      .join(',');
  };

  Sortable.create(list, {
    animation: 150,
    handle: '.video-reorder-handle',
    onEnd: updateValue,
  });

  list.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    const item = button?.closest<HTMLLIElement>('li');
    if (!button || !item) return;
    if (button.classList.contains('video-reorder-up') && item.previousElementSibling)
      list.insertBefore(item, item.previousElementSibling);
    else if (button.classList.contains('video-reorder-down') && item.nextElementSibling)
      list.insertBefore(item.nextElementSibling, item);
    else return;
    updateValue();
    item
      .querySelector<HTMLButtonElement>(
        `.${button.classList.contains('video-reorder-up') ? 'video-reorder-up' : 'video-reorder-down'}`,
      )
      ?.focus();
  });
}
