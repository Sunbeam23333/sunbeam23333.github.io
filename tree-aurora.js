(function () {
  "use strict";

  const mountedCanvases = new WeakMap();

  const seededRandom = (seed) => {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  };

  const createTreeAurora = (canvas, options = {}) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    if (mountedCanvases.has(canvas)) {
      return mountedCanvases.get(canvas);
    }

    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) {
      return null;
    }

    const layerCanvas = document.createElement("canvas");
    const layerContext = layerCanvas.getContext("2d", { alpha: true });
    if (!layerContext) {
      return null;
    }

    const mode = options.mode || canvas.dataset.treeMode || "hero";
    const maskSource =
      options.maskSource || canvas.dataset.treeMask || "assets/cassel-tree-mask.png";
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const maskImage = new Image();
    const particles = [];
    const random = seededRandom(23333);

    let width = 0;
    let height = 0;
    let frameRequest = 0;
    let frameTimer = 0;
    let visible = true;
    let loaded = false;
    let destroyed = false;
    let resizeTimer = 0;

    const getTreeRect = () => {
      const mobile = width < 720;
      let size;
      let centerX;
      let centerY;

      if (mode === "wallpaper") {
        size = Math.min(width * (mobile ? 0.94 : 0.62), height * 0.9);
        centerX = width * 0.5;
        centerY = height * 0.5;
      } else if (mobile) {
        size = Math.min(width * 0.94, height * 0.58);
        centerX = width * 0.52;
        centerY = height * 0.39;
      } else if (width < 1000) {
        size = Math.min(width * 0.72, height * 0.54);
        centerX = width * 0.62;
        centerY = height * 0.35;
      } else {
        size = Math.min(width * 0.44, height * 0.7);
        centerX = width * 0.61;
        centerY = height * 0.45;
      }

      return {
        x: centerX - size / 2,
        y: centerY - size / 2,
        size,
      };
    };

    const buildParticles = () => {
      const sampleCanvas = document.createElement("canvas");
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) {
        return;
      }

      const sampleSize = 192;
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      sampleContext.drawImage(maskImage, 0, 0, sampleSize, sampleSize);
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      const candidates = [];

      for (let y = 2; y < sampleSize - 2; y += 2) {
        for (let x = 2; x < sampleSize - 2; x += 2) {
          if (pixels[(y * sampleSize + x) * 4 + 3] > 120) {
            candidates.push({ x: x / sampleSize, y: y / sampleSize });
          }
        }
      }

      particles.length = 0;
      const particleCount = mode === "wallpaper" ? 96 : 72;
      for (let index = 0; index < particleCount && candidates.length; index += 1) {
        const candidate = candidates[Math.floor(random() * candidates.length)];
        particles.push({
          x: candidate.x,
          y: candidate.y,
          phase: random() * Math.PI * 2,
          speed: 0.65 + random() * 1.25,
          size: 0.7 + random() * 1.8,
        });
      }
    };

    const paintAmbientLight = (seconds, tree) => {
      const centerX = tree.x + tree.size * 0.5;
      const centerY = tree.y + tree.size * 0.5;
      const pulse = 0.92 + Math.sin(seconds * 0.8) * 0.08;

      context.save();
      context.globalCompositeOperation = "lighter";

      const blueHalo = context.createRadialGradient(
        centerX,
        centerY,
        tree.size * 0.08,
        centerX,
        centerY,
        tree.size * 0.78,
      );
      blueHalo.addColorStop(0, `rgba(53, 164, 255, ${0.13 * pulse})`);
      blueHalo.addColorStop(0.38, `rgba(59, 83, 255, ${0.1 * pulse})`);
      blueHalo.addColorStop(0.72, "rgba(75, 38, 196, 0.035)");
      blueHalo.addColorStop(1, "rgba(2, 3, 10, 0)");
      context.fillStyle = blueHalo;
      context.fillRect(0, 0, width, height);

      const driftX = centerX + Math.sin(seconds * 0.34) * tree.size * 0.2;
      const driftY = centerY + Math.cos(seconds * 0.27) * tree.size * 0.14;
      const cyanMist = context.createRadialGradient(
        driftX,
        driftY,
        0,
        driftX,
        driftY,
        tree.size * 0.46,
      );
      cyanMist.addColorStop(0, "rgba(50, 239, 255, 0.075)");
      cyanMist.addColorStop(0.5, "rgba(38, 122, 255, 0.045)");
      cyanMist.addColorStop(1, "rgba(2, 3, 10, 0)");
      context.fillStyle = cyanMist;
      context.fillRect(0, 0, width, height);
      context.restore();
    };

    const paintTreeLayer = (seconds, tree) => {
      layerContext.clearRect(0, 0, width, height);
      layerContext.save();
      layerContext.globalCompositeOperation = "source-over";

      const drift = Math.sin(seconds * 0.52) * tree.size * 0.12;
      const baseGradient = layerContext.createLinearGradient(
        tree.x - tree.size * 0.18 + drift,
        tree.y + tree.size,
        tree.x + tree.size * 1.12 + drift,
        tree.y,
      );
      baseGradient.addColorStop(0, "rgba(44, 92, 255, 0.52)");
      baseGradient.addColorStop(0.24, "rgba(47, 225, 255, 0.72)");
      baseGradient.addColorStop(0.5, "rgba(119, 246, 218, 0.58)");
      baseGradient.addColorStop(0.72, "rgba(94, 108, 255, 0.72)");
      baseGradient.addColorStop(1, "rgba(172, 72, 255, 0.58)");
      layerContext.fillStyle = baseGradient;
      layerContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      const glowColors = [
        [46, 234, 255],
        [60, 112, 255],
        [151, 82, 255],
        [68, 255, 193],
      ];

      glowColors.forEach((color, index) => {
        const orbit = seconds * (0.48 + index * 0.11) + index * 1.7;
        const x = tree.x + tree.size * (0.5 + Math.sin(orbit) * (0.33 - index * 0.035));
        const y = tree.y + tree.size * (0.5 + Math.cos(orbit * 0.82) * 0.34);
        const glow = layerContext.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          tree.size * (0.3 + index * 0.025),
        );
        glow.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.76)`);
        glow.addColorStop(0.42, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.25)`);
        glow.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
        layerContext.fillStyle = glow;
        layerContext.fillRect(tree.x, tree.y, tree.size, tree.size);
      });

      layerContext.globalCompositeOperation = "lighter";
      layerContext.lineCap = "round";
      layerContext.filter = `blur(${Math.max(5, tree.size * 0.012)}px)`;

      for (let band = 0; band < 5; band += 1) {
        const bandPhase = seconds * (0.72 + band * 0.08) + band * 1.15;
        const baseY = tree.y + tree.size * (0.18 + band * 0.155);
        const amplitude = tree.size * (0.045 + band * 0.008);
        const ribbonGradient = layerContext.createLinearGradient(
          tree.x,
          baseY,
          tree.x + tree.size,
          baseY,
        );
        ribbonGradient.addColorStop(0, "rgba(42, 117, 255, 0)");
        ribbonGradient.addColorStop(0.28, "rgba(57, 215, 255, 0.3)");
        ribbonGradient.addColorStop(0.52, "rgba(219, 255, 255, 0.64)");
        ribbonGradient.addColorStop(0.74, "rgba(110, 102, 255, 0.32)");
        ribbonGradient.addColorStop(1, "rgba(177, 67, 255, 0)");

        layerContext.beginPath();
        layerContext.moveTo(tree.x - tree.size * 0.12, baseY + Math.sin(bandPhase) * amplitude);
        layerContext.bezierCurveTo(
          tree.x + tree.size * 0.2,
          baseY + Math.cos(bandPhase * 1.17) * amplitude,
          tree.x + tree.size * 0.67,
          baseY + Math.sin(bandPhase * 0.83 + 1.4) * amplitude,
          tree.x + tree.size * 1.12,
          baseY + Math.cos(bandPhase + 0.6) * amplitude,
        );
        layerContext.strokeStyle = ribbonGradient;
        layerContext.lineWidth = tree.size * (0.028 + band * 0.006);
        layerContext.globalAlpha = 0.62;
        layerContext.stroke();
      }

      layerContext.filter = "none";
      const scanProgress = (seconds % 5.2) / 5.2;
      const scanY = tree.y + tree.size * (1.14 - scanProgress * 1.34);
      const scan = layerContext.createLinearGradient(0, scanY - tree.size * 0.13, 0, scanY + tree.size * 0.13);
      scan.addColorStop(0, "rgba(228, 255, 255, 0)");
      scan.addColorStop(0.38, "rgba(124, 231, 255, 0.18)");
      scan.addColorStop(0.5, "rgba(238, 255, 255, 0.88)");
      scan.addColorStop(0.62, "rgba(116, 161, 255, 0.22)");
      scan.addColorStop(1, "rgba(116, 161, 255, 0)");
      layerContext.fillStyle = scan;
      layerContext.globalAlpha = 1;
      layerContext.fillRect(tree.x, scanY - tree.size * 0.13, tree.size, tree.size * 0.26);

      particles.forEach((particle) => {
        const pulse = 0.5 + 0.5 * Math.sin(seconds * particle.speed * 2.2 + particle.phase);
        const x = tree.x + tree.size * (particle.x + Math.sin(seconds + particle.phase) * 0.0025);
        const y = tree.y + tree.size * (particle.y - ((seconds * 0.008 * particle.speed) % 0.012));
        layerContext.beginPath();
        layerContext.arc(x, y, particle.size * (0.62 + pulse * 0.58), 0, Math.PI * 2);
        layerContext.fillStyle = `rgba(226, 255, 255, ${0.24 + pulse * 0.62})`;
        layerContext.fill();
      });

      layerContext.globalCompositeOperation = "destination-in";
      layerContext.globalAlpha = 1;
      layerContext.drawImage(maskImage, tree.x, tree.y, tree.size, tree.size);
      layerContext.restore();
    };

    const draw = (timestamp = 0) => {
      if (!loaded || !width || !height || destroyed) {
        return;
      }

      const seconds = timestamp / 1000;
      const tree = getTreeRect();
      context.clearRect(0, 0, width, height);
      paintAmbientLight(seconds, tree);
      paintTreeLayer(seconds, tree);

      context.save();
      context.globalCompositeOperation = "lighter";
      if (width >= 720) {
        context.filter = `blur(${Math.max(22, tree.size * 0.045)}px)`;
        context.globalAlpha = 0.25 + Math.sin(seconds * 0.82) * 0.035;
        context.drawImage(layerCanvas, 0, 0);
      }

      context.filter = `blur(${Math.max(width < 720 ? 6 : 8, tree.size * 0.016)}px)`;
      context.globalAlpha = width < 720 ? 0.46 : 0.52;
      context.drawImage(layerCanvas, 0, 0);

      context.filter = "none";
      context.globalAlpha = 0.96;
      context.drawImage(layerCanvas, 0, 0);
      context.restore();
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const preferredScale = width < 720 ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
      const pixelScale = Math.min(preferredScale, 1920 / width);

      canvas.width = Math.round(width * pixelScale);
      canvas.height = Math.round(height * pixelScale);
      context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);

      layerCanvas.width = width;
      layerCanvas.height = height;
      draw(performance.now());
    };

    const stop = () => {
      if (frameRequest) {
        window.cancelAnimationFrame(frameRequest);
        frameRequest = 0;
      }
      if (frameTimer) {
        window.clearTimeout(frameTimer);
        frameTimer = 0;
      }
    };

    const scheduleNextFrame = () => {
      const frameInterval = width < 720 ? 1000 / 24 : 1000 / 30;
      if (visible && !document.hidden && !motionPreference.matches && !destroyed) {
        frameTimer = window.setTimeout(() => {
          frameTimer = 0;
          frameRequest = window.requestAnimationFrame(animate);
        }, frameInterval);
      }
    };

    const animate = (timestamp) => {
      frameRequest = 0;
      draw(timestamp);
      scheduleNextFrame();
    };

    const start = () => {
      if (
        loaded &&
        !frameRequest &&
        !frameTimer &&
        visible &&
        !document.hidden &&
        !motionPreference.matches &&
        !destroyed
      ) {
        frameRequest = window.requestAnimationFrame(animate);
      }
    };

    const handleMotionPreference = () => {
      stop();
      draw(performance.now());
      start();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 140);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        start();
      } else {
        stop();
      }
    });

    const controller = {
      destroy() {
        destroyed = true;
        stop();
        observer.disconnect();
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibility);
        motionPreference.removeEventListener("change", handleMotionPreference);
        mountedCanvases.delete(canvas);
      },
      redraw() {
        draw(performance.now());
      },
    };

    mountedCanvases.set(canvas, controller);
    observer.observe(canvas);
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);
    motionPreference.addEventListener("change", handleMotionPreference);

    maskImage.addEventListener("load", () => {
      loaded = true;
      canvas.closest(".aurora-bg")?.classList.add("aurora-ready");
      buildParticles();
      resize();
      start();
    });
    maskImage.addEventListener("error", () => {
      canvas.closest(".aurora-bg")?.classList.add("aurora-error");
      stop();
    });
    maskImage.src = new URL(maskSource, document.baseURI).href;

    return controller;
  };

  const mountTreeAuroras = (root = document) => {
    root.querySelectorAll("canvas[data-tree-aurora]").forEach((canvas) => {
      createTreeAurora(canvas);
    });
  };

  window.TreeAurora = {
    create: createTreeAurora,
    mountAll: mountTreeAuroras,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountTreeAuroras(), { once: true });
  } else {
    mountTreeAuroras();
  }
})();
