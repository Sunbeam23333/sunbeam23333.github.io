"""Build two responsive layouts of the same frame-locked optical comparison.

Both subjects are on one presentation timeline, including through loop/seek.
Run after baking a new Cassel movie: python3 tools/bake_comparison.py
"""
import json
import subprocess
import tempfile
from pathlib import Path

assets = Path(__file__).resolve().parents[1] / "assets"
inputs = [assets / name for name in ("seed-leaf-reference.mp4", "cassel-seed-optics.mp4")]


def check(path):
    probe = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,nb_frames,r_frame_rate,duration", "-of", "json", path])
    stream = json.loads(probe)["streams"][0]
    if (stream["nb_frames"], stream["r_frame_rate"], float(stream["duration"])) != ("144", "24/1", 6.0):
        raise ValueError(f"{path}: expected a native six-second, 144-frame track")
    return stream["width"], stream["height"]


if __name__ == "__main__":
    if [check(path) for path in inputs] != [(1920, 1080), (1280, 1280)]:
        raise ValueError("Film dimensions no longer match the comparison layout")
    with tempfile.TemporaryDirectory(dir=assets, prefix=".optics-pair-") as folder:
        results = []
        for slug, filters, dims in [
            ("wide", "[0:v]setsar=1[l];[1:v]scale=1080:1080:flags=lanczos,setsar=1[r];[l][r]hstack", (3000, 1080)),
            ("tall", "[0:v]scale=960:540:flags=lanczos,setsar=1[l];[1:v]scale=540:540:flags=lanczos,setsar=1,pad=960:540:210:0[r];[l][r]vstack", (960, 1080)),
        ]:
            output = Path(folder) / f"optics-pair-{slug}.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-i", inputs[0], "-i", inputs[1],
                            "-filter_complex", filters + "[out]", "-map", "[out]", "-an",
                            "-c:v", "libx264", "-preset", "medium", "-tune", "grain", "-crf", "12", "-g", "24",
                            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
                            "-color_trc", "bt709", "-movflags", "+faststart", output], check=True)
            if check(output) != dims:
                raise ValueError(f"Unexpected comparison dimensions in {output.name}")
            results.append(output)
        for output in results:
            output.replace(assets / output.name)
