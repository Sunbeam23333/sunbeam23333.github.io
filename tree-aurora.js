(function () {
  "use strict";

  const mountedCanvases = new WeakMap();
  const TAU = Math.PI * 2;
  const AURORA_PALETTES = [
    { middle: [96, 239, 255], outer: [37, 139, 255], tip: [48, 55, 224] },
    { middle: [51, 211, 255], outer: [39, 105, 255], tip: [62, 48, 218] },
    { middle: [104, 246, 213], outer: [41, 164, 255], tip: [55, 62, 224] },
    { middle: [123, 203, 255], outer: [61, 96, 255], tip: [102, 53, 215] },
    { middle: [169, 238, 255], outer: [63, 133, 255], tip: [126, 61, 214] },
  ];

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

    const veinCanvas = document.createElement("canvas");
    const veinContext = veinCanvas.getContext("2d", { alpha: true });
    const radianceCanvas = document.createElement("canvas");
    const radianceContext = radianceCanvas.getContext("2d", { alpha: true });
    if (!veinContext || !radianceContext) {
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
      sampleContext.clearRect(0, 0, sampleSize, sampleSize);
      sampleContext.drawImage(veinMaskImage, 0, 0, sampleSize, sampleSize);
      const veinPixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      const sourceAlphaAt = (x, y) => sourcePixels[(y * sampleSize + x) * 4 + 3];
      const flowAlphaAt = (x, y) => flowPixels[(y * sampleSize + x) * 4 + 3];
      const veinAlphaAt = (x, y) => veinPixels[(y * sampleSize + x) * 4 + 3];

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

      const snapToVein = (centerX, centerY, radius = 3) => {
        let bestX = Math.round(centerX);
        let bestY = Math.round(centerY);
        let bestScore = veinAlphaAt(bestX, bestY);
        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            const x = Math.round(centerX + offsetX);
            const y = Math.round(centerY + offsetY);
            if (x < 0 || y < 0 || x >= sampleSize || y >= sampleSize) {
              continue;
            }
            const score =
              veinAlphaAt(x, y) - Math.hypot(offsetX, offsetY) * 3.5;
            if (score > bestScore) {
              bestScore = score;
              bestX = x;
              bestY = y;
            }
          }
        }
        return { x: bestX, y: bestY };
      };

      const findVeinCrossSection = (centerX, centerY, normalX, normalY) => {
        const measureSide = (side) => {
          let lastInside = 0;
          let outsideRun = 0;
          for (let step = 0; step <= 12; step += 0.5) {
            const x = Math.round(centerX + normalX * side * step);
            const y = Math.round(centerY + normalY * side * step);
            if (x < 0 || y < 0 || x >= sampleSize || y >= sampleSize) {
              break;
            }
            if (veinAlphaAt(x, y) > 20) {
              lastInside = step;
              outsideRun = 0;
            } else {
              outsideRun += 1;
              if (outsideRun >= 2) {
                break;
              }
            }
          }
          return lastInside;
        };

        return {
          negative: measureSide(-1),
          positive: measureSide(1),
        };
      };

      const branchCandidates = [];
      const gridSize = mode === "wallpaper" ? 4 : 5;
      const branchBottom = Math.round(sampleSize * 0.965);

      for (let cellY = 2; cellY < branchBottom; cellY += gridSize) {
        for (let cellX = 2; cellX < sampleSize - 2; cellX += gridSize) {
          let bestX = -1;
          let bestY = -1;
          let bestAlpha = 64;
          let bestScore = 64;
          for (let y = cellY; y < Math.min(branchBottom, cellY + gridSize); y += 1) {
            for (let x = cellX; x < Math.min(sampleSize - 2, cellX + gridSize); x += 1) {
              const alpha = flowAlphaAt(x, y);
              const score = alpha + veinAlphaAt(x, y) * 1.8;
              if (alpha > 64 && score > bestScore) {
                bestScore = score;
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
            normalizedY <= 0.725 &&
            Math.abs(normalizedX - 0.5) <= 0.04;
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
            sampleX: bestX,
            sampleY: bestY,
            nx: direction.x,
            ny: direction.y,
            strength: 0.62 + tangent.coherence * 0.38,
            coherence: tangent.coherence,
            order: random() * 0.62 + outwardness * 0.38,
            outwardness,
            seedNoise: random(),
            pickNoise: random(),
          });
        }
      }

      // The Seed reference gets its volume from compact feather-like clusters,
      // not from a uniform halo. Spread anisotropic cluster seeds across the
      // full canopy and roots, then keep a small number of isolated fibers to
      // preserve the tree silhouette between dense plumes.
      const clusterCount = mode === "wallpaper" ? 15 : 12;
      const clusterSeeds = [];
      while (clusterSeeds.length < clusterCount && branchCandidates.length) {
        let bestCandidate = null;
        let bestScore = -1;
        branchCandidates.forEach((candidate) => {
          if (clusterSeeds.some((seed) => seed.candidate === candidate)) {
            return;
          }
          let separation = 0.38;
          if (clusterSeeds.length) {
            separation = clusterSeeds.reduce(
              (minimum, seed) =>
                Math.min(minimum, Math.hypot(candidate.x - seed.x, candidate.y - seed.y)),
              Number.POSITIVE_INFINITY,
            );
          }
          const score =
            Math.min(0.32, separation) * 0.66 +
            candidate.outwardness * 0.24 +
            candidate.seedNoise * 0.1;
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        });
        if (!bestCandidate) {
          break;
        }
        clusterSeeds.push({
          candidate: bestCandidate,
          x: bestCandidate.x,
          y: bestCandidate.y,
          nx: bestCandidate.nx,
          ny: bestCandidate.ny,
          sigmaAlong: 0.052 + random() * 0.042,
          sigmaAcross: 0.018 + random() * 0.023,
          quota:
            mode === "wallpaper"
              ? 13 + Math.floor(random() * 6)
              : 11 + Math.floor(random() * 6),
          phase: random() * TAU,
          speed: 0.68 + random() * 0.46,
          members: [],
        });
      }

      const assignCluster = (candidate, memberKey) => {
        let bestClusterIndex = 0;
        let bestDensity = 0;
        clusterSeeds.forEach((seed, clusterIndex) => {
          const deltaX = candidate.x - seed.x;
          const deltaY = candidate.y - seed.y;
          const along = deltaX * seed.nx + deltaY * seed.ny;
          const across = deltaX * -seed.ny + deltaY * seed.nx;
          const distance =
            (along * along) / (seed.sigmaAlong * seed.sigmaAlong) +
            (across * across) / (seed.sigmaAcross * seed.sigmaAcross);
          const density = Math.exp(-0.5 * distance);
          if (density > bestDensity) {
            bestDensity = density;
            bestClusterIndex = clusterIndex;
          }
        });
        candidate.clusterIndex = bestClusterIndex;
        candidate.clusterDensity = bestDensity;
        clusterSeeds[bestClusterIndex]?.[memberKey].push(candidate);
      };
      branchCandidates.forEach((candidate) => assignCluster(candidate, "members"));

      const fillCandidates = [];
      const fillGridSize = mode === "wallpaper" ? 5 : 6;
      for (let cellY = 3; cellY < branchBottom; cellY += fillGridSize) {
        for (let cellX = 3; cellX < sampleSize - 3; cellX += fillGridSize) {
          let bestX = -1;
          let bestY = -1;
          let bestAlpha = 96;
          for (let y = cellY; y < Math.min(branchBottom, cellY + fillGridSize); y += 1) {
            for (let x = cellX; x < Math.min(sampleSize - 3, cellX + fillGridSize); x += 1) {
              const alpha = sourceAlphaAt(x, y);
              if (alpha > bestAlpha && flowAlphaAt(x, y) < 176) {
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
          const isCentralTrunk =
            normalizedY >= 0.425 &&
            normalizedY <= 0.725 &&
            Math.abs(normalizedX - 0.5) <= 0.11;
          if (isCentralTrunk) {
            continue;
          }
          let radialX = normalizedX - 0.5;
          let radialY = normalizedY - 0.54;
          const radialLength = Math.max(0.001, Math.hypot(radialX, radialY));
          radialX /= radialLength;
          radialY /= radialLength;

          let nearestBranch = null;
          let nearestDistance = Number.POSITIVE_INFINITY;
          branchCandidates.forEach((candidate) => {
            const distance = Math.hypot(normalizedX - candidate.x, normalizedY - candidate.y);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestBranch = candidate;
            }
          });

          let directionX = nearestBranch ? nearestBranch.nx * 0.32 + radialX * 0.68 : radialX;
          let directionY = nearestBranch ? nearestBranch.ny * 0.32 + radialY * 0.68 : radialY;
          const directionLength = Math.max(0.001, Math.hypot(directionX, directionY));
          const fillCandidate = {
            x: normalizedX,
            y: normalizedY,
            nx: directionX / directionLength,
            ny: directionY / directionLength,
            strength: 0.72 + (bestAlpha / 255) * 0.28,
            order: random(),
            pickNoise: random(),
          };
          fillCandidates.push(fillCandidate);
        }
      }

      const fillClusterCount = mode === "wallpaper" ? 30 : 24;
      const fillClusterSeeds = [];
      while (fillClusterSeeds.length < fillClusterCount && fillCandidates.length) {
        let bestCandidate = null;
        let bestScore = -1;
        fillCandidates.forEach((candidate) => {
          if (fillClusterSeeds.some((seed) => seed.candidate === candidate)) {
            return;
          }
          let separation = 0.42;
          if (fillClusterSeeds.length) {
            separation = fillClusterSeeds.reduce(
              (minimum, seed) =>
                Math.min(minimum, Math.hypot(candidate.x - seed.x, candidate.y - seed.y)),
              Number.POSITIVE_INFINITY,
            );
          }
          const score = Math.min(0.34, separation) * 0.86 + candidate.order * 0.14;
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        });
        if (!bestCandidate) {
          break;
        }
        fillClusterSeeds.push({
          candidate: bestCandidate,
          x: bestCandidate.x,
          y: bestCandidate.y,
          nx: bestCandidate.nx,
          ny: bestCandidate.ny,
          sigmaAlong: 0.04 + random() * 0.042,
          sigmaAcross: 0.021 + random() * 0.025,
          phase: random() * TAU,
          speed: 0.68 + random() * 0.46,
          members: [],
        });
      }

      fillCandidates.forEach((candidate) => {
        let bestClusterIndex = 0;
        let bestDensity = 0;
        fillClusterSeeds.forEach((seed, clusterIndex) => {
          const deltaX = candidate.x - seed.x;
          const deltaY = candidate.y - seed.y;
          const along = deltaX * seed.nx + deltaY * seed.ny;
          const across = deltaX * -seed.ny + deltaY * seed.nx;
          const distance =
            (along * along) / (seed.sigmaAlong * seed.sigmaAlong) +
            (across * across) / (seed.sigmaAcross * seed.sigmaAcross);
          const density = Math.exp(-0.5 * distance);
          if (density > bestDensity) {
            bestDensity = density;
            bestClusterIndex = clusterIndex;
          }
        });
        candidate.fillClusterIndex = bestClusterIndex;
        candidate.clusterDensity = bestDensity;
        fillClusterSeeds[bestClusterIndex]?.members.push(candidate);
      });

      const selectedCandidates = [];
      const selectedCandidateSet = new Set();
      clusterSeeds.forEach((seed) => {
        seed.members.sort(
          (first, second) =>
            second.clusterDensity * (0.78 + second.pickNoise * 0.22) -
            first.clusterDensity * (0.78 + first.pickNoise * 0.22),
        );
        seed.members.slice(0, seed.quota).forEach((candidate) => {
          if (!selectedCandidateSet.has(candidate)) {
            selectedCandidateSet.add(candidate);
            selectedCandidates.push(candidate);
          }
        });
      });

      const sparseFillCount = mode === "wallpaper" ? 34 : 24;
      branchCandidates
        .filter((candidate) => !selectedCandidateSet.has(candidate))
        .sort(
          (first, second) =>
            (1 - second.clusterDensity) * 0.62 + second.order * 0.38 -
            ((1 - first.clusterDensity) * 0.62 + first.order * 0.38),
        )
        .slice(0, sparseFillCount)
        .forEach((candidate) => {
          selectedCandidateSet.add(candidate);
          selectedCandidates.push(candidate);
        });

      const selectedFillCandidates = [];
      const selectedFillSet = new Set();
      fillClusterSeeds.forEach((seed) => {
        seed.members.sort(
          (first, second) =>
            second.clusterDensity * 0.52 + second.pickNoise * 0.48 -
            (first.clusterDensity * 0.52 + first.pickNoise * 0.48),
        );
        const fillQuota =
          mode === "wallpaper"
            ? 18 + Math.floor(random() * 8)
            : 15 + Math.floor(random() * 8);
        seed.members.slice(0, fillQuota).forEach((candidate) => {
          selectedFillSet.add(candidate);
          selectedFillCandidates.push(candidate);
        });
      });
      const fillSparseCount = mode === "wallpaper" ? 100 : 72;
      fillCandidates
        .filter((candidate) => !selectedFillSet.has(candidate))
        .sort(
          (first, second) =>
            (1 - second.clusterDensity) * 0.46 + second.order * 0.54 -
            ((1 - first.clusterDensity) * 0.46 + first.order * 0.54),
        )
        .slice(0, fillSparseCount)
        .forEach((candidate) => {
          selectedFillSet.add(candidate);
          selectedFillCandidates.push(candidate);
        });

      const canopyParents = [];
      const colorSequence = [0, 0, 1, 1, 1, 2, 3, 4];
      selectedCandidates.forEach((candidate, index) => {
        const cluster = clusterSeeds[candidate.clusterIndex];
        const density = candidate.clusterDensity;
        const angle = (random() - 0.5) * (0.024 + (1 - density) * 0.025);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const strandCount =
          density > 0.78
            ? 7 + Math.floor(random() * 3)
            : density > 0.52
              ? 4 + Math.floor(random() * 3)
              : density > 0.28
                ? 2 + Math.floor(random() * 2)
                : 1;
        let length =
          density > 0.6
            ? 0.014 + random() * 0.026
            : 0.01 + random() * 0.02;
        if (density > 0.72 && random() < 0.055) {
          length = 0.04 + random() * 0.01;
        }
        canopyParents.push({
          x: candidate.x,
          y: candidate.y,
          nx: candidate.nx * cosine - candidate.ny * sine,
          ny: candidate.nx * sine + candidate.ny * cosine,
          length,
          bend: (random() - 0.5) * 0.007,
          phase: cluster ? cluster.phase + (random() - 0.5) * 0.45 : random() * TAU,
          speed: cluster ? cluster.speed * (0.94 + random() * 0.12) : 0.7 + random() * 0.48,
          width: 0.35 + random() * 0.3,
          color: colorSequence[Math.floor(random() * colorSequence.length)],
          strength: candidate.strength,
          alpha: 0.84 + random() * 0.15,
          strandCount,
          strandGap:
            density > 0.6
              ? 0.0009 + random() * 0.00058
              : 0.00124 + random() * 0.00076,
          strandSpread:
            density > 0.6
              ? 0.018 + random() * 0.017
              : 0.028 + random() * 0.027,
          strandLengths: Array.from({ length: strandCount }, () => 0.8 + random() * 0.26),
          inset: 0.0015 + random() * 0.0015,
          sway: 0.0008 + random() * 0.0011,
          clusterIndex: candidate.clusterIndex,
          density,
          mint: density > 0.72 && index % 6 === 0,
          kind: "canopy",
        });
      });

      const fillParents = [];
      const fillColorSequence = [0, 0, 1, 1, 1, 2, 2, 3, 4];
      selectedFillCandidates.forEach((candidate, index) => {
        const cluster = fillClusterSeeds[candidate.fillClusterIndex];
        const density = candidate.clusterDensity;
        const angle = (random() - 0.5) * (0.05 + (1 - density) * 0.045);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const strandCount =
          density > 0.78
            ? 7 + Math.floor(random() * 4)
            : density > 0.5
              ? 5 + Math.floor(random() * 3)
              : density > 0.25
                ? 3 + Math.floor(random() * 2)
                : 2;
        let length = 0.018 + random() * (density > 0.55 ? 0.025 : 0.019);
        if (density > 0.72 && random() < 0.045) {
          length = 0.027 + random() * 0.008;
        }
        fillParents.push({
          x: candidate.x,
          y: candidate.y,
          nx: candidate.nx * cosine - candidate.ny * sine,
          ny: candidate.nx * sine + candidate.ny * cosine,
          length,
          bend: (random() - 0.5) * 0.005,
          phase: cluster ? cluster.phase + (random() - 0.5) * 0.62 : random() * TAU,
          speed: cluster ? cluster.speed * (0.92 + random() * 0.16) : 0.7 + random() * 0.44,
          width: 0.22 + random() * 0.2,
          color: fillColorSequence[Math.floor(random() * fillColorSequence.length)],
          strength: candidate.strength,
          alpha: 0.72 + random() * 0.24,
          strandCount,
          strandGap:
            density > 0.55
              ? 0.001 + random() * 0.00072
              : 0.00132 + random() * 0.00088,
          strandSpread:
            density > 0.55
              ? 0.022 + random() * 0.026
              : 0.03 + random() * 0.032,
          strandLengths: Array.from({ length: strandCount }, () => 0.8 + random() * 0.25),
          inset: 0.0004 + random() * 0.0008,
          sway: 0.00065 + random() * 0.0009,
          fillClusterIndex: candidate.fillClusterIndex,
          density,
          mint: density > 0.7 && index % 7 === 0,
          coreAttached: false,
          kind: "fill",
        });
      });

      // Build real leaf-shaped bundles directly on the fine branch network.
      // Every fiber in a bundle opens away from the branch and returns to one
      // shared tip; this is what makes the light read as a leaf instead of a
      // spray of independent needles.
      const leafAnchors = [];
      const primaryLeafTarget = mode === "wallpaper" ? 158 : 128;
      const anchorSpacing = (mode === "wallpaper" ? 6.8 : 8) / sampleSize;
      const leafCandidates = branchCandidates
        .filter(
          (candidate) =>
            candidate.y < 0.735 &&
            candidate.coherence > 0.28 &&
            !(
              candidate.y > 0.43 &&
              candidate.y < 0.725 &&
              Math.abs(candidate.x - 0.5) < 0.065
            ),
        )
        .sort(
          (first, second) =>
            second.outwardness * 0.34 + second.coherence * 0.2 + second.seedNoise * 0.46 -
            (first.outwardness * 0.34 + first.coherence * 0.2 + first.seedNoise * 0.46),
        );

      leafCandidates.forEach((candidate) => {
        if (leafAnchors.length >= primaryLeafTarget) {
          return;
        }
        const separated = leafAnchors.every(
          (anchor) =>
            Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) >= anchorSpacing,
        );
        if (separated) {
          leafAnchors.push(candidate);
        }
      });

      // A second, slightly tighter pass fills short branches that lost a point
      // during Poisson spacing, without producing a regular comb pattern.
      if (leafAnchors.length < primaryLeafTarget) {
        const tighterSpacing = anchorSpacing * 0.72;
        leafCandidates.forEach((candidate) => {
          if (leafAnchors.length >= primaryLeafTarget || leafAnchors.includes(candidate)) {
            return;
          }
          const separated = leafAnchors.every(
            (anchor) =>
              Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) >= tighterSpacing,
          );
          if (separated) {
            leafAnchors.push(candidate);
          }
        });
      }

      const leafParents = [];
      const leafColorSequence = [0, 0, 0, 1, 1, 2, 3, 4];
      const addLeaf = (candidate, ordinal, sideScale = 1, forceOpposite = false) => {
        const branchNormalX = -candidate.ny;
        const branchNormalY = candidate.nx;
        const radialX = candidate.x - 0.5;
        const radialY = candidate.y - 0.5;
        const outwardSide = branchNormalX * radialX + branchNormalY * radialY >= 0 ? 1 : -1;
        let side = ordinal % 3 === 2 ? -outwardSide : outwardSide;
        if (forceOpposite) {
          side *= -1;
        }

        const angle = side * (0.5 + random() * 0.31) * (1 - candidate.outwardness * 0.16);
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        let axisX = candidate.nx * cosine - candidate.ny * sine;
        let axisY = candidate.nx * sine + candidate.ny * cosine;
        const axisLength = Math.max(0.001, Math.hypot(axisX, axisY));
        axisX /= axisLength;
        axisY /= axisLength;

        const length = (0.033 + random() * 0.019) * sideScale;
        const halfWidth = length * (0.3 + random() * 0.095);
        const fiberCount = Math.max(
          14,
          Math.round((20 + Math.floor(random() * 13)) * Math.sqrt(sideScale)),
        );
        const fiberOffsets = [];
        const rootJitters = [];
        const tipNoises = [];
        const tipLengths = [];
        for (let fiber = 0; fiber < fiberCount; fiber += 1) {
          const unit = fiberCount === 1 ? 0 : (fiber / (fiberCount - 1)) * 2 - 1;
          fiberOffsets.push(Math.sign(unit) * Math.pow(Math.abs(unit), 1.35));
          rootJitters.push((random() - 0.5) * 0.035);
          tipNoises.push((random() - 0.5) * 0.045);
          tipLengths.push((random() - 0.5) * 0.024);
        }

        leafParents.push({
          kind: "leaf",
          x: candidate.x,
          y: candidate.y,
          tx: candidate.nx,
          ty: candidate.ny,
          nx: axisX,
          ny: axisY,
          px: -axisY,
          py: axisX,
          length,
          halfWidth,
          baseSpan: length * (0.055 + random() * 0.025),
          curve: (random() - 0.5) * length * 0.095,
          phase: random() * TAU,
          speed: TAU / (5.7 + random() * 0.8),
          width: 0.23 + random() * 0.16,
          alpha: 0.86 + random() * 0.12,
          color: leafColorSequence[Math.floor(random() * leafColorSequence.length)],
          asymmetry: 0.82 + random() * 0.09,
          fiberCount,
          fiberOffsets,
          rootJitters,
          tipNoises,
          tipLengths,
        });
      };

      leafAnchors.forEach((candidate, index) => {
        addLeaf(candidate, index);
        if (index % 5 === 3) {
          addLeaf(candidate, index, 0.76 + random() * 0.1, true);
        }
      });

      // Continue the trunk's transverse wave field through the structural
      // branches. These bundles stay shorter and narrower as they travel away
      // from the centre, so they connect the trunk to the canopy without
      // competing with the leaf silhouettes.
      const limbAnchors = [];
      const limbTarget = mode === "wallpaper" ? 168 : 132;
      const limbSpacing = (mode === "wallpaper" ? 5.2 : 6.2) / sampleSize;
      branchCandidates
        .filter(
          (candidate) =>
            candidate.y > 0.08 &&
            candidate.y < 0.565 &&
            candidate.outwardness < 0.82 &&
            candidate.coherence > 0.34,
        )
        .sort(
          (first, second) =>
            first.outwardness * 0.72 + first.seedNoise * 0.28 -
            (second.outwardness * 0.72 + second.seedNoise * 0.28),
        )
        .forEach((candidate) => {
          if (limbAnchors.length >= limbTarget) {
            return;
          }
          if (
            limbAnchors.every(
              (anchor) =>
                Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) >= limbSpacing,
            )
          ) {
            limbAnchors.push(candidate);
          }
        });

      const limbParents = [];
      limbAnchors.forEach((candidate, anchorIndex) => {
        const normalX = -candidate.ny;
        const normalY = candidate.nx;
        const veinCenter = snapToVein(candidate.sampleX, candidate.sampleY, 3);
        const crossSection = findVeinCrossSection(
          veinCenter.x,
          veinCenter.y,
          normalX,
          normalY,
        );
        const taper = Math.max(0.16, 1 - candidate.outwardness / 0.9);
        const insideDistance = 0.62 + taper * 0.28;

        [-1, 1].forEach((side, sideIndex) => {
          const edgeDistance = side < 0 ? crossSection.negative : crossSection.positive;
          const attachedEdgeDistance = Math.max(0, edgeDistance - insideDistance);
          const edgeOffset = side * attachedEdgeDistance;
          const strandCount = taper > 0.52 ? 5 : 4;
          const centerStrand = (strandCount - 1) / 2;
          limbParents.push({
            x: (veinCenter.x + normalX * edgeOffset) / sampleSize,
            y: (veinCenter.y + normalY * edgeOffset) / sampleSize,
            nx: normalX * side,
            ny: normalY * side,
            qx: candidate.nx,
            qy: candidate.ny,
            length: 0.0085 + taper * 0.008 + random() * 0.004,
            phase: candidate.outwardness * TAU * 1.7 + sideIndex * 0.15,
            speed: TAU / 4.15,
            width: 0.27 + taper * 0.13 + random() * 0.05,
            color: anchorIndex % 5 === 0 ? 0 : 1,
            strength: 0.92,
            alpha: 0.7 + taper * 0.24,
            strandCount,
            strandGap: 0.00031 + random() * 0.00013,
            strandLengths: Array.from({ length: strandCount }, (_, strandIndex) => {
              const distanceFromCenter = Math.abs(strandIndex - centerStrand) / Math.max(1, centerStrand);
              return 0.84 + (1 - distanceFromCenter) * 0.14 + random() * 0.025;
            }),
            inset: (0.16 + random() * 0.1) / sampleSize,
            density: 0.84,
            row: Math.round(candidate.outwardness * 120),
            sideIndex,
            taper,
            kind: "limb",
          });
        });
      });

      const trunkParents = [];
      const trunkRowCount = mode === "wallpaper" ? 68 : 58;
      for (let row = 0; row < trunkRowCount; row += 1) {
        const targetY = Math.round(
          sampleSize * (0.435 + (row / Math.max(1, trunkRowCount - 1)) * 0.265) +
            (random() - 0.5) * 0.9,
        );
        let trunkX = Math.round(sampleSize * 0.5);
        let trunkY = targetY;
        let trunkAlpha = -1;
        let trunkOffset = Number.POSITIVE_INFINITY;
        for (let y = targetY - 2; y <= targetY + 2; y += 1) {
          for (let x = Math.round(sampleSize * 0.465); x <= Math.round(sampleSize * 0.535); x += 1) {
            const alpha = veinAlphaAt(x, y);
            const offset = Math.abs(x - sampleSize * 0.5) + Math.abs(y - targetY);
            if (alpha > trunkAlpha || (alpha === trunkAlpha && offset < trunkOffset)) {
              trunkAlpha = alpha;
              trunkX = x;
              trunkY = y;
              trunkOffset = offset;
            }
          }
        }
        if (trunkAlpha < 20) {
          continue;
        }

        // The central Cassel trunk is intentionally close to vertical. Keeping
        // this normal horizontal makes its energy feathers read as perpendicular
        // even near the two large branch junctions where PCA becomes ambiguous.
        const normalX = 1;
        const normalY = 0;
        const crossSection = findVeinCrossSection(trunkX, trunkY, normalX, normalY);
        [-1, 1].forEach((side, sideIndex) => {
          const edgeDistance = side < 0 ? crossSection.negative : crossSection.positive;
          const edgeStep = Math.max(0, edgeDistance - (0.62 + random() * 0.2));
          const directionX = normalX * side;
          const directionY = normalY * side;
          trunkParents.push({
            x: (trunkX + directionX * edgeStep) / sampleSize,
            y: (trunkY + directionY * edgeStep) / sampleSize,
            nx: directionX,
            ny: directionY,
            qx: 0,
            qy: 1,
            length: 0.012 + random() * 0.016,
            bend: 0,
            phase: row * 0.42 + sideIndex * 0.16,
            speed: TAU / 3.8,
            width: 0.37 + random() * 0.15,
            color: Math.floor(random() * 2),
            strength: 1,
            alpha: 0.94 + random() * 0.06,
            strandCount: 7,
            strandGap: 0.00034 + random() * 0.00014,
            strandSpread: 0,
            strandLengths: Array.from({ length: 7 }, (_, strandIndex) => {
              const distanceFromCenter = Math.abs(strandIndex - 3) / 3;
              return 0.84 + (1 - distanceFromCenter) * 0.16 + random() * 0.035;
            }),
            inset: (0.16 + random() * 0.1) / sampleSize,
            sway: 0,
            density: 0.9,
            mint: row % 11 === 4 && sideIndex === 0,
            row,
            sideIndex,
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
      fillParents.forEach(prepareStrandDirections);

      const backgroundFillParents = fillParents.filter((_, index) => index % 8 === 0);
      const backgroundCanopyParents = canopyParents.filter((_, index) => index % 6 === 0);
      [...backgroundFillParents, ...backgroundCanopyParents].forEach((radiator) => {
        radiator.alpha *= 0.42;
        radiator.width *= 0.78;
        radiator.strandCount = Math.min(3, radiator.strandCount);
      });

      radiators.length = 0;
      radiators.push(
        ...backgroundFillParents,
        ...backgroundCanopyParents,
        ...limbParents,
        ...leafParents,
        ...trunkParents,
      );
      mobileRadiators.length = 0;
      const mobileBackgroundParents = [
        ...backgroundFillParents.filter((_, index) => index % 2 === 0),
        ...backgroundCanopyParents.filter((_, index) => index % 2 === 0),
      ];
      const mobileLeafParents = leafParents.filter((_, index) => index % 2 === 0);
      const mobileLimbParents = limbParents.filter(
        (_, index) => Math.floor(index / 2) % 3 !== 2,
      );
      const mobileTrunkParents = trunkParents.filter(
        (_, index) => Math.floor(index / 2) % 2 === 0,
      );
      mobileRadiators.push(
        ...mobileBackgroundParents,
        ...mobileLimbParents,
        ...mobileLeafParents,
        ...mobileTrunkParents,
      );
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
      halo.addColorStop(0, `rgba(76, 150, 255, ${0.042 * pulse})`);
      halo.addColorStop(0.34, `rgba(54, 86, 255, ${0.026 * pulse})`);
      halo.addColorStop(0.7, "rgba(91, 45, 210, 0.012)");
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
      mist.addColorStop(0, "rgba(55, 237, 255, 0.024)");
      mist.addColorStop(0.48, "rgba(45, 116, 255, 0.014)");
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

        if (radiator.kind === "leaf") {
          const palette = AURORA_PALETTES[radiator.color];
          const pulse = 0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase);
          const maximumLeafPixels = mobile ? 22 : mode === "wallpaper" ? 36 : 31;
          const length =
            Math.min(tree.size * radiator.length, maximumLeafPixels) * (0.94 + pulse * 0.08);
          const halfWidth =
            Math.min(tree.size * radiator.halfWidth, length * 0.42) * (0.95 + pulse * 0.08);
          const baseSpan = Math.min(tree.size * radiator.baseSpan, length * 0.09);
          const curve = tree.size * radiator.curve;
          const originX = tree.x + tree.size * radiator.x;
          const originY = tree.y + tree.size * radiator.y;
          const tipX = originX + radiator.nx * length + radiator.px * curve;
          const tipY = originY + radiator.ny * length + radiator.py * curve;
          const sharedWave = Math.sin(seconds * radiator.speed + radiator.phase) * halfWidth * 0.065;
          const trailingWave =
            Math.sin(seconds * radiator.speed + radiator.phase + 0.68) *
            halfWidth *
            0.047;
          const fiberStep = mobile ? 2 : 1;

          const leafGradient = radianceContext.createLinearGradient(
            originX,
            originY,
            tipX,
            tipY,
          );
          leafGradient.addColorStop(0, "rgba(255, 253, 244, 0.99)");
          leafGradient.addColorStop(0.07, "rgba(248, 253, 255, 0.98)");
          leafGradient.addColorStop(0.24, "rgba(168, 246, 255, 0.94)");
          leafGradient.addColorStop(
            0.54,
            `rgba(${palette.middle[0]}, ${palette.middle[1]}, ${palette.middle[2]}, 0.9)`,
          );
          leafGradient.addColorStop(
            0.77,
            `rgba(${palette.outer[0]}, ${palette.outer[1]}, ${palette.outer[2]}, 0.68)`,
          );
          leafGradient.addColorStop(
            0.93,
            `rgba(${palette.tip[0]}, ${palette.tip[1]}, ${palette.tip[2]}, 0.34)`,
          );
          leafGradient.addColorStop(
            1,
            `rgba(${palette.tip[0]}, ${palette.tip[1]}, ${palette.tip[2]}, 0)`,
          );

          const appendLeafFiber = (fiber) => {
            let offset = radiator.fiberOffsets[fiber];
            if (offset < 0) {
              offset *= radiator.asymmetry;
            }
            const rootShift = radiator.rootJitters[fiber] * length;
            const startX =
              originX + radiator.tx * (offset * baseSpan + rootShift);
            const startY =
              originY + radiator.ty * (offset * baseSpan + rootShift);
            const controlOneAcross = offset * halfWidth * 0.98 + sharedWave;
            const controlTwoAcross =
              offset * halfWidth * 0.56 + curve * 0.82 + trailingWave;
            const controlOneX =
              originX + radiator.nx * length * 0.28 + radiator.px * controlOneAcross;
            const controlOneY =
              originY + radiator.ny * length * 0.28 + radiator.py * controlOneAcross;
            const controlTwoX =
              originX + radiator.nx * length * 0.72 + radiator.px * controlTwoAcross;
            const controlTwoY =
              originY + radiator.ny * length * 0.72 + radiator.py * controlTwoAcross;
            const endAcross =
              curve +
              offset * halfWidth * 0.025 +
              radiator.tipNoises[fiber] * halfWidth;
            const endLength = length * (1 + radiator.tipLengths[fiber]);
            const endX = originX + radiator.nx * endLength + radiator.px * endAcross;
            const endY = originY + radiator.ny * endLength + radiator.py * endAcross;

            radianceContext.moveTo(startX, startY);
            radianceContext.bezierCurveTo(
              controlOneX,
              controlOneY,
              controlTwoX,
              controlTwoY,
              endX,
              endY,
            );
          };

          radianceContext.beginPath();
          for (let fiber = 0; fiber < radiator.fiberCount; fiber += fiberStep) {
            appendLeafFiber(fiber);
          }
          radianceContext.strokeStyle = leafGradient;
          radianceContext.lineWidth = radiator.width * (mobile ? 0.88 : 1);
          radianceContext.globalAlpha = radiator.alpha * (0.86 + pulse * 0.12);
          radianceContext.stroke();

          // A compact ice-white inner band gives the bundle Seed's reflective
          // centre without adding a solid blue outline around the leaf.
          radianceContext.beginPath();
          for (let fiber = 0; fiber < radiator.fiberCount; fiber += fiberStep) {
            if (Math.abs(radiator.fiberOffsets[fiber]) <= 0.28) {
              appendLeafFiber(fiber);
            }
          }
          const innerGradient = radianceContext.createLinearGradient(
            originX,
            originY,
            tipX,
            tipY,
          );
          innerGradient.addColorStop(0, "rgba(255, 255, 249, 1)");
          innerGradient.addColorStop(0.2, "rgba(224, 253, 255, 0.98)");
          innerGradient.addColorStop(0.58, "rgba(94, 224, 255, 0.72)");
          innerGradient.addColorStop(0.88, "rgba(59, 105, 255, 0.28)");
          innerGradient.addColorStop(1, "rgba(78, 53, 221, 0)");
          radianceContext.strokeStyle = innerGradient;
          radianceContext.lineWidth = (radiator.width + 0.08) * (mobile ? 0.88 : 1);
          const leafFlicker =
            0.5 + 0.5 * Math.sin(seconds * 2.2 + radiator.phase * 1.43);
          radianceContext.globalAlpha = 0.68 + pulse * 0.08 + leafFlicker * 0.13;
          radianceContext.stroke();

          const leafShimmerProgress =
            (seconds * 0.32 + radiator.phase / TAU) % 1;
          const leafShimmerCenter = 0.17 + leafShimmerProgress * 0.66;
          const leafShimmer = radianceContext.createLinearGradient(
            originX,
            originY,
            tipX,
            tipY,
          );
          leafShimmer.addColorStop(0, "rgba(255, 255, 255, 0)");
          leafShimmer.addColorStop(
            leafShimmerCenter - 0.14,
            "rgba(228, 247, 255, 0)",
          );
          leafShimmer.addColorStop(
            leafShimmerCenter - 0.035,
            "rgba(240, 252, 255, 0.24)",
          );
          leafShimmer.addColorStop(
            leafShimmerCenter,
            "rgba(255, 255, 255, 0.96)",
          );
          leafShimmer.addColorStop(
            leafShimmerCenter + 0.04,
            "rgba(255, 247, 225, 0.36)",
          );
          leafShimmer.addColorStop(
            leafShimmerCenter + 0.14,
            "rgba(205, 231, 255, 0)",
          );
          leafShimmer.addColorStop(1, "rgba(205, 231, 255, 0)");
          radianceContext.strokeStyle = leafShimmer;
          radianceContext.lineWidth =
            Math.max(0.2, radiator.width * (mobile ? 0.45 : 0.54));
          radianceContext.globalAlpha = 0.7 + leafFlicker * 0.2;
          radianceContext.stroke();
          continue;
        }

        if (radiator.kind === "trunk" || radiator.kind === "limb") {
          const isLimb = radiator.kind === "limb";
          const strandCenter = (radiator.strandCount - 1) / 2;
          const originX =
            tree.x + tree.size * radiator.x - radiator.nx * tree.size * radiator.inset;
          const originY =
            tree.y + tree.size * radiator.y - radiator.ny * tree.size * radiator.inset;
          const pulse = 0.5 + 0.5 * Math.sin(seconds * (TAU / 6) + radiator.phase * 0.12);
          const maximumWavePixels = isLimb ? (mobile ? 11 : 15) : mobile ? 17 : 22;
          const centerLength = Math.min(tree.size * radiator.length, maximumWavePixels);
          const gradientEndX = originX + radiator.nx * centerLength;
          const gradientEndY = originY + radiator.ny * centerLength;
          const trunkGradient = radianceContext.createLinearGradient(
            originX,
            originY,
            gradientEndX,
            gradientEndY,
          );
          trunkGradient.addColorStop(0, "rgba(255, 255, 250, 1)");
          trunkGradient.addColorStop(0.08, "rgba(255, 255, 255, 1)");
          trunkGradient.addColorStop(0.22, "rgba(255, 239, 199, 1)");
          trunkGradient.addColorStop(0.4, "rgba(224, 202, 162, 0.98)");
          trunkGradient.addColorStop(0.62, "rgba(188, 218, 242, 0.9)");
          trunkGradient.addColorStop(0.82, "rgba(83, 151, 255, 0.58)");
          trunkGradient.addColorStop(0.93, "rgba(103, 75, 225, 0.3)");
          trunkGradient.addColorStop(1, "rgba(91, 62, 224, 0)");

          radianceContext.beginPath();
          for (let strand = 0; strand < radiator.strandCount; strand += 1) {
            const strandOffset = strand - strandCenter;
            const length =
              Math.min(
                tree.size * radiator.length * radiator.strandLengths[strand],
                maximumWavePixels,
              ) *
              (0.97 + pulse * 0.06);
            const startX = originX;
            const startY = originY;
            const strandDrift = strandOffset * tree.size * radiator.strandGap;
            const amplitude = Math.min(
              isLimb ? (mobile ? 0.72 : 1.05) : mobile ? 1.15 : 1.55,
              length *
                (isLimb ? 0.048 : 0.056) +
                length *
                  0.016 * Math.sin(radiator.row * 0.37 + radiator.sideIndex * 0.8),
            );
            const wavePoint = (unit) => {
              const envelope = Math.pow(Math.sin(Math.PI * unit), 2);
              const envelopeDerivative = Math.PI * Math.sin(TAU * unit);
              const spreadUnit = Math.min(1, unit / 0.18);
              const rootEnvelope = spreadUnit * spreadUnit * (3 - 2 * spreadUnit);
              const rootEnvelopeDerivative =
                unit < 0.18
                  ? (6 * spreadUnit - 6 * spreadUnit * spreadUnit) / 0.18
                  : 0;
              const theta =
                TAU * (0.72 * unit - seconds / 3.8) +
                radiator.phase +
                strandOffset * 0.055;
              const wave = amplitude * envelope * Math.sin(theta);
              const waveDerivative =
                amplitude *
                (envelopeDerivative * Math.sin(theta) +
                  envelope * TAU * 0.72 * Math.cos(theta));
              const transverse = wave + strandDrift * rootEnvelope;
              const transverseDerivative =
                waveDerivative + strandDrift * rootEnvelopeDerivative;
              return {
                x: startX + radiator.nx * length * unit + radiator.qx * transverse,
                y: startY + radiator.ny * length * unit + radiator.qy * transverse,
                dx: radiator.nx * length + radiator.qx * transverseDerivative,
                dy: radiator.ny * length + radiator.qy * transverseDerivative,
              };
            };
            const start = wavePoint(0);
            const middle = wavePoint(0.5);
            const end = wavePoint(1);
            const handleScale = 0.5 / 3;
            radianceContext.moveTo(start.x, start.y);
            radianceContext.bezierCurveTo(
              start.x + start.dx * handleScale,
              start.y + start.dy * handleScale,
              middle.x - middle.dx * handleScale,
              middle.y - middle.dy * handleScale,
              middle.x,
              middle.y,
            );
            radianceContext.bezierCurveTo(
              middle.x + middle.dx * handleScale,
              middle.y + middle.dy * handleScale,
              end.x - end.dx * handleScale,
              end.y - end.dy * handleScale,
              end.x,
              end.y,
            );
          }

          radianceContext.strokeStyle = trunkGradient;
          radianceContext.lineWidth =
            radiator.width + (isLimb ? (mobile ? 0.35 : 0.52) : mobile ? 0.48 : 0.68);
          radianceContext.globalAlpha = isLimb ? 0.09 : 0.12;
          radianceContext.stroke();
          const flicker =
            0.5 +
            0.5 *
              Math.sin(
                seconds * (isLimb ? 2.45 : 2.85) +
                  radiator.phase * 1.37 +
                  radiator.row * 0.11,
              );
          radianceContext.lineWidth = radiator.width * (mobile ? 0.9 : 1);
          radianceContext.globalAlpha =
            radiator.alpha *
            (isLimb
              ? 0.66 + pulse * 0.13 + flicker * 0.11
              : 0.66 + pulse * 0.1 + flicker * 0.12);
          radianceContext.stroke();

          // A narrow specular band continuously travels from the white root to
          // the cool platinum tip. Every bundle has a slightly different phase,
          // so the tree stays alive without blinking in unison.
          const shimmerProgress =
            (seconds * (isLimb ? 0.4 : 0.52) + radiator.phase / TAU) % 1;
          const shimmerCenter = 0.16 + shimmerProgress * 0.68;
          const shimmerGradient = radianceContext.createLinearGradient(
            originX,
            originY,
            gradientEndX,
            gradientEndY,
          );
          shimmerGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
          shimmerGradient.addColorStop(
            shimmerCenter - 0.14,
            "rgba(238, 249, 255, 0)",
          );
          shimmerGradient.addColorStop(
            shimmerCenter - 0.04,
            "rgba(242, 252, 255, 0.28)",
          );
          shimmerGradient.addColorStop(
            shimmerCenter,
            "rgba(255, 255, 255, 0.98)",
          );
          shimmerGradient.addColorStop(
            shimmerCenter + 0.045,
            "rgba(255, 247, 229, 0.42)",
          );
          shimmerGradient.addColorStop(
            shimmerCenter + 0.14,
            "rgba(210, 232, 255, 0)",
          );
          shimmerGradient.addColorStop(1, "rgba(210, 232, 255, 0)");
          radianceContext.strokeStyle = shimmerGradient;
          radianceContext.lineWidth =
            Math.max(0.24, radiator.width * (isLimb ? 0.54 : 0.64));
          radianceContext.globalAlpha = isLimb ? 0.72 : 0.88;
          radianceContext.stroke();
          continue;
        }

        const palette = AURORA_PALETTES[radiator.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase);
        const maxFiberPixels = mobile ? 16 : mode === "wallpaper" ? 24 : 21;
        const centerLength =
          Math.min(tree.size * radiator.length, maxFiberPixels) * (0.88 + pulse * 0.16);
        const gradientStartX =
          tree.x + tree.size * radiator.x - radiator.nx * tree.size * radiator.inset;
        const gradientStartY =
          tree.y + tree.size * radiator.y - radiator.ny * tree.size * radiator.inset;
        const gradientEndX = gradientStartX + radiator.nx * centerLength;
        const gradientEndY = gradientStartY + radiator.ny * centerLength;
        const fiberGradient = radianceContext.createLinearGradient(
          gradientStartX,
          gradientStartY,
          gradientEndX,
          gradientEndY,
        );
        const middle = radiator.mint ? [94, 245, 210] : palette.middle;
        if (radiator.coreAttached === false) {
          fiberGradient.addColorStop(0, "rgba(225, 249, 255, 0.26)");
          fiberGradient.addColorStop(0.09, "rgba(172, 241, 255, 0.68)");
          fiberGradient.addColorStop(0.22, "rgba(111, 225, 255, 0.92)");
        } else {
          fiberGradient.addColorStop(0, "rgba(255, 253, 244, 0.98)");
          fiberGradient.addColorStop(0.08, "rgba(248, 252, 255, 0.96)");
          fiberGradient.addColorStop(0.22, "rgba(190, 248, 255, 0.92)");
        }
        fiberGradient.addColorStop(
          0.46,
          `rgba(${middle[0]}, ${middle[1]}, ${middle[2]}, 0.88)`,
        );
        fiberGradient.addColorStop(
          0.7,
          `rgba(${palette.outer[0]}, ${palette.outer[1]}, ${palette.outer[2]}, 0.72)`,
        );
        fiberGradient.addColorStop(
          0.88,
          `rgba(${palette.tip[0]}, ${palette.tip[1]}, ${palette.tip[2]}, 0.48)`,
        );
        fiberGradient.addColorStop(
          1,
          `rgba(${palette.tip[0]}, ${palette.tip[1]}, ${palette.tip[2]}, 0)`,
        );

        radianceContext.beginPath();
        const strandCenter = (radiator.strandCount - 1) / 2;

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
            Math.min(
              tree.size * radiator.length * radiator.strandLengths[strand],
              maxFiberPixels,
            ) *
            (0.88 + strandPulse * 0.16);
          const sway =
            Math.sin(seconds * (TAU / 6) + radiator.phase + strandOffset * 0.34) *
            tree.size *
            radiator.sway;
          const bend = tree.size * (radiator.bend + strandOffset * 0.00035) + sway;
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

        }

        radianceContext.strokeStyle = fiberGradient;
        radianceContext.lineWidth = radiator.width * (mobile ? 0.9 : 1);
        const ambientFlicker =
          0.5 + 0.5 * Math.sin(seconds * 2.55 + radiator.phase * 1.21);
        radianceContext.globalAlpha =
          (0.38 + pulse * 0.14 + ambientFlicker * 0.1) *
          (0.8 + radiator.strength * 0.2) *
          radiator.alpha;
        radianceContext.stroke();
      }

      radianceContext.restore();
    };

    const paintVeinLayer = (seconds, tree) => {
      veinContext.clearRect(0, 0, width, height);
      veinContext.save();
      veinContext.globalCompositeOperation = "source-over";

      const breathe = 0.975 + Math.sin(seconds * (TAU / 6)) * 0.025;
      const platinum = veinContext.createLinearGradient(
        tree.x + tree.size * 0.18,
        tree.y + tree.size * 0.98,
        tree.x + tree.size * 0.82,
        tree.y + tree.size * 0.02,
      );
      platinum.addColorStop(0, "rgb(218 229 245)");
      platinum.addColorStop(0.15, "rgb(244 249 255)");
      platinum.addColorStop(0.28, "rgb(255 254 247)");
      platinum.addColorStop(0.44, "rgb(196 207 225)");
      platinum.addColorStop(0.62, "rgb(255 255 252)");
      platinum.addColorStop(0.79, "rgb(255 235 204)");
      platinum.addColorStop(1, "rgb(214 225 239)");
      veinContext.fillStyle = platinum;
      veinContext.globalAlpha = breathe;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      const trunkCenterX = tree.x + tree.size * 0.5;
      const trunkHalfWidth = Math.max(2.9, tree.size * 0.0072);
      const trunkTop = tree.y + tree.size * 0.425;
      const trunkBottom = tree.y + tree.size * 0.715;

      // The trunk's material gradient is intentionally much narrower than the
      // old broad spotlight: pure white at the centre, cool platinum at both
      // visible edges, with the original vein mask preserving its silhouette.
      veinContext.globalCompositeOperation = "source-over";
      veinContext.globalAlpha = 1;
      const trunkMaterial = veinContext.createLinearGradient(
        trunkCenterX - trunkHalfWidth,
        0,
        trunkCenterX + trunkHalfWidth,
        0,
      );
      trunkMaterial.addColorStop(0, "rgba(138, 153, 181, 1)");
      trunkMaterial.addColorStop(0.16, "rgba(177, 188, 205, 1)");
      trunkMaterial.addColorStop(0.32, "rgba(219, 211, 194, 1)");
      trunkMaterial.addColorStop(0.43, "rgba(249, 244, 232, 1)");
      trunkMaterial.addColorStop(0.5, "rgba(255, 255, 255, 1)");
      trunkMaterial.addColorStop(0.57, "rgba(250, 245, 232, 1)");
      trunkMaterial.addColorStop(0.68, "rgba(215, 207, 190, 1)");
      trunkMaterial.addColorStop(0.84, "rgba(173, 185, 204, 1)");
      trunkMaterial.addColorStop(1, "rgba(134, 150, 180, 1)");
      veinContext.fillStyle = trunkMaterial;
      veinContext.fillRect(
        trunkCenterX - trunkHalfWidth,
        trunkTop,
        trunkHalfWidth * 2,
        trunkBottom - trunkTop,
      );

      veinContext.globalCompositeOperation = "lighter";
      const persistentFlicker = Math.max(
        0.42,
        0.68 +
          Math.sin(seconds * 2.65 + 0.3) * 0.22 +
          Math.sin(seconds * 4.17 + 1.2) * 0.1,
      );
      const innerHalfWidth = Math.max(0.75, tree.size * 0.00135);
      const innerCore = veinContext.createLinearGradient(
        trunkCenterX - innerHalfWidth,
        0,
        trunkCenterX + innerHalfWidth,
        0,
      );
      innerCore.addColorStop(0, "rgba(222, 237, 255, 0)");
      innerCore.addColorStop(0.28, `rgba(246, 252, 255, ${0.42 * persistentFlicker})`);
      innerCore.addColorStop(0.5, `rgba(255, 255, 255, ${persistentFlicker})`);
      innerCore.addColorStop(0.72, `rgba(255, 249, 235, ${0.46 * persistentFlicker})`);
      innerCore.addColorStop(1, "rgba(222, 237, 255, 0)");
      veinContext.fillStyle = innerCore;
      veinContext.fillRect(
        trunkCenterX - innerHalfWidth,
        trunkTop,
        innerHalfWidth * 2,
        trunkBottom - trunkTop,
      );

      const trunkFlowProgress = (seconds % 2.85) / 2.85;
      const trunkFlowY = trunkBottom - (trunkBottom - trunkTop) * trunkFlowProgress;
      const trunkFlowRadius = Math.max(8, tree.size * 0.018);
      const trunkFlow = veinContext.createLinearGradient(
        0,
        trunkFlowY - trunkFlowRadius,
        0,
        trunkFlowY + trunkFlowRadius,
      );
      trunkFlow.addColorStop(0, "rgba(210, 230, 255, 0)");
      trunkFlow.addColorStop(0.3, "rgba(224, 242, 255, 0.18)");
      trunkFlow.addColorStop(0.46, "rgba(248, 253, 255, 0.72)");
      trunkFlow.addColorStop(0.5, "rgba(255, 255, 255, 1)");
      trunkFlow.addColorStop(0.56, "rgba(255, 244, 224, 0.54)");
      trunkFlow.addColorStop(0.76, "rgba(216, 235, 255, 0.12)");
      trunkFlow.addColorStop(1, "rgba(210, 230, 255, 0)");
      veinContext.fillStyle = trunkFlow;
      veinContext.fillRect(
        trunkCenterX - trunkHalfWidth * 1.35,
        trunkFlowY - trunkFlowRadius,
        trunkHalfWidth * 2.7,
        trunkFlowRadius * 2,
      );

      const progress = (seconds % 4.2) / 4.2;
      const energyY = tree.y + tree.size * (1.03 - progress * 1.08);
      const energy = veinContext.createLinearGradient(
        0,
        energyY - tree.size * 0.022,
        0,
        energyY + tree.size * 0.022,
      );
      energy.addColorStop(0, "rgba(214, 235, 255, 0)");
      energy.addColorStop(0.3, "rgba(214, 235, 255, 0.38)");
      energy.addColorStop(0.49, "rgba(255, 255, 255, 0.98)");
      energy.addColorStop(0.62, "rgba(255, 229, 190, 0.34)");
      energy.addColorStop(1, "rgba(255, 229, 190, 0)");
      veinContext.fillStyle = energy;
      veinContext.fillRect(
        tree.x,
        energyY - tree.size * 0.022,
        tree.size,
        tree.size * 0.044,
      );

      const sheenProgress = ((seconds + 1.35) % 5.4) / 5.4;
      const sheenX = tree.x + tree.size * (-0.05 + sheenProgress * 1.1);
      const sheen = veinContext.createLinearGradient(
        sheenX - tree.size * 0.018,
        0,
        sheenX + tree.size * 0.018,
        0,
      );
      sheen.addColorStop(0, "rgba(211, 232, 255, 0)");
      sheen.addColorStop(0.34, "rgba(211, 232, 255, 0.3)");
      sheen.addColorStop(0.49, "rgba(255, 255, 255, 0.92)");
      sheen.addColorStop(0.64, "rgba(255, 228, 189, 0.26)");
      sheen.addColorStop(1, "rgba(255, 228, 189, 0)");
      veinContext.fillStyle = sheen;
      veinContext.fillRect(
        sheenX - tree.size * 0.018,
        tree.y,
        tree.size * 0.036,
        tree.size,
      );

      const corePulse =
        0.35 + 0.65 * (0.5 + 0.5 * Math.sin(seconds * (TAU / 2.8) + 0.42));
      const coreX = tree.x + tree.size * 0.5;
      const coreY = tree.y + tree.size * 0.51;
      const core = veinContext.createRadialGradient(
        coreX,
        coreY,
        tree.size * 0.006,
        coreX,
        coreY,
        tree.size * (0.042 + corePulse * 0.015),
      );
      core.addColorStop(0, `rgba(255, 255, 255, ${0.66 + corePulse * 0.24})`);
      core.addColorStop(0.32, "rgba(255, 239, 211, 0.3)");
      core.addColorStop(1, "rgba(221, 235, 255, 0)");
      veinContext.fillStyle = core;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      veinContext.globalCompositeOperation = "destination-in";
      veinContext.globalAlpha = 1;
      veinContext.drawImage(veinMaskImage, tree.x, tree.y, tree.size, tree.size);

      // Reinforce the very thin source artwork with a narrow material spine so
      // the white-to-platinum cross-section remains visible at normal page
      // scale. It follows the already-established trunk centre and does not
      // alter any fiber attachment points.
      const spineTop = tree.y + tree.size * 0.435;
      const spineBottom = tree.y + tree.size * 0.677;
      const spineHalfWidth = Math.max(2.4, tree.size * 0.004);
      const spineGradient = veinContext.createLinearGradient(
        trunkCenterX - spineHalfWidth,
        0,
        trunkCenterX + spineHalfWidth,
        0,
      );
      spineGradient.addColorStop(0, "rgba(130, 139, 158, 0.94)");
      spineGradient.addColorStop(0.18, "rgba(170, 166, 151, 0.98)");
      spineGradient.addColorStop(0.34, "rgba(211, 180, 128, 1)");
      spineGradient.addColorStop(0.44, "rgba(250, 230, 192, 1)");
      spineGradient.addColorStop(0.49, "rgba(255, 255, 255, 1)");
      spineGradient.addColorStop(0.51, "rgba(255, 255, 255, 1)");
      spineGradient.addColorStop(0.58, "rgba(250, 229, 189, 1)");
      spineGradient.addColorStop(0.72, "rgba(207, 176, 124, 1)");
      spineGradient.addColorStop(0.86, "rgba(168, 165, 151, 0.98)");
      spineGradient.addColorStop(1, "rgba(127, 137, 157, 0.94)");
      const traceSpine = () => {
        veinContext.beginPath();
        veinContext.moveTo(trunkCenterX, spineTop);
        veinContext.bezierCurveTo(
          trunkCenterX - tree.size * 0.0008,
          tree.y + tree.size * 0.515,
          trunkCenterX + tree.size * 0.00065,
          tree.y + tree.size * 0.625,
          trunkCenterX,
          spineBottom,
        );
      };
      veinContext.globalCompositeOperation = "source-over";
      veinContext.globalAlpha = 0.58 + persistentFlicker * 0.28;
      veinContext.lineCap = "round";
      veinContext.strokeStyle = spineGradient;
      veinContext.lineWidth = spineHalfWidth * 2;
      traceSpine();
      veinContext.stroke();

      veinContext.globalCompositeOperation = "lighter";
      veinContext.strokeStyle = `rgba(255, 255, 255, ${0.16 + persistentFlicker * 0.74})`;
      veinContext.lineWidth = Math.max(0.38, tree.size * 0.00055);
      traceSpine();
      veinContext.stroke();

      const spineGlint = veinContext.createLinearGradient(
        0,
        trunkFlowY - trunkFlowRadius,
        0,
        trunkFlowY + trunkFlowRadius,
      );
      spineGlint.addColorStop(0, "rgba(221, 238, 255, 0)");
      spineGlint.addColorStop(0.34, "rgba(234, 248, 255, 0.18)");
      spineGlint.addColorStop(0.48, "rgba(255, 255, 255, 0.9)");
      spineGlint.addColorStop(0.52, "rgba(255, 255, 255, 1)");
      spineGlint.addColorStop(0.6, "rgba(255, 245, 226, 0.46)");
      spineGlint.addColorStop(1, "rgba(215, 235, 255, 0)");
      veinContext.strokeStyle = spineGlint;
      veinContext.lineWidth = Math.max(1.1, tree.size * 0.0018);
      veinContext.globalAlpha = 0.9;
      traceSpine();
      veinContext.stroke();
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
      paintVeinLayer(seconds, tree);

      context.save();
      context.globalCompositeOperation = "lighter";

      context.filter = `blur(${Math.max(width <= 720 ? 1.5 : 2, tree.size * 0.0035)}px)`;
      context.globalAlpha = width <= 720 ? 0.16 : 0.21;
      context.drawImage(radianceCanvas, 0, 0, width, height);
      context.filter = "none";
      context.globalAlpha = width <= 720 ? 0.9 : 0.98;
      context.drawImage(radianceCanvas, 0, 0, width, height);

      context.filter = `blur(${Math.max(2, tree.size * 0.0045)}px)`;
      context.globalAlpha = 0.3;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.filter = "none";
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 0.99;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.12;
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
      const desiredRadianceScale =
        width <= 720 ? Math.min(deviceScale, 1.2) : Math.min(deviceScale, 1.5);
      const radianceScale = Math.min(desiredRadianceScale, 2560 / width, 2160 / height);

      canvas.width = Math.max(1, Math.round(width * pixelScale));
      canvas.height = Math.max(1, Math.round(height * pixelScale));
      context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

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
