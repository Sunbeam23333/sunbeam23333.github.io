"""Compare the visible central stalk in encoded Seed and Cassel films.

Supply the reference movie first, followed by one or more Cassel renders.
This is a local material check, not a whole-image or whole-site fidelity score.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.interpolate import PchipInterpolator


def sample(film, xs, ys):
    reader = cv2.VideoCapture(str(film))
    observations = []
    try:
        if abs(reader.get(cv2.CAP_PROP_FPS) - 24) > .01:
            raise ValueError(f"{film}: expected native 24 fps")
        while True:
            ok, frame = reader.read()
            if not ok:
                break
            observations.append(frame[ys, xs])
    finally:
        reader.release()
    if len(observations) != 144:
        raise ValueError(f"{film}: expected 144 frames, found {len(observations)}")
    return np.asarray(observations, dtype=np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("trees", type=Path, nargs="+")
    args = parser.parse_args()
    # Six fixed cross sections from the branch fork to the root junction.
    # Sample both sides, from the axial crest into the two metallic shoulders.
    ty = np.array([610, 628, 652, 675, 695, 715])
    offsets = np.array([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8])
    sy = np.interp(ty, [601, 615, 632, 652, 675, 696, 715],
                   [795, 810, 827, 847, 870, 886, 900])
    stalk = PchipInterpolator([400, 500, 580, 640, 700, 750, 780, 810, 835, 860, 890, 920, 933],
                              [835, 916, 964, 987, 997, 1002, 1001, 990, 978, 955, 918, 855, 805])
    width = np.interp(sy, [795, 835, 860, 890, 920], [14.5, 13, 11, 9, 5.5])
    slope = stalk.derivative()(sy)[:, None]
    dx = width[:, None] * offsets / (6 * np.hypot(1, slope))
    reference = sample(args.reference, np.rint(stalk(sy)[:, None] + dx).astype(int),
                       np.rint(sy[:, None] - slope * dx).astype(int))
    for film in args.trees:
        delta = np.abs(sample(film, 639 + offsets[None, :], ty[:, None]) - reference)
        print(json.dumps(dict(film=film.name, frames=len(delta), profiles=len(ty),
                              samples_per_profile=len(offsets), rgb_mae_255=float(delta.mean()),
                              axial_rgb_mae_255=float(delta[:, :, 0].mean()))))


if __name__ == "__main__":
    main()
