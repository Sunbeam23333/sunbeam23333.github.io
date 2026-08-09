(function () {
  "use strict";

  const mountedCanvases = new WeakMap();
  const TAU = Math.PI * 2;
  const AURORA_COLORS = [
    [94, 255, 225],
    [55, 232, 255],
    [59, 140, 255],
    [65, 71, 255],
    [138, 77, 255],
  ];

  const seededRandom = (seed) => {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  };

  const cubicPoint = (start, controlOne, controlTwo, end, progress) => {
    const remaining = 1 - progress;
    const remainingSquared = remaining * remaining;
    const progressSquared = progress * progress;
    return {
      x:
        remainingSquared * remaining * start.x +
        3 * remainingSquared * progress * controlOne.x +
        3 * remaining * progressSquared * controlTwo.x +
        progressSquared * progress * end.x,
      y:
        remainingSquared * remaining * start.y +
        3 * remainingSquared * progress * controlOne.y +
        3 * remaining * progressSquared * controlTwo.y +
        progressSquared * progress * end.y,
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

    const flowCanvas = document.createElement("canvas");
    const flowContext = flowCanvas.getContext("2d", { alpha: true });
    const veinCanvas = document.createElement("canvas");
    const veinContext = veinCanvas.getContext("2d", { alpha: true });
    const radianceCanvas = document.createElement("canvas");
    const radianceContext = radianceCanvas.getContext("2d", { alpha: true });
    if (!flowContext || !veinContext || !radianceContext) {
      return null;
    }

    const mode = options.mode || canvas.dataset.treeMode || "hero";
    const flowMaskSource =
      options.maskSource ||
      canvas.dataset.treeMask ||
      "assets/cassel-tree-flow-mask.png";
    const sourceMaskSource =
      options.sourceMaskSource ||
      canvas.dataset.treeSourceMask ||
      "assets/cassel-tree-mask.png";
    const veinMaskSource =
      options.veinMaskSource ||
      canvas.dataset.treeVeins ||
      "assets/cassel-tree-veins.png";
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const flowMaskImage = new Image();
    const sourceMaskImage = new Image();
    const veinMaskImage = new Image();
    const radiators = [];
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
    let loadedAssetCount = 0;
    let assetFailed = false;

    const getTreeRect = () => {
      const mobile = width <= 720;
      let size;
      let centerX;
      let centerY;

      if (mode === "wallpaper") {
        size = Math.min(width * (mobile ? 0.88 : 0.6), height * 0.84);
        centerX = width * 0.5;
        centerY = height * 0.51;
      } else if (mobile) {
        size = Math.min(width * 0.88, height * 0.54);
        centerX = width * 0.5;
        centerY = height * 0.37;
      } else if (width <= 1000) {
        size = Math.min(width * 0.67, height * 0.51);
        centerX = width * 0.62;
        centerY = height * 0.34;
      } else {
        size = Math.min(width * 0.42, height * 0.67);
        centerX = width * 0.63;
        centerY = height * 0.45;
      }

      return {
        x: centerX - size / 2,
        y: centerY - size / 2,
        size,
      };
    };

    const buildGeometry = () => {
      const sampleCanvas = document.createElement("canvas");
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) {
        return;
      }

      const sampleSize = 256;
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      sampleContext.drawImage(sourceMaskImage, 0, 0, sampleSize, sampleSize);
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      const alphaAt = (x, y) => pixels[(y * sampleSize + x) * 4 + 3];
      const edgeCandidates = [];
      const interiorCandidates = [];

      for (let y = 4; y < sampleSize - 4; y += 2) {
        for (let x = 4; x < sampleSize - 4; x += 2) {
          const alpha = alphaAt(x, y);
          if (alpha > 112 && y < sampleSize * 0.74) {
            interiorCandidates.push({ x: x / sampleSize, y: y / sampleSize });
          }
          if (alpha < 48 || y > sampleSize * 0.71) {
            continue;
          }

          const gradientX = alphaAt(x + 2, y) - alphaAt(x - 2, y);
          const gradientY = alphaAt(x, y + 2) - alphaAt(x, y - 2);
          const magnitude = Math.hypot(gradientX, gradientY);
          if (magnitude < 54) {
            continue;
          }

          let normalX = -gradientX / magnitude;
          let normalY = -gradientY / magnitude;
          let radialX = x / sampleSize - 0.5;
          let radialY = y / sampleSize - 0.47;
          const radialLength = Math.max(0.001, Math.hypot(radialX, radialY));
          radialX /= radialLength;
          radialY /= radialLength;

          if (normalX * radialX + normalY * radialY < 0) {
            normalX *= -1;
            normalY *= -1;
          }

          normalX = normalX * 0.72 + radialX * 0.28;
          normalY = normalY * 0.72 + radialY * 0.28;
          const normalLength = Math.max(0.001, Math.hypot(normalX, normalY));
          edgeCandidates.push({
            x: x / sampleSize,
            y: y / sampleSize,
            nx: normalX / normalLength,
            ny: normalY / normalLength,
            strength: Math.min(1, magnitude / 255),
          });
        }
      }

      for (let index = edgeCandidates.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        const temporary = edgeCandidates[index];
        edgeCandidates[index] = edgeCandidates[swapIndex];
        edgeCandidates[swapIndex] = temporary;
      }

      radiators.length = 0;
      const radiatorCount = mode === "wallpaper" ? 168 : 112;
      edgeCandidates.slice(0, radiatorCount).forEach((candidate, index) => {
        const angle = (random() - 0.5) * 0.34;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        radiators.push({
          x: candidate.x,
          y: candidate.y,
          nx: candidate.nx * cosine - candidate.ny * sine,
          ny: candidate.nx * sine + candidate.ny * cosine,
          length: 0.065 + random() * 0.135,
          bend: (random() - 0.5) * 0.07,
          phase: random() * TAU,
          speed: 0.72 + random() * 0.72,
          width: 0.48 + random() * 0.92,
          color: (index + Math.floor(random() * AURORA_COLORS.length)) % AURORA_COLORS.length,
          strength: candidate.strength,
        });
      });

      particles.length = 0;
      const particleCount = mode === "wallpaper" ? 58 : 42;
      for (let index = 0; index < particleCount && interiorCandidates.length; index += 1) {
        const candidate = interiorCandidates[Math.floor(random() * interiorCandidates.length)];
        particles.push({
          x: candidate.x,
          y: candidate.y,
          phase: random() * TAU,
          speed: 0.6 + random() * 1.2,
          size: 0.45 + random() * 1.15,
          color: Math.floor(random() * AURORA_COLORS.length),
        });
      }
    };

    const paintAmbientLight = (seconds, tree) => {
      const centerX = tree.x + tree.size * 0.5;
      const centerY = tree.y + tree.size * 0.48;
      const pulse = 0.94 + Math.sin(seconds * (TAU / 6)) * 0.06;

      context.save();
      context.globalCompositeOperation = "lighter";

      const halo = context.createRadialGradient(
        centerX,
        centerY,
        tree.size * 0.04,
        centerX,
        centerY,
        tree.size * 0.82,
      );
      halo.addColorStop(0, `rgba(76, 150, 255, ${0.13 * pulse})`);
      halo.addColorStop(0.34, `rgba(54, 86, 255, ${0.075 * pulse})`);
      halo.addColorStop(0.7, "rgba(91, 45, 210, 0.028)");
      halo.addColorStop(1, "rgba(2, 3, 10, 0)");
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      const driftX = centerX + Math.sin(seconds * 0.31) * tree.size * 0.19;
      const driftY = centerY + Math.cos(seconds * 0.24) * tree.size * 0.12;
      const mist = context.createRadialGradient(
        driftX,
        driftY,
        0,
        driftX,
        driftY,
        tree.size * 0.45,
      );
      mist.addColorStop(0, "rgba(55, 237, 255, 0.055)");
      mist.addColorStop(0.48, "rgba(45, 116, 255, 0.032)");
      mist.addColorStop(1, "rgba(2, 3, 10, 0)");
      context.fillStyle = mist;
      context.fillRect(0, 0, width, height);
      context.restore();
    };

    const paintRadianceLayer = (seconds, tree) => {
      radianceContext.clearRect(0, 0, width, height);
      radianceContext.save();
      radianceContext.globalCompositeOperation = "lighter";
      radianceContext.lineCap = "round";
      radianceContext.lineJoin = "round";

      const mobile = width <= 720;
      const activeCount = mobile ? Math.min(64, radiators.length) : radiators.length;

      for (let index = 0; index < activeCount; index += 1) {
        const radiator = radiators[index];
        const color = AURORA_COLORS[radiator.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase);
        const length = tree.size * radiator.length * (0.7 + pulse * 0.42);
        const tangentX = -radiator.ny;
        const tangentY = radiator.nx;
        const sway = Math.sin(seconds * (TAU / 6) + radiator.phase) * tree.size * 0.016;
        const bend = tree.size * radiator.bend + sway;
        const start = {
          x: tree.x + tree.size * radiator.x - radiator.nx * tree.size * 0.005,
          y: tree.y + tree.size * radiator.y - radiator.ny * tree.size * 0.005,
        };
        const controlOne = {
          x: start.x + radiator.nx * length * 0.33 + tangentX * bend,
          y: start.y + radiator.ny * length * 0.33 + tangentY * bend,
        };
        const controlTwo = {
          x: start.x + radiator.nx * length * 0.72 - tangentX * bend * 0.58,
          y: start.y + radiator.ny * length * 0.72 - tangentY * bend * 0.58,
        };
        const end = {
          x: start.x + radiator.nx * length + tangentX * sway * 0.62,
          y: start.y + radiator.ny * length + tangentY * sway * 0.62,
        };

        radianceContext.beginPath();
        radianceContext.moveTo(start.x, start.y);
        radianceContext.bezierCurveTo(
          controlOne.x,
          controlOne.y,
          controlTwo.x,
          controlTwo.y,
          end.x,
          end.y,
        );
        radianceContext.strokeStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        radianceContext.lineWidth = radiator.width * (mobile ? 0.82 : 1);
        radianceContext.globalAlpha =
          (0.26 + pulse * 0.34) * (0.72 + radiator.strength * 0.28);
        radianceContext.stroke();

        if (index % 9 === 0) {
          radianceContext.lineWidth = radiator.width * 5.5;
          radianceContext.globalAlpha = 0.05 + pulse * 0.07;
          radianceContext.stroke();
        }

        if (index % 4 === 0) {
          const travel = (seconds * (0.055 + radiator.speed * 0.018) + radiator.phase / TAU) % 1;
          const head = cubicPoint(start, controlOne, controlTwo, end, travel);
          radianceContext.beginPath();
          radianceContext.arc(head.x, head.y, 0.45 + radiator.width * 0.45, 0, TAU);
          radianceContext.fillStyle = `rgb(${Math.min(255, color[0] + 72)} ${Math.min(
            255,
            color[1] + 72,
          )} ${Math.min(255, color[2] + 72)})`;
          radianceContext.globalAlpha = 0.36 + pulse * 0.42;
          radianceContext.fill();
        }
      }

      particles.forEach((particle) => {
        const color = AURORA_COLORS[particle.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * particle.speed * 1.8 + particle.phase);
        const x = tree.x + tree.size * (particle.x + Math.sin(seconds * 0.7 + particle.phase) * 0.003);
        const y = tree.y + tree.size * (particle.y + Math.cos(seconds * 0.55 + particle.phase) * 0.002);
        radianceContext.beginPath();
        radianceContext.arc(x, y, particle.size * (0.55 + pulse * 0.5), 0, TAU);
        radianceContext.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        radianceContext.globalAlpha = 0.16 + pulse * 0.38;
        radianceContext.fill();
      });

      radianceContext.restore();
    };

    const paintFlowLayer = (seconds, tree) => {
      flowContext.clearRect(0, 0, width, height);
      flowContext.save();
      flowContext.globalCompositeOperation = "source-over";

      const drift = Math.sin(seconds * 0.43) * tree.size * 0.1;
      const base = flowContext.createLinearGradient(
        tree.x - tree.size * 0.12 + drift,
        tree.y + tree.size,
        tree.x + tree.size * 1.12 + drift,
        tree.y,
      );
      base.addColorStop(0, "rgba(45, 104, 255, 0.54)");
      base.addColorStop(0.25, "rgba(55, 232, 255, 0.78)");
      base.addColorStop(0.48, "rgba(102, 255, 222, 0.62)");
      base.addColorStop(0.72, "rgba(76, 112, 255, 0.74)");
      base.addColorStop(1, "rgba(155, 75, 255, 0.62)");
      flowContext.fillStyle = base;
      flowContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      flowContext.globalCompositeOperation = "lighter";
      AURORA_COLORS.slice(0, 4).forEach((color, index) => {
        const orbit = seconds * (0.34 + index * 0.07) + index * 1.7;
        const x = tree.x + tree.size * (0.5 + Math.sin(orbit) * (0.3 - index * 0.025));
        const y = tree.y + tree.size * (0.48 + Math.cos(orbit * 0.82) * 0.31);
        const glow = flowContext.createRadialGradient(x, y, 0, x, y, tree.size * 0.23);
        glow.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.62)`);
        glow.addColorStop(0.52, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.16)`);
        glow.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
        flowContext.fillStyle = glow;
        flowContext.fillRect(tree.x, tree.y, tree.size, tree.size);
      });

      const progress = (seconds % 6) / 6;
      const scanY = tree.y + tree.size * (1.05 - progress * 1.12);
      const scan = flowContext.createLinearGradient(
        0,
        scanY - tree.size * 0.09,
        0,
        scanY + tree.size * 0.09,
      );
      scan.addColorStop(0, "rgba(236, 255, 255, 0)");
      scan.addColorStop(0.5, "rgba(236, 255, 255, 0.72)");
      scan.addColorStop(1, "rgba(236, 255, 255, 0)");
      flowContext.fillStyle = scan;
      flowContext.fillRect(tree.x, scanY - tree.size * 0.09, tree.size, tree.size * 0.18);

      flowContext.globalCompositeOperation = "destination-in";
      flowContext.globalAlpha = 1;
      flowContext.drawImage(flowMaskImage, tree.x, tree.y, tree.size, tree.size);
      flowContext.restore();
    };

    const paintVeinLayer = (seconds, tree) => {
      veinContext.clearRect(0, 0, width, height);
      veinContext.save();
      veinContext.globalCompositeOperation = "source-over";

      const breathe = 0.95 + Math.sin(seconds * (TAU / 6)) * 0.05;
      const gold = veinContext.createLinearGradient(
        tree.x + tree.size * 0.22,
        tree.y + tree.size,
        tree.x + tree.size * 0.72,
        tree.y,
      );
      gold.addColorStop(0, "rgb(183 99 20)");
      gold.addColorStop(0.34, "rgb(232 154 43)");
      gold.addColorStop(0.68, "rgb(255 204 82)");
      gold.addColorStop(1, "rgb(255 234 151)");
      veinContext.fillStyle = gold;
      veinContext.globalAlpha = breathe;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      veinContext.globalCompositeOperation = "lighter";
      veinContext.globalAlpha = 1;
      const progress = (seconds % 6) / 6;
      const energyY = tree.y + tree.size * (1.03 - progress * 1.08);
      const energyX = tree.x + tree.size * (0.5 + Math.sin(seconds * 0.82) * 0.035);
      const energy = veinContext.createRadialGradient(
        energyX,
        energyY,
        0,
        energyX,
        energyY,
        tree.size * 0.14,
      );
      energy.addColorStop(0, "rgba(255, 255, 226, 0.98)");
      energy.addColorStop(0.34, "rgba(255, 221, 117, 0.6)");
      energy.addColorStop(1, "rgba(255, 184, 53, 0)");
      veinContext.fillStyle = energy;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      const corePulse = Math.pow(Math.max(0, Math.sin(progress * Math.PI)), 7);
      const coreX = tree.x + tree.size * 0.5;
      const coreY = tree.y + tree.size * 0.51;
      const core = veinContext.createRadialGradient(
        coreX,
        coreY,
        tree.size * 0.01,
        coreX,
        coreY,
        tree.size * (0.07 + corePulse * 0.035),
      );
      core.addColorStop(0, `rgba(255, 255, 231, ${0.58 + corePulse * 0.24})`);
      core.addColorStop(0.35, "rgba(255, 223, 122, 0.34)");
      core.addColorStop(1, "rgba(255, 174, 42, 0)");
      veinContext.fillStyle = core;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      veinContext.globalCompositeOperation = "destination-in";
      veinContext.globalAlpha = 1;
      veinContext.drawImage(veinMaskImage, tree.x, tree.y, tree.size, tree.size);
      veinContext.restore();
    };

    const draw = (timestamp = 0) => {
      if (!loaded || !width || !height || destroyed) {
        return;
      }

      const seconds = timestamp / 1000;
      const tree = getTreeRect();
      context.clearRect(0, 0, width, height);
      paintAmbientLight(seconds, tree);
      paintRadianceLayer(seconds, tree);
      paintFlowLayer(seconds, tree);
      paintVeinLayer(seconds, tree);

      context.save();
      context.globalCompositeOperation = "lighter";

      context.filter = `blur(${Math.max(width <= 720 ? 4 : 7, tree.size * 0.015)}px)`;
      context.globalAlpha = width <= 720 ? 0.38 : 0.52;
      context.drawImage(radianceCanvas, 0, 0, width, height);
      context.filter = "none";
      context.globalAlpha = width <= 720 ? 0.82 : 0.98;
      context.drawImage(radianceCanvas, 0, 0, width, height);

      if (width > 720) {
        context.filter = `blur(${Math.max(4, tree.size * 0.009)}px)`;
        context.globalAlpha = 0.27;
        context.drawImage(flowCanvas, 0, 0, width, height);
      }
      context.filter = "none";
      context.globalAlpha = 0.58;
      context.drawImage(flowCanvas, 0, 0, width, height);

      context.filter = `blur(${Math.max(4, tree.size * 0.008)}px)`;
      context.globalAlpha = 0.42;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.filter = "none";
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 0.98;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.restore();
    };

    const sizeLayer = (layer, layerContext, scale) => {
      layer.width = Math.max(1, Math.round(width * scale));
      layer.height = Math.max(1, Math.round(height * scale));
      layerContext.setTransform(scale, 0, 0, scale, 0, 0);
      layerContext.imageSmoothingEnabled = true;
      layerContext.imageSmoothingQuality = "high";
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const deviceScale = window.devicePixelRatio || 1;
      const preferredScale = width <= 720 ? Math.min(deviceScale, 1.25) : Math.min(deviceScale, 1.5);
      const pixelScale = Math.min(preferredScale, 2560 / width, 2160 / height);
      const desiredCoreScale = width <= 720 ? Math.min(deviceScale, 1.25) : Math.min(deviceScale, 1.75);
      const coreScale = Math.min(desiredCoreScale, 2560 / width, 2160 / height);
      const radianceScale = Math.min(1, 2560 / width, 2160 / height);

      canvas.width = Math.max(1, Math.round(width * pixelScale));
      canvas.height = Math.max(1, Math.round(height * pixelScale));
      context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      sizeLayer(flowCanvas, flowContext, coreScale);
      sizeLayer(veinCanvas, veinContext, coreScale);
      sizeLayer(radianceCanvas, radianceContext, radianceScale);
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
      const frameInterval = width <= 720 ? 1000 / 24 : 1000 / 30;
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
        window.clearTimeout(resizeTimer);
        resizeTimer = 0;
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

    const handleAssetLoad = () => {
      if (destroyed) {
        return;
      }
      loadedAssetCount += 1;
      if (loadedAssetCount !== 3 || assetFailed) {
        return;
      }
      loaded = true;
      buildGeometry();
      canvas.closest(".aurora-bg, .wallpaper")?.classList.add("aurora-ready");
      resize();
      start();
    };

    const handleAssetError = () => {
      if (destroyed) {
        return;
      }
      assetFailed = true;
      canvas.closest(".aurora-bg, .wallpaper")?.classList.add("aurora-error");
      stop();
    };

    [
      [flowMaskImage, flowMaskSource],
      [sourceMaskImage, sourceMaskSource],
      [veinMaskImage, veinMaskSource],
    ].forEach(([image, source]) => {
      image.addEventListener("load", handleAssetLoad, { once: true });
      image.addEventListener("error", handleAssetError, { once: true });
      image.decoding = "async";
      image.src = new URL(source, document.baseURI).href;
    });

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
