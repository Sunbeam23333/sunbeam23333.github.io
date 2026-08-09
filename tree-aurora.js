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
    const mobileRadiators = [];
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

      const sampleSize = 320;
      const pixelCount = sampleSize * sampleSize;
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;

      sampleContext.drawImage(sourceMaskImage, 0, 0, sampleSize, sampleSize);
      const sourcePixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      sampleContext.clearRect(0, 0, sampleSize, sampleSize);
      sampleContext.drawImage(flowMaskImage, 0, 0, sampleSize, sampleSize);
      const flowPixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      const sourceAlphaAt = (x, y) => sourcePixels[(y * sampleSize + x) * 4 + 3];
      const flowAlphaAt = (x, y) => flowPixels[(y * sampleSize + x) * 4 + 3];

      // A geodesic distance from the lower trunk gives every connected branch a
      // stable root-to-tip direction. Detached leaves fall back to a radial sign.
      const flowDistance = new Int32Array(pixelCount);
      flowDistance.fill(-1);
      let seedX = Math.round(sampleSize * 0.5);
      let seedY = Math.round(sampleSize * 0.65);
      let seedAlpha = -1;
      for (let y = Math.round(sampleSize * 0.61); y <= Math.round(sampleSize * 0.68); y += 1) {
        for (let x = Math.round(sampleSize * 0.47); x <= Math.round(sampleSize * 0.53); x += 1) {
          const alpha = flowAlphaAt(x, y);
          if (alpha > seedAlpha) {
            seedAlpha = alpha;
            seedX = x;
            seedY = y;
          }
        }
      }

      const queue = new Int32Array(pixelCount);
      let queueHead = 0;
      let queueTail = 0;
      const seedIndex = seedY * sampleSize + seedX;
      flowDistance[seedIndex] = 0;
      queue[queueTail] = seedIndex;
      queueTail += 1;
      let maximumFlowDistance = 1;
      const neighborOffsets = [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];

      while (queueHead < queueTail) {
        const index = queue[queueHead];
        queueHead += 1;
        const x = index % sampleSize;
        const y = Math.floor(index / sampleSize);
        const nextDistance = flowDistance[index] + 1;
        neighborOffsets.forEach(([offsetX, offsetY]) => {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= sampleSize || nextY >= sampleSize) {
            return;
          }
          const nextIndex = nextY * sampleSize + nextX;
          if (flowDistance[nextIndex] >= 0 || flowAlphaAt(nextX, nextY) <= 24) {
            return;
          }
          flowDistance[nextIndex] = nextDistance;
          maximumFlowDistance = Math.max(maximumFlowDistance, nextDistance);
          queue[queueTail] = nextIndex;
          queueTail += 1;
        });
      }

      const estimateTangent = (centerX, centerY) => {
        const radius = 8;
        const sigmaSquared = 18;
        let totalWeight = 0;
        let weightedX = 0;
        let weightedY = 0;
        let weightedXX = 0;
        let weightedXY = 0;
        let weightedYY = 0;

        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
          const y = centerY + offsetY;
          if (y < 0 || y >= sampleSize) {
            continue;
          }
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            const x = centerX + offsetX;
            if (x < 0 || x >= sampleSize) {
              continue;
            }
            const alpha = flowAlphaAt(x, y) / 255;
            if (alpha < 0.04) {
              continue;
            }
            const weight = alpha * Math.exp(-(offsetX * offsetX + offsetY * offsetY) / sigmaSquared);
            totalWeight += weight;
            weightedX += offsetX * weight;
            weightedY += offsetY * weight;
            weightedXX += offsetX * offsetX * weight;
            weightedXY += offsetX * offsetY * weight;
            weightedYY += offsetY * offsetY * weight;
          }
        }

        if (totalWeight < 0.8) {
          return null;
        }
        const meanX = weightedX / totalWeight;
        const meanY = weightedY / totalWeight;
        const covarianceXX = weightedXX / totalWeight - meanX * meanX;
        const covarianceXY = weightedXY / totalWeight - meanX * meanY;
        const covarianceYY = weightedYY / totalWeight - meanY * meanY;
        const difference = Math.hypot(covarianceXX - covarianceYY, 2 * covarianceXY);
        const trace = covarianceXX + covarianceYY;
        const coherence = difference / Math.max(0.001, trace);
        if (coherence < 0.3) {
          return null;
        }

        const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
        return {
          x: Math.cos(angle),
          y: Math.sin(angle),
          coherence,
        };
      };

      const probeDistance = (x, y) => {
        const centerX = Math.round(x);
        const centerY = Math.round(y);
        let best = -1;
        for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
          for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
            const probeX = centerX + offsetX;
            const probeY = centerY + offsetY;
            if (probeX < 0 || probeY < 0 || probeX >= sampleSize || probeY >= sampleSize) {
              continue;
            }
            best = Math.max(best, flowDistance[probeY * sampleSize + probeX]);
          }
        }
        return best;
      };

      const orientTowardBranchTip = (x, y, tangent) => {
        const probeLength = 7;
        const forwardDistance = probeDistance(x + tangent.x * probeLength, y + tangent.y * probeLength);
        const backwardDistance = probeDistance(x - tangent.x * probeLength, y - tangent.y * probeLength);
        let direction = 1;

        if (forwardDistance < 0 && backwardDistance >= 0) {
          direction = 1;
        } else if (backwardDistance < 0 && forwardDistance >= 0) {
          direction = -1;
        } else if (forwardDistance >= 0 && backwardDistance >= 0) {
          direction = forwardDistance >= backwardDistance ? 1 : -1;
        } else {
          const radialX = x / sampleSize - 0.5;
          const radialY = y / sampleSize - 0.55;
          direction = tangent.x * radialX + tangent.y * radialY >= 0 ? 1 : -1;
        }

        let directionX = tangent.x * direction;
        let directionY = tangent.y * direction;
        let radialX = x / sampleSize - 0.5;
        let radialY = y / sampleSize - 0.55;
        const radialLength = Math.max(0.001, Math.hypot(radialX, radialY));
        radialX /= radialLength;
        radialY /= radialLength;
        directionX = directionX * 0.96 + radialX * 0.04;
        directionY = directionY * 0.96 + radialY * 0.04;
        const directionLength = Math.max(0.001, Math.hypot(directionX, directionY));
        return {
          x: directionX / directionLength,
          y: directionY / directionLength,
        };
      };

      const branchCandidates = [];
      const interiorCandidates = [];
      const gridSize = mode === "wallpaper" ? 7 : 8;
      const canopyBottom = Math.round(sampleSize * 0.665);

      for (let cellY = 2; cellY < canopyBottom; cellY += gridSize) {
        for (let cellX = 2; cellX < sampleSize - 2; cellX += gridSize) {
          let bestX = -1;
          let bestY = -1;
          let bestAlpha = 64;
          for (let y = cellY; y < Math.min(canopyBottom, cellY + gridSize); y += 1) {
            for (let x = cellX; x < Math.min(sampleSize - 2, cellX + gridSize); x += 1) {
              const alpha = flowAlphaAt(x, y);
              if (alpha > bestAlpha) {
                bestAlpha = alpha;
                bestX = x;
                bestY = y;
              }
            }
          }
          if (bestX < 0) {
            continue;
          }

          const normalizedX = bestX / sampleSize;
          const normalizedY = bestY / sampleSize;
          const isTrunk =
            normalizedY >= 0.425 &&
            normalizedY <= 0.665 &&
            Math.abs(normalizedX - 0.5) <= 0.035;
          if (isTrunk) {
            continue;
          }

          const tangent = estimateTangent(bestX, bestY);
          if (!tangent) {
            continue;
          }
          const direction = orientTowardBranchTip(bestX, bestY, tangent);
          const distance = flowDistance[bestY * sampleSize + bestX];
          const radialDistance = Math.hypot(normalizedX - 0.5, normalizedY - 0.55);
          const outwardness =
            distance >= 0 ? distance / maximumFlowDistance : Math.min(1, radialDistance / 0.52);
          branchCandidates.push({
            x: normalizedX,
            y: normalizedY,
            nx: direction.x,
            ny: direction.y,
            strength: 0.62 + tangent.coherence * 0.38,
            order: random() * 0.62 + outwardness * 0.38,
          });
        }
      }

      for (let y = 5; y < canopyBottom; y += 3) {
        for (let x = 5; x < sampleSize - 5; x += 3) {
          if (sourceAlphaAt(x, y) > 112) {
            interiorCandidates.push({ x: x / sampleSize, y: y / sampleSize });
          }
        }
      }

      branchCandidates.sort((first, second) => second.order - first.order);
      const canopyParentCount = mode === "wallpaper" ? 190 : 140;
      const canopyParents = [];
      const colorSequence = [0, 1, 1, 2, 2, 3, 4];
      branchCandidates.slice(0, canopyParentCount).forEach((candidate, index) => {
        const angle = (random() - 0.5) * 0.07;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        canopyParents.push({
          x: candidate.x,
          y: candidate.y,
          nx: candidate.nx * cosine - candidate.ny * sine,
          ny: candidate.nx * sine + candidate.ny * cosine,
          length: random() < 0.74 ? 0.034 + random() * 0.052 : 0.086 + random() * 0.055,
          bend: (random() - 0.5) * 0.02,
          phase: random() * TAU,
          speed: 0.72 + random() * 0.68,
          width: 0.34 + random() * 0.5,
          color: colorSequence[Math.floor(random() * colorSequence.length)],
          strength: candidate.strength,
          alpha: 0.68 + random() * 0.28,
          strandCount: 3,
          strandGap: 0.0019 + random() * 0.0014,
          strandSpread: 0.035 + random() * 0.02,
          strandLengths: [0.86 + random() * 0.1, 0.98 + random() * 0.08, 0.9 + random() * 0.16],
          inset: 0.007,
          sway: 0.0038 + random() * 0.0018,
          glow: index % 12 === 0,
          head: index % 9 === 0,
          kind: "canopy",
        });
      });

      const trunkParents = [];
      const trunkRowCount = mode === "wallpaper" ? 12 : 11;
      for (let row = 0; row < trunkRowCount; row += 1) {
        const targetY = Math.round(sampleSize * (0.49 + (row / Math.max(1, trunkRowCount - 1)) * 0.2));
        let trunkX = Math.round(sampleSize * 0.5);
        let trunkY = targetY;
        let trunkAlpha = -1;
        let trunkOffset = Number.POSITIVE_INFINITY;
        for (let y = targetY - 2; y <= targetY + 2; y += 1) {
          for (let x = Math.round(sampleSize * 0.465); x <= Math.round(sampleSize * 0.535); x += 1) {
            const alpha = flowAlphaAt(x, y);
            const offset = Math.abs(x - sampleSize * 0.5) + Math.abs(y - targetY);
            if (alpha > trunkAlpha || (alpha === trunkAlpha && offset < trunkOffset)) {
              trunkAlpha = alpha;
              trunkX = x;
              trunkY = y;
              trunkOffset = offset;
            }
          }
        }
        if (trunkAlpha < 48) {
          continue;
        }

        // The central Cassel trunk is intentionally close to vertical. Keeping
        // this normal horizontal makes its energy feathers read as perpendicular
        // even near the two large branch junctions where PCA becomes ambiguous.
        const normalX = 1;
        const normalY = 0;
        [-1, 1].forEach((side, sideIndex) => {
          let edgeStep = 10;
          let transparentRun = 0;
          for (let step = 0; step <= 10; step += 1) {
            const edgeX = Math.round(trunkX + normalX * side * step);
            const edgeY = Math.round(trunkY + normalY * side * step);
            if (
              edgeX < 0 ||
              edgeY < 0 ||
              edgeX >= sampleSize ||
              edgeY >= sampleSize
            ) {
              edgeStep = step;
              break;
            }
            transparentRun = flowAlphaAt(edgeX, edgeY) < 24 ? transparentRun + 1 : 0;
            if (transparentRun >= 2) {
              edgeStep = Math.max(1, step - 1);
              break;
            }
          }
          const directionX = normalX * side;
          const directionY = normalY * side;
          trunkParents.push({
            x: (trunkX + directionX * edgeStep) / sampleSize,
            y: (trunkY + directionY * edgeStep) / sampleSize,
            nx: directionX,
            ny: directionY,
            length: 0.026 + random() * 0.043,
            bend: (random() - 0.5) * 0.009,
            phase: row * 0.52 + sideIndex * 0.24,
            speed: 0.84 + random() * 0.44,
            width: 0.3 + random() * 0.38,
            color: Math.floor(random() * 3),
            strength: 0.94,
            alpha: 0.78 + random() * 0.2,
            strandCount: 3,
            strandGap: 0.0021,
            strandSpread: 0.022,
            strandLengths: [0.86, 1.02, 0.92],
            inset: 0.002,
            sway: 0.0026,
            glow: row % 4 === 0 && sideIndex === 0,
            head: row % 4 === 1 && sideIndex === 0,
            kind: "trunk",
          });
        });
      }

      const prepareStrandDirections = (radiator) => {
        const strandCenter = (radiator.strandCount - 1) / 2;
        radiator.strandCosines = [];
        radiator.strandSines = [];
        for (let strand = 0; strand < radiator.strandCount; strand += 1) {
          const angle = (strand - strandCenter) * radiator.strandSpread;
          radiator.strandCosines.push(Math.cos(angle));
          radiator.strandSines.push(Math.sin(angle));
        }
      };
      canopyParents.forEach(prepareStrandDirections);
      trunkParents.forEach(prepareStrandDirections);

      radiators.length = 0;
      radiators.push(...canopyParents, ...trunkParents);
      mobileRadiators.length = 0;
      const mobileCanopyCount = mode === "wallpaper" ? 64 : 54;
      mobileRadiators.push(...trunkParents, ...canopyParents.slice(0, mobileCanopyCount));

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
      const activeRadiators = mobile ? mobileRadiators : radiators;

      for (let index = 0; index < activeRadiators.length; index += 1) {
        const radiator = activeRadiators[index];
        const color = AURORA_COLORS[radiator.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase);
        radianceContext.beginPath();
        const middleStrand = Math.floor(radiator.strandCount / 2);
        const strandCenter = (radiator.strandCount - 1) / 2;
        let centerPath = null;

        for (let strand = 0; strand < radiator.strandCount; strand += 1) {
          const strandOffset = strand - strandCenter;
          const cosine = radiator.strandCosines[strand];
          const sine = radiator.strandSines[strand];
          const directionX = radiator.nx * cosine - radiator.ny * sine;
          const directionY = radiator.nx * sine + radiator.ny * cosine;
          const tangentX = -directionY;
          const tangentY = directionX;
          const strandPulse =
            0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase + strandOffset * 0.22);
          const length =
            tree.size *
            radiator.length *
            radiator.strandLengths[strand] *
            (0.74 + strandPulse * 0.36);
          const sway =
            Math.sin(seconds * (TAU / 6) + radiator.phase + strandOffset * 0.34) *
            tree.size *
            radiator.sway;
          const bend = tree.size * (radiator.bend + strandOffset * 0.0016) + sway;
          const lateralOffset = strandOffset * tree.size * radiator.strandGap;
          const startX =
            tree.x +
            tree.size * radiator.x +
            tangentX * lateralOffset -
            directionX * tree.size * radiator.inset;
          const startY =
            tree.y +
            tree.size * radiator.y +
            tangentY * lateralOffset -
            directionY * tree.size * radiator.inset;
          const controlOneX = startX + directionX * length * 0.35 + tangentX * bend;
          const controlOneY = startY + directionY * length * 0.35 + tangentY * bend;
          const controlTwoX = startX + directionX * length * 0.73 - tangentX * bend * 0.42;
          const controlTwoY = startY + directionY * length * 0.73 - tangentY * bend * 0.42;
          const endX = startX + directionX * length + tangentX * sway * 0.44;
          const endY = startY + directionY * length + tangentY * sway * 0.44;

          radianceContext.moveTo(startX, startY);
          radianceContext.bezierCurveTo(
            controlOneX,
            controlOneY,
            controlTwoX,
            controlTwoY,
            endX,
            endY,
          );

          if (radiator.head && strand === middleStrand) {
            centerPath = {
              start: { x: startX, y: startY },
              controlOne: { x: controlOneX, y: controlOneY },
              controlTwo: { x: controlTwoX, y: controlTwoY },
              end: { x: endX, y: endY },
            };
          }
        }

        radianceContext.strokeStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        radianceContext.lineWidth = radiator.width * (mobile ? 0.82 : 1);
        radianceContext.globalAlpha =
          (0.18 + pulse * 0.28) * (0.72 + radiator.strength * 0.28) * radiator.alpha;
        radianceContext.stroke();

        if (!mobile && radiator.glow) {
          radianceContext.lineWidth = radiator.width * 4.8;
          radianceContext.globalAlpha = (0.028 + pulse * 0.046) * radiator.alpha;
          radianceContext.stroke();
        }

        if (radiator.head && centerPath) {
          const travel = (seconds * (0.055 + radiator.speed * 0.018) + radiator.phase / TAU) % 1;
          const head = cubicPoint(
            centerPath.start,
            centerPath.controlOne,
            centerPath.controlTwo,
            centerPath.end,
            travel,
          );
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

      const activeParticleCount = mobile
        ? Math.min(mode === "wallpaper" ? 30 : 24, particles.length)
        : particles.length;
      for (let index = 0; index < activeParticleCount; index += 1) {
        const particle = particles[index];
        const color = AURORA_COLORS[particle.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * particle.speed * 1.8 + particle.phase);
        const x = tree.x + tree.size * (particle.x + Math.sin(seconds * 0.7 + particle.phase) * 0.003);
        const y = tree.y + tree.size * (particle.y + Math.cos(seconds * 0.55 + particle.phase) * 0.002);
        radianceContext.beginPath();
        radianceContext.arc(x, y, particle.size * (0.55 + pulse * 0.5), 0, TAU);
        radianceContext.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
        radianceContext.globalAlpha = 0.16 + pulse * 0.38;
        radianceContext.fill();
      }

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
