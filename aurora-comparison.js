(() => {
  const film = document.querySelector("#optics");
  const button = document.querySelector("#play");
  const slider = document.querySelector("#phase");
  const time = document.querySelector("#time");
  const status = document.querySelector("#status");
  const compact = matchMedia("(max-width:680px)");
  const reduced = matchMedia("(prefers-reduced-motion:reduce)");
  const fps = 24, count = 144;
  let wantsPlay = !reduced.matches && !document.hidden;
  let resumeFrame = null, enabled = false, callback = 0;
  film.controls = false;

  const frameAt = seconds => Math.max(0, Math.min(count-1, Math.floor(seconds*fps + 1e-6)));
  function show(frame) {
    slider.value = String(frame);
    time.value = (frame/fps).toFixed(2) + " / 6.00 s";
    slider.setAttribute("aria-valuetext", `第 ${frame+1} 帧，共 ${count} 帧`);
  }
  function stopClock() {
    if (!callback) return;
    if (film.cancelVideoFrameCallback) film.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
    callback = 0;
  }
  function clock() {
    stopClock();
    if (film.paused) return;
    // Both panels are already part of this decoded picture. Read the *shown*
    // frame for the slider; there are no independent videos to drift at a wrap.
    if (film.requestVideoFrameCallback) callback = film.requestVideoFrameCallback((_, metadata) => {
      callback = 0; show(Math.min(count-1, Math.round(metadata.mediaTime*fps))); clock();
    });
    else callback = requestAnimationFrame(() => {callback=0; show(frameAt(film.currentTime)); clock();});
  }
  function pause() {
    wantsPlay = false; film.pause(); stopClock(); button.textContent = "播放";
  }
  function play() {
    wantsPlay = true;
    film.play().catch(error => { if (error.name !== "AbortError") pause(); });
  }
  function seek(frame) {
    show(frame); film.currentTime = (frame + .1)/fps;
  }
  function ready() {
    if (enabled || film.readyState < 2) return;
    enabled = true;
    status.hidden = true; button.disabled = slider.disabled = false;
    if (wantsPlay && !document.hidden) play();
  }
  function failed() {
    pause(); enabled=false; button.disabled = slider.disabled = true;
    status.hidden=false; status.textContent="对照影片未能载入。可通过下方链接查看原页或全屏壁纸。";
  }
  film.addEventListener("loadedmetadata", () => {
    film.parentElement.dataset.format = film.videoWidth < film.videoHeight ? "tall" : "wide";
    if (resumeFrame !== null) {seek(resumeFrame); resumeFrame=null;}
  });
  film.addEventListener("playing", () => {button.textContent="暂停"; clock();});
  film.addEventListener("loadeddata", ready);
  film.addEventListener("canplay", ready);
  film.addEventListener("error", failed);
  film.querySelector("source:last-child").addEventListener("error", failed);
  button.addEventListener("click", () => film.paused ? play() : pause());
  slider.addEventListener("input", () => {pause(); seek(Number(slider.value));});
  compact.addEventListener("change", () => {
    if (resumeFrame === null) resumeFrame=Number(slider.value);
    film.pause(); stopClock(); enabled=false; button.disabled=slider.disabled=true;
    film.load();
  });
  document.addEventListener("visibilitychange", () => {if (document.hidden) pause();});
  reduced.addEventListener("change", () => {if (reduced.matches) pause();});
  if (film.videoWidth) film.parentElement.dataset.format=film.videoWidth < film.videoHeight ? "tall" : "wide";
  show(0);
  if (film.error || film.networkState === film.NETWORK_NO_SOURCE) failed();
  else ready();
})();
