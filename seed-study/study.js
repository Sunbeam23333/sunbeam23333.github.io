const official = 'https://seed.bytedance.com/zh/';
const artwork = 'assets/';
const films = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (selector) => document.querySelector(selector);
function sizeCanvas() {
  const width = document.documentElement.clientWidth;
  // The source scales a 1920-unit canvas from 1024px, while its tablet styles extend to 1279px.
  const designWidth = width < 767 ? 375 : width < 1024 ? 768 : 1920;
  document.documentElement.style.setProperty('--scale', width / designWidth);
  const headerScale = width < 1024 ? width/designWidth : Math.min(1,width/1350);
  const headerGutter = width < 767 ? 16 : width < 1024 ? 44 : width * 110 / 1920 / headerScale;
  document.documentElement.style.setProperty('--header-scale',headerScale);
  document.documentElement.style.setProperty('--header-gutter',headerGutter+'px');
  document.documentElement.style.setProperty('--header-top',(width < 1280 ? Math.min(44,Math.max(20,width*0.0573)) : 40)+'px');
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas, { passive: true });

const menuItems = [
  ['首页', ''], ['模型', 'models'], ['博客&论文', 'research'], ['Seed Edge', 'seed-edge'], ['加入我们', 'career']
];
function links(items) {
  return items.map(([name, path]) => '<a href="' + official + path + '">' + name + '</a>').join('');
}
$('.desktop-nav').innerHTML = links(menuItems);
$('.mobile-nav').innerHTML = links(menuItems) + '<details open><summary>开始体验</summary><a href="https://www.doubao.com/chat/">体验豆包</a><a href="https://exp.volcengine.com/">AI 体验中心</a></details>';
function setMenu(open) {
  $('.mobile-nav').hidden = !open;
  $('.menu-toggle').setAttribute('aria-expanded', String(open));
  $('.menu-toggle').setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  document.body.classList.toggle('menu-open',open);
}
$('.menu-toggle').addEventListener('click', () => setMenu($('.mobile-nav').hidden));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('.mobile-nav').hidden) { setMenu(false); $('.menu-toggle').focus(); }
    $('.experience').open = false;
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.top')) setMenu(false);
  if (!event.target.closest('.experience')) $('.experience').open = false;
});
for (const a of document.querySelectorAll('[data-job]')) {
  const intern = a.dataset.job === 'intern';
  const both = a.classList.contains('apply-shortcut');
  const params = new URLSearchParams({
    keywords:'', category:'', location:'', project:both ? '7621018151002507573,7621018569480046853' : intern ? '7621018569480046853' : '7621018151002507573',
    type:'', job_hot_flag:'', current:'1', limit:'10', functionCategory:'', tag:'', spread:both ? 'CYTY853' : intern ? '36PG96D' : 'DWA3PQP'
  });
  a.href = 'https://jobs.toutiao.com/campus/position?' + params;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
}

const traits = [
  ['有极强的技术信仰和高远目标','愿意投身难题，在长期研究中不断挑战智能的边界。','looking-for-icon-1.0961253b.png'],
  ['具备出色的研究和实践能力','在大模型的某个方向有扎实积累，能够亲手验证自己的判断，拿出有价值的工作。','looking-for-icon-3.73fb2df6.png'],
  ['极具好奇心和自驱力','愿意追问问题背后的原因，主动试验，为解决难题投入时间。','looking-for-icon-4.54f0858f.png'],
  ['心态开放，乐于协同','把系统、算法与工程的不同视角连接起来，与伙伴共同完成复杂研究。','looking-for-icon-2.832d45df.png']
];
$('#traits').innerHTML =
  '<img loading="lazy" class="ellipse" src="' + artwork + 'outer-ellipse.3223a9ba.png" alt="">' +
  '<img loading="lazy" class="ellipse inner" src="' + artwork + 'inner-ellipse.d3f8b4c3.png" alt="">' +
  traits.map(([title,body,img],i) => `<article class="trait trait-${i+1} reveal"><img loading="lazy" src="${artwork+img}" alt=""><div><h3>${title}</h3><p>${body}</p></div></article>`).join('');
