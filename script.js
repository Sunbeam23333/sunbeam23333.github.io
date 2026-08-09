const year = document.querySelector("#year");
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");

if (year) {
  year.textContent = new Date().getFullYear();
}

if (navToggle && navLinks) {
  navToggle.setAttribute("aria-expanded", "false");

  navToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", "Open navigation");
    });
  });
}

const finePointer = window.matchMedia("(pointer: fine)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let pointerFrame = false;

if (finePointer && !reducedMotion) {
  window.addEventListener("pointermove", (event) => {
    if (pointerFrame) {
      return;
    }

    pointerFrame = true;
    window.requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--mouse-x", event.clientX + "px");
      document.documentElement.style.setProperty("--mouse-y", event.clientY + "px");
      pointerFrame = false;
    });
  });
}
