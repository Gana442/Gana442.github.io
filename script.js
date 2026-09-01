const button = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const navLinks = document.querySelectorAll('.nav a');
const sections = document.querySelectorAll('main section[id]');

function closeMenu() {
  nav?.classList.remove('open');
  button?.classList.remove('open');
  button?.setAttribute('aria-expanded', 'false');
  button?.setAttribute('aria-label', 'Open navigation');
  document.body.classList.remove('menu-open');
}

button?.addEventListener('click', () => {
  const open = nav?.classList.toggle('open');
  button.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  document.body.classList.toggle('menu-open', open);
});

navLinks.forEach(link => link.addEventListener('click', closeMenu));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const id = entry.target.getAttribute('id');
    navLinks.forEach(link => {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  });
}, { rootMargin: '-25% 0px -65% 0px', threshold: 0 });

sections.forEach(section => observer.observe(section));

document.getElementById('year').textContent = new Date().getFullYear();