const fields = [
  ['基础大模型','1.c3761f73.png',['高效模型架构与训练方法','语言模型数据压缩','代码智能体与测试时扩展','长周期任务','多智能体强化学习','强化学习的规模化','面向数学发现的 AI','低延迟实时交互','统一多模态模型','高效模型蒸馏','内在奖励与主动探索','记忆、推理与自监督学习']],
  ['视觉智能','2.dbfaf62c.png',['构建多模态数据基础设施','图像与视频模型评估','多模态预训练','高效通用的视觉表征','融合视觉理解与生成','长链路多模态智能体','工具使用与环境交互']],
  ['语音智能','3.16de1c64.png',['统一多模态语音理解和生成','个性化语音与在线学习','音频模型强化学习与语音智能体','音频理解、生成与音乐创作']],
  ['机器学习系统','4.a7dc52ae.png',['集群规模化训练的稳定性、利用率与容错','多模态强化学习的端到端系统设计','推理计算、访存与异构调度','面向新硬件的模型与并行策略','算子编译和通信优化']],
  ['大模型应用','5.4de9f6e2.png',['搜索内容理解','基于 LLM 的通用检索','训练搜索智能体','提高常见任务准确率','模型记忆机制','个性化大模型','对话情商与语言风格','用户反馈学习']],
  ['具身智能','6.22c4494d.png',['机器人通用操作模型','机器人数据与学习算法','机器人强化学习']]
];
$('#research-rail').innerHTML = fields.map(([title,img,items]) =>
  `<article class="field" style="background-image:url('${artwork+img}')"><h3>${title}</h3><ul>${items.map(item=>'<li>'+item+'</li>').join('')}</ul></article>`
).join('');
const benefits = [
  ['参与最具挑战性的\nAI 前沿工作','研究 Seed 基座与 GenMedia 模型，探索下一代智能系统。','ai-pioneer-icon.73ef1c9f.png'],
  ['获得充分的\n研发资源保障','使用成熟的 AI 基础设施和研发平台，把精力放在实验和技术突破上。','research-resources-icon.16e29800.png'],
  ['为亿万用户\n创造真实价值','将研究推进到面向个人与企业的应用，让技术成果服务真实用户。','user-value-icon.6569326e.png'],
  ['收获匹配\n技术贡献的回报','通过有竞争力的回报和长期激励，与团队共同成长。','huge-return-icon.3c47353a.png']
];
$('#benefit-grid').innerHTML = benefits.map(([title,body,img]) =>
  `<article class="reveal"><img loading="lazy" src="${artwork+img}" alt=""><h3>${title}</h3><p>${body}</p></article>`
).join('');
const models = [
  ['Seed2.1','seed2_1','seed2.1/seed2.1_earlycareer.mp4','加强通用智能体的能力，让编码模型可以独立完成更多端到端任务。'],
  ['Seedance 2.0','seedance2_0','user-upload/3bnsnmlj1laf2.mp4','用统一的音视频生成模型支持多模态参考、复杂场景创作与编辑。'],
  ['Seedream 5.0 Pro','seedream5_0_pro','latest_model/seedream5pro.mov','结合推理与图像创作，提升文字渲染、画面质量和提示词匹配度。'],
  ['Seeduplex','seeduplex','topseed/Seeduplex-zh.mp4','原生全双工语音交互，让模型在复杂声音环境中也能听准、判停并接话。'],
  ['Seed GR-RL','gr_rl','user-upload/47w9oml4wm4km.mp4','通过真机强化学习处理长周期灵巧操作，从视觉语言动作模型走向穿鞋带等精细任务。']
];
$('#model-rail').innerHTML = models.map(([title,path,video,body])=>
  `<a class="model" href="${official+path}" draggable="false"><figure><video playsinline muted loop preload="none" data-src="${films+video}" aria-hidden="true"></video></figure><h3>${title}<span aria-hidden="true">↗</span></h3><p>${body}</p></a>`
).join('');
const voices = [
  ['C','C.e69440e3.jpg','C 同学在入职后的第一年参与 Seedance 2.0 的预训练架构研究，探索扩大模型规模时更有效的训练方法。'],
  ['Y','Y.c177a9d5.jpg','Y 同学在实习期间参与 Seed1.8 和 Seed2.0，以强化学习帮助基座模型获得更全面的推理能力。'],
  ['Z','Z.f3d26551.jpg','Z 同学参与端到端同声传译模型的后训练，建立数据、训练与评测流程，改善翻译质量、延迟与音色保真度。'],
  ['R','R.4959b621.jpg','R 同学围绕强化学习系统的模拟与成本开展研究，工作发表于系统领域会议，并应用于线上业务和模型后训练。']
];
$('#voices').innerHTML = voices.map(([name,img,body]) =>
  `<article class="voice reveal"><div class="person"><img loading="lazy" src="${artwork+img}" alt="">${name} 同学</div><p>${body}</p></article>`
).join('');
const graduateQuestions = [
  ['Seed 大模型人才校招与此前的 Top Seed 招聘专项是什么关系？','面向 2027 届毕业生和在校实习生的大模型岗位，现统一纳入 Seed 大模型人才校招。\n\n从理论研究到系统与应用，项目持续寻找能够深入探索、尝试新方法的同学。团队重视研究潜力，希望给年轻研究者充分的成长空间。'],
  ['它和字节跳动前沿技术领域人才校招有什么区别？','本项目聚焦 Seed 的大模型方向，覆盖基础模型、视觉、语音、系统、应用与具身智能。其他前沿技术岗位可在字节跳动校招官网查看。'],
  ['已获得其他团队实习 Offer，还能投递应届生岗位吗？','同一时间只能处于一个岗位流程中。如需调整，请与当前负责招聘的 HR 联系。'],
  ['2027 届校招的面试如何安排？','通常包含三至五轮技术交流及一轮 HR 面试。轮次和安排会随岗位与候选人的实际情况调整。']
];
const internQuestions = [
  ['Seed 大模型人才校招实习生招聘是否提供转正机会？','团队将结合毕业时间与实习表现安排转正评估，择优提供转正机会。'],
  ['已经投递了其他实习岗位，还可以申请 Seed 的实习生岗位吗？','可以。较早投递的实习岗位优先处理。如果之前的流程结束，HR 可能会邀请你参加 Seed 岗位的流程。'],
  ['Seed 实习岗位面试未通过，还能投递其他实习项目吗？','本次实习面试流程确认结束后，可以正常申请字节跳动的其他实习岗位。']
];
function setQuestions(intern) {
  const questions = intern ? internQuestions : graduateQuestions;
  const tabs = [$('#graduate-tab'),$('#intern-tab')];
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===Number(intern)));tab.tabIndex=i===Number(intern)?0:-1;});
  $('#answers').setAttribute('aria-labelledby',tabs[Number(intern)].id);
  $('#answers').innerHTML=questions.map(([q,a],i)=>`<details name="seed-faq"${i===0?' open':''}><summary>${q}</summary><p class="answer">${a}</p></details>`).join('');
}
for(const [i,tab] of [$('#graduate-tab'),$('#intern-tab')].entries()){
  tab.addEventListener('click',()=>setQuestions(Boolean(i)));
  tab.addEventListener('keydown',event=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
    event.preventDefault();
    const intern=event.key==='End'||(event.key!=='Home'&&!i);
    setQuestions(intern);$(intern?'#intern-tab':'#graduate-tab').focus();
  });
}
setQuestions(false);
$('#footer-models').innerHTML=links([['Seed2.1','seed2_1'],['Seedance 2.5','seedance2_5'],['Seedream 5.5','seedream5_5'],['SeedRealtime','SeedRealtime'],['Seed Audio 1.0','seedaudio1_0'],['Seed GR-RL','gr_rl']]);
const compactFooter=matchMedia('(max-width:1279px)');
const footGroups=[...document.querySelectorAll('.footer-links')];
function setFooterGroup(active) {
  footGroups.forEach((group,i)=>{
    const shown=!compactFooter.matches||i===active;
    group.classList.toggle('expanded',shown);
    group.querySelector('button').setAttribute('aria-expanded',String(shown));
    group.querySelector('button').disabled=!compactFooter.matches;
  });
}
footGroups.forEach((group,i)=>{
  const heading=group.querySelector('h3'),button=document.createElement('button');
  button.type='button';button.textContent=heading.textContent;heading.replaceChildren(button);
  button.onclick=()=>setFooterGroup(group.classList.contains('expanded')?-1:i);
});
setFooterGroup(0);compactFooter.addEventListener('change',()=>{setFooterGroup(0);setMenu(false);});

