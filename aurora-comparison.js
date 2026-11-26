(() => {
  const tree = document.querySelector("#tree");
  const leaf = document.querySelector("#leaf");
  const clips = [tree, leaf];
  const button = document.querySelector("#play");
  const slider = document.querySelector("#phase");
  const time = document.querySelector("#time");
  const status = document.querySelector("#status");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const fps = 24;
  const frames = 144;
  let running = false;
  let initialized = false;
  let raf = 0;

  function showFrame(frame) {
    slider.value = String(frame);
    time.value = (frame / fps).toFixed(2) + " / 6.00 s";
  }

  function pause() {
    running = false;
    cancelAnimationFrame(raf);
    clips.forEach(video => video.pause());
    button.textContent = "播放";
  }

  function follow() {
    if (!running) return;
    const phase = tree.currentTime;
    showFrame(Math.min(frames - 1, Math.floor(phase * fps)));
    // The source has a short audio tail beyond its 144 video frames.
    if (!leaf.seeking && Math.abs(leaf.currentTime - phase) > 1.5 / fps) leaf.currentTime = phase;
    raf = requestAnimationFrame(follow);
  }

  async function play() {
    if (running) return;
    leaf.currentTime = tree.currentTime;
    running = true;
    button.textContent = "暂停";
    try {
      await Promise.all(clips.map(video => video.play()));
      if (running) follow();
    } catch {
      pause();
    }
  }

  function ready() {
    if (initialized || clips.some(video => video.readyState < 2)) return;
    initialized = true;
    status.hidden = true;
    button.disabled = slider.disabled = false;
    if (!reducedMotion.matches && !document.hidden) play();
  }

  function failed() {
    pause();
    button.disabled = slider.disabled = true;
    status.textContent = "有一段动画暂时无法载入。可通过下方链接分别查看原页面。";
    status.hidden = false;
  }
  clips.forEach(video => {
    video.addEventListener("loadeddata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("error", failed);
    video.querySelector("source").addEventListener("error", failed);
  });
  button.addEventListener("click", () => running ? pause() : play());
  slider.addEventListener("input", () => {
    pause();
    const frame = Number(slider.value);
    clips.forEach(video => { video.currentTime = (frame + 0.1) / fps; });
    showFrame(frame);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) pause(); });
  ready();
})();
