"""Compare the decoded wood and protected leaf colours of two Cassel films.

    python3 tools/check_branch_palette.py old.mp4 new.mp4 [--max-leaf-mae 2]

RGB values are in display/code space (0..255), not linear radiance. Each RGB
triple is the temporal median of per-frame spatial medians. MAE and p95 use
all sampled pixel-frames instead, so changes cannot cancel across a region.
Regions describe the actual 1280px Cassel emblem; this is not a universal
colour matching score or a comparison between unrelated tree shapes.
"""

import argparse
from contextlib import ExitStack
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt
from skimage.morphology import skeletonize

from bake_seed_tree import N, OY, S, geodesic_tree, read_mask


def sites(assets):
    """Geometry-only QA sites: use exactly the same locations in both films."""
    skel = skeletonize(read_mask(assets, "cassel-tree-flow-mask.png") > 43)
    xs, ys, distance = geodesic_tree(skel)
    tx, ty = (xs - N / 2) / S, (ys - OY) / S
    # Same convention as the renderer on disconnected ornament strokes.
    depth = np.where(np.isfinite(distance), distance / S,
                     np.hypot(tx, ty - .66))
    radius = cv2.distanceTransform(
        (read_mask(assets, "cassel-tree-mask.png") > 100).astype("uint8"),
        cv2.DIST_L2, 5)
    thickness = .52 + .38 * np.sqrt(radius[ys, xs])
    bands = {
        "trunk": (xs == 639) & (ys >= 610) & (ys <= 715),
        "fork": (abs(tx) < .1) & (ty > .46) & (ty < .52),
        "inner_branches": ((abs(tx) >= .08) & (abs(tx) <= .20) &
                           (ty > .34) & (ty < .52) & (thickness > 1.4)),
        "distal_branches": ((abs(tx) > .22) & (ty > .12) & (ty < .53) &
                            (depth > .48)),
    }
    wood = {key: (ys[mask], xs[mask]) for key, mask in bands.items()}
    if any(not len(coords[0]) for coords in wood.values()):
        raise ValueError("Missing wood samples: the masks no longer match the QA geometry")

    # One isolated leaf at lower left, plus a repeatable broad control grid
    # across the canopy. Keep both at least 18px away from wood and its halo.
    far = distance_transform_edt(~skel) >= 18
    yy, xx = np.where(far)
    broad = (yy < OY + S * .68) & (xx % 4 == 0) & (yy % 4 == 0)
    roi = (xx >= 100) & (xx < 190) & (yy >= 660) & (yy < 740)
    leaves = {"off_wood_crown": (yy[broad], xx[broad]),
              "isolated_left_leaf": (yy[roi], xx[roi])}
    return wood, leaves


class Summary:
    def __init__(self):
        self.medians = []
        self.channel_sum = np.zeros(3, dtype=np.float64)
        self.hist = np.zeros(256, dtype=np.int64)

    def add(self, before, after):
        if not len(before):
            raise ValueError("No visible samples in a diagnostic region")
        self.medians.append([np.median(before, axis=0), np.median(after, axis=0)])
        delta = np.abs(after.astype(np.int16) - before)
        self.channel_sum += delta.sum(axis=0)
        self.hist += np.bincount(delta.max(axis=1), minlength=256)

    def result(self):
        before, after = np.median(self.medians, axis=0)
        count = int(self.hist.sum())
        p95 = int(np.searchsorted(np.cumsum(self.hist), int(np.ceil(.95 * count))))
        return dict(pixel_frames=count, old_rgb=before.tolist(), new_rgb=after.tolist(),
                    delta_rgb=(after - before).tolist(),
                    rgb_mae_255=float(self.channel_sum.sum() / (3 * count)),
                    p95_max_channel_delta_255=p95)


def compare(before, after, assets):
    wood, leaves = sites(assets)
    coords = {**wood, **leaves}
    metrics = {key: Summary() for key in coords}
    frames = 0
    with ExitStack() as stack:
        movies = []
        for path in (before, after):
            movie = cv2.VideoCapture(str(path))
            stack.callback(movie.release)
            size = tuple(int(movie.get(p)) for p in
                         (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT))
            if not movie.isOpened() or size != (N, N) or abs(movie.get(cv2.CAP_PROP_FPS) - 24) > .01:
                raise ValueError(f"{path}: expected a decodable {N}x{N} 24fps Cassel render")
            movies.append(movie)
        while True:
            (ok_old, old), (ok_new, new) = [movie.read() for movie in movies]
            if not (ok_old and ok_new):
                if ok_old != ok_new or frames != 144:
                    raise ValueError(f"Expected two aligned 144-frame films; decoded {frames} pairs")
                break
            for key, (y, x) in coords.items():
                a, b = old[y, x, ::-1], new[y, x, ::-1]
                if key in leaves:
                    # Select lit/coloured leaf pixels using the baseline ONLY;
                    # if the candidate removes/recolours them it is still scored.
                    mask = a.max(axis=1) >= 40
                    a, b = a[mask], b[mask]
                metrics[key].add(a, b)
            frames += 1
    return {"old": str(before), "new": str(after), "frames": frames,
            "regions": {key: value.result() for key, value in metrics.items()}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--assets", type=Path, default=Path(__file__).resolve().parents[1] / "assets")
    parser.add_argument("--max-leaf-mae", type=float,
                        help="Optional RGB MAE ceiling for each protected leaf region (0..255)")
    args = parser.parse_args()
    if args.max_leaf_mae is not None and not 0 <= args.max_leaf_mae <= 255:
        parser.error("--max-leaf-mae must be in [0, 255]")
    report = compare(args.old, args.new, args.assets)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.max_leaf_mae is not None:
        for key in ("off_wood_crown", "isolated_left_leaf"):
            if report["regions"][key]["rgb_mae_255"] > args.max_leaf_mae:
                raise SystemExit(f"{key}: decoded leaf MAE exceeded {args.max_leaf_mae}")