for(const arrows of document.querySelectorAll('.arrows')){
  const rail=document.getElementById(arrows.dataset.rail);
  arrows.innerHTML='<button type="button" aria-label="上一项"><i></i></button><button type="button" aria-label="下一项"><i></i></button>';
  const [previous,next]=arrows.querySelectorAll('button');
  const refresh=()=>{previous.disabled=rail.scrollLeft<2;next.disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-2;};
  const step=direction=>rail.scrollBy({left:direction*(rail.children[1].offsetLeft-rail.children[0].offsetLeft),behavior:reduced.matches?'instant':'smooth'});
  previous.onclick=()=>step(-1);next.onclick=()=>step(1);
  rail.addEventListener('scroll',refresh,{passive:true});new ResizeObserver(refresh).observe(rail);
  let drag=null,suppressClick=false;
  rail.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='mouse'||e.button!==0||rail.scrollWidth<=rail.clientWidth)return;
    drag={x:e.clientX,offset:rail.scrollLeft};suppressClick=false;
  });
  rail.addEventListener('pointermove',e=>{
    if(!drag)return;
    const delta=(e.clientX-drag.x)/(rail.getBoundingClientRect().width/rail.offsetWidth);
    if(Math.abs(delta)>5) {rail.setPointerCapture(e.pointerId);rail.classList.add('dragging');suppressClick=true;rail.scrollLeft=drag.offset-delta;}
  });
  const stopDrag=()=>{drag=null;rail.classList.remove('dragging');};
  window.addEventListener('pointerup',stopDrag);rail.addEventListener('pointercancel',stopDrag);
  rail.addEventListener('click',e=>{if(suppressClick){e.preventDefault();suppressClick=false;}},true);
  refresh();
}
const heroFilm=$('.leaf-film');
let heroVisible=true;
function syncHero(){
  if(document.hidden||!heroVisible||reduced.matches){heroFilm.pause();if(reduced.matches&&heroFilm.readyState)heroFilm.currentTime=Math.min(1,heroFilm.duration||1);}
  else heroFilm.play().catch(()=>{});
}
new IntersectionObserver(([entry])=>{heroVisible=entry.isIntersecting;syncHero();}).observe(heroFilm);
heroFilm.addEventListener('loadedmetadata',syncHero);
reduced.addEventListener('change',syncHero);document.addEventListener('visibilitychange',syncHero);
const loadVideo=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries)if(isIntersecting){target.src=target.dataset.src;target.preload='metadata';loadVideo.unobserve(target);}
},{rootMargin:'350px'});
const autoplay=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries){
    if(!isIntersecting||reduced.matches||document.hidden)target.pause();
    else target.play().catch(()=>{});
  }
},{threshold:.25});
for(const v of document.querySelectorAll('.model video')){loadVideo.observe(v);autoplay.observe(v);}
if(!reduced.matches){
  for (const title of document.querySelectorAll('h2.reveal')) {
    title.setAttribute('aria-label',title.textContent);
    const walker=document.createTreeWalker(title,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    let index=0;
    for(const text of nodes){
      const run=document.createElement('span');run.className='heading-run';run.setAttribute('aria-hidden','true');
      for(const character of text.textContent){
        const glyph=document.createElement('span');glyph.textContent=character;
        glyph.style.setProperty('--delay',Math.min(index++*25,360)+'ms');run.append(glyph);
      }
      text.replaceWith(run);
    }
  }
  document.body.classList.add('motion');
  const reveal=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries)if(isIntersecting){target.classList.add('shown');reveal.unobserve(target);}
  },{threshold:.06});
  for(const node of document.querySelectorAll('.reveal:not(.intro p)'))reveal.observe(node);
  const introReveal=new IntersectionObserver(([entry])=>{
    if(entry.isIntersecting){entry.target.classList.add('shown');introReveal.disconnect();}
  },{threshold:.48});
  introReveal.observe($('.intro p'));
  const faqReveal=new IntersectionObserver(([entry])=>{
    if(entry.isIntersecting){entry.target.classList.add('entered');faqReveal.disconnect();}
  });
  faqReveal.observe($('.faq'));
}
const shortcut=$('.apply-shortcut');
// Keep the floating action above later sections while its empty slot measures scroll progress.
$('main').append(shortcut);
let sawApplySpace=false;
function dock(){
  const r=$('.apply-space').getBoundingClientRect();
  if(r.top<innerHeight && r.bottom>0)sawApplySpace=true;
  const nearEnd=scrollY+innerHeight>=document.documentElement.scrollHeight-400;
  shortcut.classList.toggle('floating',scrollY>0&&sawApplySpace&&r.bottom<innerHeight-50&&!nearEnd);
}
addEventListener('scroll',dock,{passive:true});dock();
