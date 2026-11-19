export function initGlobalChat() {
  const card = document.querySelector<HTMLElement>('.lobby__global-chat__room');
  if (!card) return;
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    void site.asset.loadEsm('msg', { css: 'msg', init: { card } }).catch(() => {
      card.textContent = i18n.inbox.error;
    });
  });
  observer.observe(card);
}
