const observer = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -60px 0px' },
);

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

const tiltEl = document.querySelector('[data-tilt]');
if (tiltEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  window.addEventListener('pointermove', e => {
    const x = (e.clientX / window.innerWidth - 0.5) * 8;
    const y = (e.clientY / window.innerHeight - 0.5) * 8;
    tiltEl.style.setProperty('--tx', `${(-y).toFixed(2)}deg`);
    tiltEl.style.setProperty('--ty', `${x.toFixed(2)}deg`);
  }, { passive: true });
}
