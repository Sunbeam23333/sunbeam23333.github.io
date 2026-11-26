(() => {
  const rail=document.getElementById('model-rail');
  if(!rail)return;
  const cards=[...rail.querySelectorAll('.model')];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  // Preserve the project's own summaries, but give the compact layout the
  // substance of each demo rather than leaving the captions as short labels.
  const captions=[
    'Seed2.1 增强了通用 Agent 的能力，能把真实的编程任务从理解需求做到交付结果。',
    '音频和视频由同一个模型生成。创作者可提供不同形式的参考素材，也可以编辑现有内容，让动作、声音和复杂场景更协调。',
    '模型把推理用于图像创作，既能让画面更符合文字描述，也能改善构图、图中文字的表现，以及成片的视觉效果。',
    '面向自然对话的全双工语音模型。即使周围还有其他声音，它也能判断用户是否已经说完，让倾听和回应顺畅地衔接。',
    '把强化学习带到真实机器人上，逐步学会需要连续多步操作的精细任务，例如拿起鞋带并将它穿过鞋孔。'
  ];
  cards.forEach((card,i)=>{
    card.style.setProperty('--gallery-index',i);
    card.target='_blank';card.rel='noopener noreferrer';
    card.querySelector('p').textContent=captions[i];
    const video=card.querySelector('video');
    // Show the native decoded first frame on each card (there is no poster).
    // 'metadata' lets the browser limit transfer; playback remains hover-only.
    if(!video.hasAttribute('src')) { video.preload='metadata';video.src=video.dataset.src; }
  });
  if(!('IntersectionObserver' in window))return;
  const appear=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){
      rail.classList.add('gallery-entered');appear.disconnect();
    }
  },{threshold:0,rootMargin:'0px 0px -50px 0px'});
  // The row starts entering when it passes the bottom 50px of the viewport.
  // Reusing the existing calibrated spring also keeps research/gallery in sync.
  if(!reduced.matches)rail.classList.add('gallery-cascade');
  appear.observe(rail);
})();
