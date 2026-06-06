const observer = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -80px 0px' },
);

document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

const heroVisual = document.querySelector('.hero-visual');
if (heroVisual) {
  window.addEventListener(
    'pointermove',
    event => {
      const x = (event.clientX / window.innerWidth - 0.5) * 10;
      const y = (event.clientY / window.innerHeight - 0.5) * 10;
      heroVisual.style.setProperty('--tilt-x', `${y.toFixed(2)}deg`);
      heroVisual.style.setProperty('--tilt-y', `${(-x).toFixed(2)}deg`);
    },
    { passive: true },
  );
}
