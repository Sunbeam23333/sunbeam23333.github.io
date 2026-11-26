/* Keep the native, draggable rail and keyboard controls from study.js. The
   arrow interval is a fixed design-space distance, not card width plus gap. */
(() => {
  const rail = document.getElementById('research-rail');
  const controls = document.querySelector('[data-rail="research-rail"]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  for (const [index, button] of [...controls.querySelectorAll('button')].entries()) {
    button.onclick = () => rail.scrollBy({
      left: index ? 435 : -435,
      behavior: reduced.matches ? 'instant' : 'smooth'
    });
  }
  if (!('IntersectionObserver' in window)) return;
  const orbit = document.getElementById('traits');
  const groups = [orbit, rail];
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('field-motion-in');
      visibility.unobserve(entry.target);
    }
  }, {threshold:0.01});
  for (const group of groups) {
    // The reference entrances cascade across a single group, including all
    // scrollable cards, instead of translating the full-width rail itself.
    group.classList.remove('reveal');
    const cards = group.querySelectorAll(group === orbit ? '.trait' : '.field');
    cards.forEach((card, index) => {
      card.classList.remove('reveal');
      card.style.setProperty('--item', index);
    });
    group.classList.add('field-motion-ready');
    visibility.observe(group);
  }
})();
