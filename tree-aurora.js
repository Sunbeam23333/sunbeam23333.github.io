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
      const gridSize = mode === "wallpaper" ? 4 : 5;
      const branchBottom = Math.round(sampleSize * 0.965);

      for (let cellY = 2; cellY < branchBottom; cellY += gridSize) {
        for (let cellX = 2; cellX < sampleSize - 2; cellX += gridSize) {
          let bestX = -1;
          let bestY = -1;
          let bestAlpha = 64;
          for (let y = cellY; y < Math.min(branchBottom, cellY + gridSize); y += 1) {
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
            nx: direction.x,
            ny: direction.y,
            strength: 0.62 + tangent.coherence * 0.38,
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

      const trunkParents = [];
      const trunkRowCount = mode === "wallpaper" ? 34 : 28;
      for (let row = 0; row < trunkRowCount; row += 1) {
        const targetY = Math.round(
          sampleSize * (0.49 + (row / Math.max(1, trunkRowCount - 1)) * 0.2) +
            (random() - 0.5) * 1.4,
        );
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
            length: 0.009 + random() * 0.019,
            bend: (random() - 0.5) * 0.004,
            phase: row * 0.52 + sideIndex * 0.24,
            speed: 0.84 + random() * 0.44,
            width: 0.27 + random() * 0.22,
            color: Math.floor(random() * 2),
            strength: 0.94,
            alpha: 0.82 + random() * 0.17,
            strandCount: 4,
            strandGap: 0.00062 + random() * 0.00028,
            strandSpread: 0.008 + random() * 0.008,
            strandLengths: [0.82, 0.93, 1.02, 0.88],
            inset: 0.001,
            sway: 0.00072,
            density: 0.9,
            mint: row % 11 === 4 && sideIndex === 0,
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
      trunkParents.forEach(prepareStrandDirections);

      radiators.length = 0;
      radiators.push(...fillParents, ...canopyParents, ...trunkParents);
      mobileRadiators.length = 0;
      const mobileClusterDepth = mode === "wallpaper" ? 7 : 6;
      const mobileCanopyParents = [];
      for (let depth = 0; depth < mobileClusterDepth; depth += 1) {
        clusterSeeds.forEach((_, clusterIndex) => {
          const member = canopyParents.filter(
            (radiator) => radiator.clusterIndex === clusterIndex,
          )[depth];
          if (member) {
            mobileCanopyParents.push(member);
          }
        });
      }
      mobileCanopyParents.push(
        ...canopyParents.filter((radiator) => radiator.density < 0.2).slice(0, 14),
      );
      const mobileFillParents = [];
      const mobileFillDepth = mode === "wallpaper" ? 6 : 5;
      for (let depth = 0; depth < mobileFillDepth; depth += 1) {
        fillClusterSeeds.forEach((_, clusterIndex) => {
          const member = fillParents.filter(
            (radiator) => radiator.fillClusterIndex === clusterIndex,
          )[depth];
          if (member) {
            mobileFillParents.push(member);
          }
        });
      }
      const mobileTrunkParents = trunkParents.filter((_, index) => index % 2 === 0);
      mobileRadiators.push(...mobileFillParents, ...mobileTrunkParents, ...mobileCanopyParents);
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
        const palette = AURORA_PALETTES[radiator.color];
        const pulse = 0.5 + 0.5 * Math.sin(seconds * radiator.speed + radiator.phase);
        const maxFiberPixels = mobile ? 20 : mode === "wallpaper" ? 34 : 28;
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
        radianceContext.globalAlpha =
          (0.6 + pulse * 0.26) * (0.8 + radiator.strength * 0.2) * radiator.alpha;
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
      platinum.addColorStop(0, "rgb(156 167 187)");
      platinum.addColorStop(0.15, "rgb(228 236 248)");
      platinum.addColorStop(0.28, "rgb(255 254 247)");
      platinum.addColorStop(0.44, "rgb(196 207 225)");
      platinum.addColorStop(0.62, "rgb(255 255 252)");
      platinum.addColorStop(0.79, "rgb(255 235 204)");
      platinum.addColorStop(1, "rgb(214 225 239)");
      veinContext.fillStyle = platinum;
      veinContext.globalAlpha = breathe;
      veinContext.fillRect(tree.x, tree.y, tree.size, tree.size);

      veinContext.globalCompositeOperation = "lighter";
      veinContext.globalAlpha = 1;
      const progress = (seconds % 6) / 6;
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

      const sheenProgress = ((seconds + 1.35) % 7.5) / 7.5;
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

      const corePulse = Math.pow(Math.max(0, Math.sin(progress * Math.PI)), 7);
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
      context.globalAlpha = 0.2;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.filter = "none";
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 0.96;
      context.drawImage(veinCanvas, 0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.22;
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
