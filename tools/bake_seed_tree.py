"""Bake the Cassel silhouette with the optical motion from a supplied Seed film.

Usage: python3 tools/bake_seed_tree.py assets/seed-leaf-reference.mp4 assets
Requires NumPy, SciPy, OpenCV, scikit-image, and ffmpeg with libx264.
The output has square pixels. The native 144-frame loop is never interpolated.
"""

import argparse
import math
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.csgraph import dijkstra
from skimage.morphology import skeletonize

N = 1280
S = 984
OX, OY = (N - S) // 2, 92
FLOOR = OY + round(S * 0.966)
TAU = 2 * math.pi
RNG = np.random.default_rng(23333)


def read_mask(assets, name):
    alpha = cv2.imread(str(assets / name), cv2.IMREAD_UNCHANGED)[:, :, 3]
    tree = cv2.resize(alpha, (S, S), interpolation=cv2.INTER_AREA)
    result = np.zeros((N, N), dtype=np.uint8)
    result[OY : OY + S, OX : OX + S] = tree
    return result


def geodesic_tree(skeleton):
    ys, xs = np.where(skeleton)
    ids = np.full(skeleton.shape, -1, dtype=np.int32)
    ids[ys, xs] = np.arange(len(xs))
    starts, ends, weights = [], [], []
    for dy, dx in [(0, 1), (1, -1), (1, 0), (1, 1)]:
        targets = ids[ys + dy, xs + dx]
        valid = targets >= 0
        starts.extend(np.nonzero(valid)[0])
        ends.extend(targets[valid])
        weights.extend([math.hypot(dx, dy)] * sum(valid))
    graph = sparse.coo_matrix(
        (weights, (starts, ends)), shape=(len(xs), len(xs))
    ).tocsr()
    root = np.argmin((xs - N / 2) ** 2 + (ys - (OY + S * 0.656)) ** 2)
    distance = dijkstra(graph, directed=False, indices=root)
    return xs, ys, distance


def choose_leaves(xs, ys, distance):
    # Estimate the local branch tangent from the geodesic on the real emblem.
    # Radius, density and spread vary with the distance from its central trunk.
    leaves = []
    used = []
    eligible = np.flatnonzero(
        np.isfinite(distance)
        & (ys < OY + S * 0.632)
        & ((abs(xs - N / 2) > S * 0.035) | (ys < OY + S * 0.40))
    )
    for spacing, length_range, count in [
        (107, (112, 172), 22),
        (61, (62, 110), 52),
        (35, (31, 63), 109),
    ]:
        accepted = 0
        for i in RNG.permutation(eligible):
            x, y = xs[i], ys[i]
            if any((x - a) ** 2 + (y - b) ** 2 < spacing**2 for a, b in used):
                continue
            near = np.flatnonzero((xs - x) ** 2 + (ys - y) ** 2 < 15**2)
            near = near[
                np.isfinite(distance[near]) & (abs(distance[near] - distance[i]) <= 21)
            ]
            if len(near) < 5:
                continue
            local = np.column_stack((xs[near] - x, ys[near] - y))
            tangent = local.T @ (distance[near] - distance[i])
            norm = np.linalg.norm(tangent)
            if norm < 5:
                continue
            tangent /= norm
            radial = np.array([x - N / 2, y - (OY + S * 0.58)], dtype=float)
            radial /= max(1, np.linalg.norm(radial))
            side = np.sign(tangent[0] * radial[1] - tangent[1] * radial[0]) or 1
            angle = math.atan2(tangent[1], tangent[0]) + side * RNG.uniform(0.22, 0.83)
            length = RNG.uniform(*length_range)
            width = length * RNG.uniform(0.28, 0.49)
            leaves.append(
                (x, y, angle, length, width, RNG.random(), RNG.random() > 0.5)
            )
            used.append((x, y))
            accepted += 1
            if accepted == count:
                break
    return leaves


