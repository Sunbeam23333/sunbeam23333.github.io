# Haopeng Jin — root GitHub Pages homepage

This repository powers https://sunbeam23333.github.io/.

It is the image-rich personal landing page, with selected paper figures and research highlights.
The complete portfolio and detailed project pages are maintained separately at:

https://sunbeam23333.github.io/Jason.Kim/

## Aurora studies

[Seed page study](https://sunbeam23333.github.io/seed-study/) · [Cassel tree wallpaper](https://sunbeam23333.github.io/tree-aurora-wallpaper.html) · [Synchronized comparison](https://sunbeam23333.github.io/aurora-comparison.html)

The reference animation, branding, and recruitment artwork are from the
[ByteDance Seed campus recruitment page](https://seed.bytedance.com/zh/seedearlycareer).
The study links to the official site for applications. The Cassel animation
maps the reference film's 144 frames onto the tree mask; the wallpaper and
homepage share one six-second loop. The crown uses 141 curved projections;
the trunk and main forks sample both sides of the film's metallic stem along
its curved normal. The Cassel finish follows the length of each branch from
pearl at the fork through champagne to darker copper at the tips. It is
confined to the wood, not applied across the blue-green leaves. The water
picks up the same frame's light.
To render it again, run
`python3 tools/bake_seed_tree.py assets/seed-leaf-reference.mp4 assets`.
To compare the encoded trunk (six cross sections, all 144 frames) with the
source, run `python3 tools/check_stalk.py assets/seed-leaf-reference.mp4 assets/cassel-seed-optics.mp4`.
To compare two renders, including their off-branch leaf colours, run
`python3 tools/check_branch_palette.py old.mp4 assets/cassel-seed-optics.mp4`.

After replacing either movie, run `python3 tools/bake_comparison.py` as well.
It encodes one six-second video per layout (side by side on large screens,
stacked on phones). Both panels in a decoded picture are always from the same
source frame; playback, scrubbing and looping need no JavaScript clock correction.
