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

const auroraCanvas = document.querySelector("#aurora-canvas");

if (auroraCanvas) {
  const auroraContext = auroraCanvas.getContext("2d", { alpha: true });

  if (auroraContext) {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const filaments = Array.from({ length: 180 }, (_, index) => ({
      side: index % 3 === 0 ? -1 : 1,
      progress: 0.06 + (((index * 47) % 179) / 179) * 0.88,
      spread: 0.66 + (((index * 61) % 101) / 101) * 0.5,
      phase: index * 0.43,
      hue: index % 3 === 0 ? 178 + (index % 4) * 8 : 198 + (index % 6) * 10,
    }));

    let auroraWidth = 0;
    let auroraHeight = 0;
    let auroraFrame = 0;
    let lastAuroraFrame = 0;
    let auroraIsVisible = true;
    let resizeTimer = 0;

    const cubicPoint = (start, controlOne, controlTwo, end, progress) => {
      const inverse = 1 - progress;
      return {
        x:
          inverse ** 3 * start.x +
          3 * inverse ** 2 * progress * controlOne.x +
          3 * inverse * progress ** 2 * controlTwo.x +
          progress ** 3 * end.x,
        y:
          inverse ** 3 * start.y +
          3 * inverse ** 2 * progress * controlOne.y +
          3 * inverse * progress ** 2 * controlTwo.y +
          progress ** 3 * end.y,
      };
    };

    const cubicTangent = (start, controlOne, controlTwo, end, progress) => {
      const inverse = 1 - progress;
      return {
        x:
          3 * inverse ** 2 * (controlOne.x - start.x) +
          6 * inverse * progress * (controlTwo.x - controlOne.x) +
          3 * progress ** 2 * (end.x - controlTwo.x),
        y:
          3 * inverse ** 2 * (controlOne.y - start.y) +
          6 * inverse * progress * (controlTwo.y - controlOne.y) +
          3 * progress ** 2 * (end.y - controlTwo.y),
      };
    };

    const drawAurora = (timestamp = 0) => {
      if (!auroraWidth || !auroraHeight) {
        return;
      }

      const time = timestamp * 0.00022;
      const context = auroraContext;
      const mobile = auroraWidth < 720;
      const base = {
        x: auroraWidth * (mobile ? 0.86 : 0.84) + Math.sin(time * 1.7) * auroraWidth * 0.008,
        y: auroraHeight * (mobile ? 0.68 : 0.72),
      };
      const controlOne = {
        x: auroraWidth * (mobile ? 0.84 : 0.82),
        y: auroraHeight * 0.54,
      };
      const controlTwo = {
        x: auroraWidth * (mobile ? 0.68 : 0.69),
        y: auroraHeight * 0.2,
      };
      const tip = {
        x: auroraWidth * (mobile ? 0.58 : 0.56) + Math.sin(time) * auroraWidth * 0.012,
        y: -auroraHeight * 0.09,
      };

      context.clearRect(0, 0, auroraWidth, auroraHeight);
      context.save();
      context.globalCompositeOperation = "lighter";

      const halo = context.createRadialGradient(
        base.x,
        base.y,
        0,
        base.x,
        base.y,
        Math.max(auroraWidth, auroraHeight) * 0.28,
      );
      halo.addColorStop(0, "rgba(220, 244, 255, 0.62)");
      halo.addColorStop(0.08, "rgba(83, 176, 255, 0.3)");
      halo.addColorStop(0.32, "rgba(49, 82, 255, 0.12)");
      halo.addColorStop(1, "rgba(3, 4, 10, 0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, auroraWidth, auroraHeight);

      const activeFilaments = mobile ? filaments.slice(0, 90) : filaments;

      const traceFilament = (filament, alphaScale, widthScale) => {
        const progress = Math.min(
          0.96,
          Math.max(0.03, filament.progress + Math.sin(time * 1.4 + filament.phase) * 0.006),
        );
        const spine = cubicPoint(base, controlOne, controlTwo, tip, progress);
        const tangent = cubicTangent(base, controlOne, controlTwo, tip, progress);
        const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
        const tangentX = tangent.x / tangentLength;
        const tangentY = tangent.y / tangentLength;
        const normalX = -tangentY;
        const normalY = tangentX;
        const featherShape = Math.pow(Math.sin(Math.PI * progress), 0.72);
        const sideScale = filament.side > 0 ? 1 : 0.48;
        const length =
          auroraWidth *
          (mobile ? 0.2 : 0.235) *
          featherShape *
          sideScale *
          filament.spread *
          (1 + Math.sin(time * 1.8 + filament.phase) * 0.035);
        const wave = Math.sin(time * 2.1 + filament.phase) * auroraWidth * 0.004;
        const direction = filament.side;
        const endX =
          spine.x + normalX * length * direction + tangentX * length * 0.13 + normalX * wave;
        const endY =
          spine.y + normalY * length * direction + tangentY * length * 0.13 + normalY * wave;

        context.beginPath();
        context.moveTo(spine.x, spine.y);
        context.bezierCurveTo(
          spine.x + normalX * length * direction * 0.32 - tangentX * length * 0.03,
          spine.y + normalY * length * direction * 0.32 - tangentY * length * 0.03,
          endX - normalX * length * direction * 0.2 - tangentX * length * 0.1,
          endY - normalY * length * direction * 0.2 - tangentY * length * 0.1,
          endX,
          endY,
        );
        const shimmer = 0.72 + Math.sin(time * 2.5 + filament.phase) * 0.22;
        context.strokeStyle = `hsla(${filament.hue}, 92%, 66%, ${
          (0.055 + featherShape * 0.13) * shimmer * alphaScale
        })`;
        context.lineWidth = (0.45 + featherShape * 1.05) * widthScale;
        context.stroke();
      };

      context.lineCap = "round";
      context.filter = mobile ? "blur(8px)" : "blur(13px)";
      activeFilaments.forEach((filament, index) => {
        if (index % 4 === 0) {
          traceFilament(filament, 0.92, mobile ? 8 : 11);
        }
      });

      context.filter = "none";
      activeFilaments.forEach((filament) => traceFilament(filament, 1, 1));

      const spineGradient = context.createLinearGradient(base.x, base.y, tip.x, tip.y);
      spineGradient.addColorStop(0, "rgba(226, 247, 255, 0.98)");
      spineGradient.addColorStop(0.42, "rgba(105, 186, 255, 0.84)");
      spineGradient.addColorStop(0.76, "rgba(162, 140, 255, 0.7)");
      spineGradient.addColorStop(1, "rgba(255, 193, 151, 0.62)");

      context.beginPath();
      context.moveTo(base.x, base.y);
      context.bezierCurveTo(
        controlOne.x,
        controlOne.y,
        controlTwo.x,
        controlTwo.y,
        tip.x,
        tip.y,
      );
      context.filter = mobile ? "blur(6px)" : "blur(10px)";
      context.strokeStyle = spineGradient;
      context.globalAlpha = 0.42;
      context.lineWidth = mobile ? 8 : 12;
      context.stroke();

      context.filter = "none";
      context.globalAlpha = 0.92;
      context.lineWidth = mobile ? 1.35 : 1.8;
      context.stroke();

      const tailGradient = context.createLinearGradient(
        auroraWidth * 0.28,
        auroraHeight * 0.87,
        base.x,
        base.y,
      );
      tailGradient.addColorStop(0, "rgba(59, 114, 255, 0)");
      tailGradient.addColorStop(0.6, "rgba(91, 162, 255, 0.38)");
      tailGradient.addColorStop(1, "rgba(229, 248, 255, 0.92)");
      context.beginPath();
      context.moveTo(auroraWidth * 0.25, auroraHeight * 0.86);
      context.bezierCurveTo(
        auroraWidth * 0.48,
        auroraHeight * 0.87,
        auroraWidth * 0.68,
        auroraHeight * 0.84,
        base.x,
        base.y,
      );
      context.strokeStyle = tailGradient;
      context.globalAlpha = 0.8;
      context.lineWidth = 1.4;
      context.stroke();

      context.restore();
    };

    const resizeAurora = () => {
      const bounds = auroraCanvas.getBoundingClientRect();
      auroraWidth = Math.max(1, Math.round(bounds.width));
      auroraHeight = Math.max(1, Math.round(bounds.height));
      const preferredScale = auroraWidth < 720 ? 1 : Math.min(window.devicePixelRatio || 1, 1.3);
      const pixelScale = Math.min(preferredScale, 1920 / auroraWidth);

      auroraCanvas.width = Math.round(auroraWidth * pixelScale);
      auroraCanvas.height = Math.round(auroraHeight * pixelScale);
      auroraContext.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      drawAurora(performance.now());
    };

    const stopAurora = () => {
      if (auroraFrame) {
        window.cancelAnimationFrame(auroraFrame);
        auroraFrame = 0;
      }
    };

    const animateAurora = (timestamp) => {
      auroraFrame = 0;
      const frameInterval = auroraWidth < 720 ? 1000 / 24 : 1000 / 30;

      if (timestamp - lastAuroraFrame >= frameInterval) {
        drawAurora(timestamp);
        lastAuroraFrame = timestamp;
      }

      if (auroraIsVisible && !document.hidden && !motionPreference.matches) {
        auroraFrame = window.requestAnimationFrame(animateAurora);
      }
    };

    const startAurora = () => {
      if (!auroraFrame && auroraIsVisible && !document.hidden && !motionPreference.matches) {
        auroraFrame = window.requestAnimationFrame(animateAurora);
      }
    };

    const updateMotionPreference = () => {
      stopAurora();
      drawAurora(performance.now());
      startAurora();
    };

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resizeAurora, 140);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAurora();
      } else {
        startAurora();
      }
    });

    motionPreference.addEventListener("change", updateMotionPreference);

    const auroraObserver = new IntersectionObserver(([entry]) => {
      auroraIsVisible = entry.isIntersecting;
      if (auroraIsVisible) {
        startAurora();
      } else {
        stopAurora();
      }
    });

    auroraObserver.observe(auroraCanvas);
    resizeAurora();
    startAurora();
  }
}