def fan_mapping(leaf):
    x, y, angle, length, width, variant, mirror = leaf
    dx, dy = math.cos(angle), math.sin(angle)
    extent = math.ceil(length * 1.25)
    x0, x1 = max(0, x - extent), min(N, x + extent + 1)
    y0, y1 = max(0, y - extent), min(FLOOR, y + extent + 1)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    along = ((xx - x) * dx + (yy - y) * dy) / length
    across = (-(xx - x) * dy + (yy - y) * dx) / width
    # The source is parameterized from its luminous origin to the cap of its fan.
    # Bend the sampled section toward the tip. Source radiance supplies the
    # open middle, teal rim, blue feathering and the intermittent white burst.
    along_clipped = np.clip(along, 0, 1)
    curve = (0.28 + 0.28 * variant) * along_clipped**1.6
    transverse = (across - curve) * (-1 if mirror else 1)
    # Gather neighbouring screen pixels into the same bounding rectangle.
    # At the tip the taper brings the open fan back into a single leaf.
    taper = 1 - 0.68 * along_clipped**2
    sx = 1013 - 74 * along + 335 * transverse / taper
    sy = 787 - 719 * along - 19 * transverse
    active = (along > -0.014) & (along < 1.09) & (abs(transverse / taper) < 1.36)
    iy, ix = np.where(active)
    box = np.s_[iy.min() : iy.max() + 1, ix.min() : ix.max() + 1]
    u, v = sx[box].astype(np.float32), sy[box].astype(np.float32)
    m1, m2 = cv2.convertMaps(u, v, cv2.CV_16SC2)
    # Attenuate the maximal white origin on minor distant twigs. Retain headroom
    # so multiple filaments can intersect without clipping the entire branch.
    base = np.clip(along[box] / 0.135, 0, 1)
    weight = active[box] * ((0.55 + 0.45 * base) * (0.63 + 0.28 * variant))
    return (y0 + iy.min(), x0 + ix.min(), m1, m2, weight.astype(np.float32)[:, :, None])


def prep_skeleton(assets):
    body = read_mask(assets, "cassel-tree-mask.png")
    flow = read_mask(assets, "cassel-tree-flow-mask.png")
    skel = skeletonize(flow > 43)
    xs, ys, dist = geodesic_tree(skel)
    # All silhouette components also receive a finite spatial light phase.
    dist[~np.isfinite(dist)] = np.hypot(
        xs[~np.isfinite(dist)] - N / 2, ys[~np.isfinite(dist)] - (OY + 0.66 * S)
    )
    dd, (vy, vx) = ndimage.distance_transform_edt(~skel, return_indices=True)
    dd = dd.astype(np.float32)
    depth = np.zeros_like(dd)
    depth[ys, xs] = dist
    depth = depth[vy, vx] / S
    yy, xx = np.indices((N, N), dtype=np.float32)
    # Original emblem widths choose the thickness of the platinum/coated paths.
    original_radius = cv2.distanceTransform(
        (body > 100).astype("uint8"), cv2.DIST_L2, 5
    )
    thickness = 0.52 + np.sqrt(original_radius[vy, vx]) * 0.38
    edge = np.exp(-0.7 * (dd / thickness) ** 2)
    core = np.exp(-1.65 * (dd / thickness) ** 2)
    center = np.exp(-(((xx - N * 0.50) / (S * 0.073)) ** 2)) * np.exp(
        -(((yy - OY - S * 0.55) / (S * 0.30)) ** 2)
    )
    bloom = cv2.GaussianBlur(core, (0, 0), 5)
    tx = cv2.Sobel(cv2.GaussianBlur(depth, (0, 0), 3), cv2.CV_32F, 1, 0)
    ty = cv2.Sobel(cv2.GaussianBlur(depth, (0, 0), 3), cv2.CV_32F, 0, 1)
    side = np.clip((-(xx - vx) * ty + (yy - vy) * tx) * 20, -1, 1)
    return xs, ys, dist, dd, edge, core, center, bloom, depth, side, thickness


