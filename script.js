const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
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
