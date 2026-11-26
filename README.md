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
its curved normal. The water picks up the same frame's light.
To render it again, run
`python3 tools/bake_seed_tree.py assets/seed-leaf-reference.mp4 assets`.
To compare the encoded trunk (six cross sections, all 144 frames) with the
source, run `python3 tools/check_stalk.py assets/seed-leaf-reference.mp4 assets/cassel-seed-optics.mp4`.