def render(args):
    assets = args.assets
    xs, ys, dist, dd, edge, core, center, bloom, depth, side, thickness = prep_skeleton(
        assets
    )
    leaves = choose_leaves(xs, ys, dist)
    mappings = [fan_mapping(leaf) for leaf in leaves]
    print("Curved leaf fans:", len(leaves), flush=True)
    yy, xx = np.indices((N, N), dtype=np.float32)
    in_air = yy < FLOOR + 1
    # Fine wavelets stay attached along both sides of trunk, branches and roots.
    feather_reach = 2.6 + 5.5 * (thickness - 0.48) + 7 * center
    feather = np.exp(-np.power(dd / feather_reach, 1.75)) * in_air
    phase = (
        depth * 940
        + dd * 0.09
        + np.sin(depth * 163) * 1.68
        + np.sin(depth * 462) * 0.51
        + side * 1.25
    )
    plume = (
        0.55 + 0.45 * (0.5 + 0.5 * np.sin(depth * 63 + side * 0.8)) ** 2
    ) * np.where(yy > OY + S * 0.68, 0.36, 1)
    # Raised central material extends continuously through the fork and collar.
    # The soft envelope also catches the thick portions of the adjacent limbs.
    nx, ny = (xx - N / 2) / S, (yy - OY) / S
    central = np.exp(-((nx / 0.145) ** 2 + ((ny - 0.57) / 0.14) ** 4)) * np.clip(
        (thickness - 1.04) / 1.35, 0, 1
    )
    radius = thickness * (1 + 0.61 * central) + 0.85 * central
    cross = dd / np.maximum(radius, 0.66)
    core_section = np.exp(-1.58 * cross**2)
    metal_section = np.exp(-0.75 * cross**2)
    grazed_edge = np.exp(-(((cross - 1.14) / 0.43) ** 2))
    bevel = np.exp(-(((cross - 0.78) / 0.42) ** 2))
    warm_flank = 0.5 + 0.5 * side
    micro_reach = radius * (2.65 + 0.6 * np.sin(depth * 42 + side)) + 0.8
    micro_fade = np.exp(-1.3 * (dd / micro_reach) ** 2) * (1 - 0.82 * core_section)
    micro_phase = (
        depth * 2530 + 2.3 * np.sin(depth * 281) + 1.7 * np.sin(depth * 543 + side)
    )
    flank = np.exp(-((nx / 0.13) ** 2 + ((ny - 0.58) / 0.16) ** 4))
    floor_y, floor_x = np.indices((N - FLOOR, N), dtype=np.float32)
    horizon_x = np.exp(-(((floor_x - N * 0.5) / (S * 0.36)) ** 2))
    floor_env = horizon_x * np.exp(-floor_y / 95)
    ambient = np.clip(2.0 - 0.8 * abs(xx - N / 2) / (N / 2), 0, 2)
    contact = np.exp(-(((xx - N / 2) / (S * 0.24)) ** 2)) * np.exp(
        -(((yy - FLOOR + 3) / 21) ** 2)
    )
    film = cv2.VideoCapture(str(args.film))
    if (
        int(film.get(cv2.CAP_PROP_FRAME_WIDTH)) != 1920
        or int(film.get(cv2.CAP_PROP_FRAME_HEIGHT)) != 1080
    ):
        raise ValueError("Supply the native 1920×1080 seed_campus.mp4")
    if not args.preview:
        # A preview or interrupted encode must leave the existing artwork usable.
        staging = tempfile.TemporaryDirectory(dir=assets, prefix=".tree-bake-")
        output = Path(staging.name) / "cassel-seed-optics.mp4"
        poster = output.with_suffix(".webp")
        encoder = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-pixel_format",
                "bgr24",
                "-video_size",
                f"{N}x{N}",
                "-framerate",
                "24",
                "-i",
                "-",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "15",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
                "-vf",
                "scale=out_color_matrix=bt709",
                str(output),
            ],
            stdin=subprocess.PIPE,
        )
    for k in ([args.preview_frame] if args.preview else range(144)):
        if args.preview:
            film.set(cv2.CAP_PROP_POS_FRAMES, k)
        ok, src = film.read()
        if not ok:
            raise IOError(f"Unable to read source frame {k}")
        t = k * TAU / 144
        # Remove the separate bronze stalk above the leaf; it is replaced by the
        # Cassel tree's own bronze/silver veins below, with its topology intact.
        clean = src.copy()
        # Reconstruct the fan texture behind the diagonal stem. Painting that
        # stripe black would leave a visible cut across every transferred leaf.
        zone = src[38:732, 485:1077]
        diff = zone[:, :, 2].astype(np.int16) - zone[:, :, 0]
        copper = cv2.dilate(
            (diff > 0).astype(np.uint8) * 255, np.ones((3, 5), np.uint8)
        )
        copper[zone.max(axis=2) < 7] = 0
        clean[38:732, 485:1077] = cv2.inpaint(zone, copper, 4, cv2.INPAINT_TELEA)
        paper = np.zeros((N, N, 3), np.float32)
        for y, x, m1, m2, w in mappings:
            fan = cv2.remap(clean, m1, m2, cv2.INTER_LINEAR) * w
            h, b = w.shape[:2]
            patch = paper[y : y + h, x : x + b]
            # Screen the projected layers, keeping fine lines visible where leaves meet.
            patch += fan * (1 - patch / 255)
        flash = np.clip((float(src[710:760, 977:1001].mean()) - 212) / 34, 0, 1)
        wave = 0.5 + 0.5 * np.cos(depth * 11.4 - t * 2 + 0.37 * np.sin(depth * 4 + t))
        light = 0.19 + 0.80 * (wave**2.6)
        line = (
            0.5
            + 0.5
            * np.cos(
                phase + 0.9 * np.sin(t + depth * 8) + 1.45 * np.sin(dd * 0.15 - t * 2)
            )
        ) ** 4
        ice = np.clip(dd / (thickness * 2 + 0.5), 0, 1)
        filament = feather * line * plume * (1 - core * 0.9) * (0.39 + 0.55 * light)
        shade = 0.30 + 0.45 * light + 0.31 * center + 0.09 * flash
        white = core * shade
        gold = (edge - 0.85 * core) * (0.68 + 0.4 * light)
        # Travelling glints follow geodesic distance through the branching
        # metal; neighbouring branches carry the pulse away from the collar.
        moving = np.maximum(0, np.cos(depth * 19 - t * 2 + 0.3 * np.sin(t))) ** 5
        specular = 0.43 + 0.23 * light + 0.24 * flash + 0.27 * moving
        rimlight = 0.53 + 0.34 * light + 0.23 * moving
        curl = 0.63 * dd + 0.42 * np.sin(dd * 0.5 - depth * 119 + t)
        micro = (
            0.5 + 0.5 * np.cos(micro_phase + curl * np.sin(depth * 60 - t * 2 + side))
        ) ** 2
        secondary = (
            0.5 + 0.5 * np.sin(micro_phase * 0.63 + dd * 0.41 + depth * 87 - t)
        ) ** 3
        filigree = micro_fade * (0.57 * micro + 0.35 * secondary) * (0.6 + 0.4 * light)
        # Colour channels are BGR. Keep small veins darker (depth & Fresnel);
        # the white focal values and blue/teal edge textures come from the film.
        for j, (c, g, b, h) in enumerate(
            [(247, 91, 148, 25), (248, 154, 94, 17), (250, 232, 36, 13)]
        ):
            layer = (
                white * c
                + gold * g
                + filament * ((1 - ice) * 154 + ice * b)
                + bloom * h
                + contact * (3 - j * 0.6)
            )
            # Platinum axial highlight, champagne shoulders, cool grazed edge.
            silver = (
                core_section * specular * c
                + (metal_section - core_section) * rimlight * [158, 201, 241][j]
                + grazed_edge * [46, 32, 21][j]
                + bevel
                * (warm_flank * [-26, 6, 41][j] + (1 - warm_flank) * [32, 8, -8][j])
                * rimlight
                + filigree * ((1 - ice) * [185, 216, 236][j] + ice * [110, 73, 34][j])
                + bloom * ([33, 46, 60][j] + [55, 67, 80][j] * moving)
            )
            layer = (
                layer * (1 - central)
                + silver * central
                + contact * (3 - j * 0.6) * central
            )
            # Gentle specular spill mirrors the changing source emission; it is
            # most visible on the fork and never forms an opaque blue outline.
            layer += (
                flank
                * np.exp(-0.5 * (dd / (radius * 3.4)) ** 2)
                * moving
                * (0.5 + 0.5 * flash)
                * [12, 17, 22][j]
            )
            paper[:, :, j] += layer * (1 - paper[:, :, j] / 255) + ambient
        sub = cv2.resize(paper, (N // 4, N // 4), interpolation=cv2.INTER_AREA)
        glow = cv2.resize(cv2.GaussianBlur(sub, (0, 0), 4.8), (N, N))
        paper += glow * 0.24
        stage = np.clip(paper, 0, 255).astype(np.uint8)
        # Reproject the current root light onto the plane. The native film's
        # reflection supplies the broken horizontal Fresnel bands and glints.
        fsrcx = (881 + (floor_x - N * 0.5) * 1.35).astype(np.float32)
        fsrcy = (946 + floor_y * 0.78).astype(np.float32)
        floor_tex = cv2.remap(src, fsrcx, fsrcy, cv2.INTER_LINEAR)
        ripple = np.sin(floor_y * 0.32 + 0.26 * np.sin(t)) + 0.67 * np.sin(
            floor_y * 0.77 - t
        )
        mx = floor_x + ripple * (1 + floor_y * 0.032)
        my = FLOOR - 1 - floor_y * (2.4 + 0.18 * np.sin(floor_y * 0.19))
        reflected = cv2.remap(
            stage, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR
        )
        bands = (
            0.24
            + 0.6
            * (0.5 + 0.5 * np.sin(floor_y * 0.73 + 0.5 * np.sin(floor_y * 0.25))) ** 2
        )
        near_floor = np.clip((167 - floor_y) / 44, 0, 1) * horizon_x
        floor_color = (
            reflected * (bands * floor_env * 0.49)[:, :, None]
            + floor_tex * (near_floor * 1.09)[:, :, None]
        )
        stage[FLOOR:] = np.clip(floor_color + ambient[FLOOR:, :, None], 0, 255).astype(
            np.uint8
        )
        if args.preview:
            cv2.imwrite(str(args.preview), stage)
        else:
            if k == 24:
                if not cv2.imwrite(str(poster), stage, [cv2.IMWRITE_WEBP_QUALITY, 94]):
                    raise IOError("Poster encoding failed")
            encoder.stdin.write(stage.tobytes())
            if k % 24 == 0:
                print("Frame", k, flush=True)
    film.release()
    if not args.preview:
        encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError("ffmpeg failed")
        output.replace(assets / output.name)
        poster.replace(assets / poster.name)
        staging.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("film", type=Path)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--preview", type=Path)
    parser.add_argument(
        "--preview-frame", type=int, choices=range(144), metavar="0..143", default=24
    )
    render(parser.parse_args())
