#!/usr/bin/env python3
"""Extract the central Cassel tree emblem as a transparent alpha mask."""

from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageFilter
from skimage.morphology import skeletonize


def smoothstep(edge_low: float, edge_high: float, values: np.ndarray) -> np.ndarray:
    scaled = np.clip((values - edge_low) / (edge_high - edge_low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def save_alpha_mask(alpha: Image.Image, destination: Path) -> None:
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    destination.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(destination, optimize=True)


def variable_width_skeleton(
    skeleton: np.ndarray,
    distance: np.ndarray,
    scale: float,
    maximum_radius: int,
) -> np.ndarray:
    target_radius = np.clip(distance * scale, 1.0, float(maximum_radius))
    rendered = np.zeros(skeleton.shape, dtype=np.uint8)

    for radius in range(1, maximum_radius + 1):
        centers = (skeleton > 0) & (target_radius >= radius - 0.45)
        if not np.any(centers):
            continue
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
        rendered = np.maximum(rendered, cv2.dilate(centers.astype(np.uint8), kernel))

    return rendered


def main() -> None:
    if len(sys.argv) not in (3, 5):
        raise SystemExit(
            "usage: extract_cassel_tree_mask.py SOURCE_JPEG OUTPUT_PNG "
            "[FLOW_MASK_PNG VEIN_MASK_PNG]"
        )

    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)

    if image is None:
        raise SystemExit(f"unable to read {source}")

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32)
    height, width = rgb.shape[:2]
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luminance = red * 0.299 + green * 0.587 + blue * 0.114

    # The emblem is warm ivory on dark green. A soft luminance ramp retains the
    # JPEG antialiasing, while the radial gate excludes the surrounding rings
    # and lettering without cutting the outer leaves or roots.
    alpha = smoothstep(102.0, 181.0, luminance)
    warm_gate = smoothstep(-22.0, 8.0, red - blue)
    alpha *= 0.72 + warm_gate * 0.28

    center_x = (width - 1) / 2
    center_y = (height - 1) / 2
    yy, xx = np.ogrid[:height, :width]
    radius = np.sqrt((xx - center_x) ** 2 + (yy - center_y) ** 2)
    radial_gate = 1.0 - smoothstep(142.0, 149.0, radius)
    alpha *= radial_gate

    alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)

    # Remove isolated JPEG flecks while keeping detached leaves from the crest.
    binary = (alpha_u8 > 22).astype(np.uint8)
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    keep = np.zeros_like(binary)
    for component in range(1, component_count):
        if stats[component, cv2.CC_STAT_AREA] >= 7:
            keep[labels == component] = 1
    alpha_u8 = (alpha_u8 * keep).astype(np.uint8)

    points = cv2.findNonZero((alpha_u8 > 8).astype(np.uint8))
    if points is None:
        raise SystemExit("tree mask extraction produced no foreground")

    x, y, crop_width, crop_height = cv2.boundingRect(points)
    margin = 10
    x0 = max(0, x - margin)
    y0 = max(0, y - margin)
    x1 = min(width, x + crop_width + margin)
    y1 = min(height, y + crop_height + margin)
    cropped_alpha = alpha_u8[y0:y1, x0:x1]

    size = max(cropped_alpha.shape)
    square = np.zeros((size, size), dtype=np.uint8)
    top = (size - cropped_alpha.shape[0]) // 2
    left = (size - cropped_alpha.shape[1]) // 2
    square[top : top + cropped_alpha.shape[0], left : left + cropped_alpha.shape[1]] = cropped_alpha

    mask = Image.fromarray(square).resize((1024, 1024), Image.Resampling.LANCZOS)
    mask = mask.filter(ImageFilter.GaussianBlur(0.28))
    save_alpha_mask(mask, destination)

    print(
        f"saved {destination} from bbox=({x0},{y0})-({x1},{y1}); "
        f"components={component_count - 1}; kept_pixels={int(np.count_nonzero(alpha_u8))}"
    )

    if len(sys.argv) == 5:
        flow_destination = Path(sys.argv[3])
        vein_destination = Path(sys.argv[4])
        # Build the line assets at their native 2K delivery size. Skeletonising the
        # 1K mask and enlarging it afterwards preserves tiny staircase artefacts;
        # upsampling the antialiased alpha first gives the centreline more samples
        # to follow and produces noticeably smoother outer twigs and root loops.
        refined_mask = mask.resize((2048, 2048), Image.Resampling.LANCZOS)
        refined_alpha = np.array(refined_mask, dtype=np.uint8)
        refined_alpha = cv2.GaussianBlur(refined_alpha, (0, 0), 1.35)
        refined_binary = (refined_alpha > 86).astype(np.uint8)
        skeleton = skeletonize(refined_binary > 0).astype(np.uint8)
        distance = cv2.distanceTransform(refined_binary, cv2.DIST_L2, 5)

        flow_binary = variable_width_skeleton(skeleton, distance, scale=0.24, maximum_radius=18)
        flow_alpha = cv2.GaussianBlur(flow_binary * 255, (0, 0), 1.15)

        refined_components, refined_labels, refined_stats, _ = cv2.connectedComponentsWithStats(
            refined_binary,
            8,
        )
        largest_component = 1 + int(np.argmax(refined_stats[1:, cv2.CC_STAT_AREA]))
        gold_region = refined_labels == largest_component
        for component in range(1, refined_components):
            component_y = refined_stats[component, cv2.CC_STAT_TOP]
            component_area = refined_stats[component, cv2.CC_STAT_AREA]
            if component_y > refined_binary.shape[0] * 0.7 and component_area >= 320:
                gold_region |= refined_labels == component

        vein_skeleton = skeleton * gold_region.astype(np.uint8)
        vein_binary = variable_width_skeleton(
            vein_skeleton,
            distance,
            scale=0.055,
            maximum_radius=6,
        )
        vein_alpha = cv2.GaussianBlur(vein_binary * 255, (0, 0), 0.68)

        flow_mask = Image.fromarray(flow_alpha)
        vein_mask = Image.fromarray(vein_alpha)
        save_alpha_mask(flow_mask, flow_destination)
        save_alpha_mask(vein_mask, vein_destination)

        print(
            f"saved {flow_destination} and {vein_destination}; "
            f"skeleton_pixels={int(np.count_nonzero(skeleton))}; "
            f"vein_pixels={int(np.count_nonzero(vein_binary))}"
        )


if __name__ == "__main__":
    main()
