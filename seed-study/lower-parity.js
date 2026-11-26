(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const tabs = $('.faq-tabs');
  if (!tabs) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const textWidth = () => document.documentElement.clientWidth;

  // The indicator is a single moving point rather than one static dot per tab.
  const dot = document.createElement('i');
  dot.className = 'faq-position';
  dot.setAttribute('aria-hidden','true');
  tabs.append(dot);
  function positionDot() {
    const tab = $('[aria-selected="true"]', tabs);
    if (tab) dot.style.transform = 'translateX('+(tab.offsetLeft+tab.offsetWidth/2)+'px) translateX(-50%)';
  }
  new MutationObserver(positionDot).observe(tabs,{subtree:true,attributes:true,attributeFilter:['aria-selected']});
  new ResizeObserver(positionDot).observe(tabs);
  document.fonts.ready.then(positionDot);
  positionDot();

  // Keep equivalent facts in our own words, with the three distinct paragraphs
  // and reading rhythm of the source rather than a short single-block summary.
  const answerText = [
    '申请 2027 届全职岗位或在校实习岗位的同学，可以从这个统一入口寻找 Seed 的大模型研究机会。今年的校招不必再另外申请过去的 Top Seed 专项。',
    '团队希望把高校研究者直接带到下一代模型尚未解决的问题面前。对一个问题有没有独立见解，能不能提出新方法并通过实验验证，比进入哪一类招聘计划更重要。通过校招加入的每一位同学，都有机会参与这些研究；团队不会再按过去的专项名称，把新同学分成不同的组别。',
    '评估关注的是一个人还有怎样的成长空间，而不只是已经积累了多少资历。年轻研究者可以从有挑战的工作起步，继续拓展自己能够负责的研究范围。'
  ].join('\n\n');
  const answers = $('#answers');
  function restoreAnswer() {
    const first = $('.answer', answers);
    if (!first) return;
    const rows=answers.querySelectorAll('summary'), body=answers.querySelectorAll('.answer');
    if ($('#graduate-tab').getAttribute('aria-selected')==='true') {
      first.textContent=answerText;
      rows[1].textContent='Seed 的大模型岗位，和字节跳动面向前沿技术方向的校招如何区分？';
      rows[2].textContent='我将在 2027 年毕业，且已经拿到字节跳动其他团队的实习 Offer，还可以申请 Seed 的应届全职研究岗位吗？';
      rows[3].textContent='申请 Seed 2027 届全职研究岗位，会经历哪些面试环节？';
      body[1].textContent='先从你希望研究的问题来选择。Seed 的入口集中于大模型：既有基座模型与系统，也有视觉、语音、搜索、个性化和机器人方面的工作。如果你的方向不在这些范围里，可以查看字节跳动前沿技术校招的职位清单，对照岗位所需的研究方向，寻找更适合自己的机会。';
      body[2].textContent='同一时间只能推进一个岗位的招聘流程。如已在其他团队面试，请先与负责该岗位的 HR 商量如何调整。';
      body[3].textContent='通常先进行三到五轮技术面试，再安排一轮与 HR 的交流。每个岗位的考察方式可能不同，最终轮数和时间请以招聘同事的通知为准。';
    } else {
      rows[1].textContent='我之前已在字节跳动申请过其他团队的实习机会，现在想加入 Seed 的研究项目，还能再申请这里的实习岗位吗？';
      rows[2].textContent='如果在 Seed 申请研究实习没有通过，还可以报名字节跳动的其他实习岗位吗？';
      body[0].textContent='有机会。团队会参考同学的毕业时间和实习期间的工作表现，安排转正评估，并从中择优发出录用邀请。';
      body[1].textContent='可以申请，不过招聘团队会先推进更早投递的实习岗位。如果先前的面试流程已经结束，HR 可以再联系你参加 Seed 这边的实习面试。';
      body[2].textContent='可以。只要这次研究实习的面试流程已经确认结束，就不影响你继续申请字节跳动的其他实习职位。';
    }
  }
  new MutationObserver(restoreAnswer).observe(answers,{childList:true});
  restoreAnswer();

  const stories = [
    '刚从学校毕业加入团队，C 同学就开始研究 Seedance 2.0 的预训练架构，并探索模型和数据规模扩大时，哪些训练算法仍然有效。',
    '实习期间，Y 同学参与 Seed1.8 与 Seed2.0 的研发。研究的重点是用强化学习把不同专家各自擅长的能力汇集到一个基座模型中，同时保持训练的效率和稳定性。',
    'Z 同学毕业后参与了端到端同声传译模型的研发。后训练之初，能直接用于学习的数据很少；团队把数据准备、模型训练和评测串起来，让结果反过来指导下一轮训练。这项工作同时关注译文是否准确、听众要等待多久，以及译声能否保留说话人的音色。',
    '在实习中，R 同学关注模型推理和强化学习时模拟环境带来的高成本。研究成果进入系统领域的国际会议，也走出了实验环境，应用在豆包的在线服务以及 Seed 大模型的后训练中。'
  ];
  document.querySelectorAll('.voice p').forEach((el,i)=>{el.textContent=stories[i];});
  const benefits=[
    '和团队一起研究 Seed 基座与 GenMedia 生成模型，探索下一代 AI 系统。',
    '研发平台提供算力、数据和工程支持，让你能把时间用在实验设计和技术攻关上。',
    '研究不仅停留在实验室。你可以把算法带到企业和个人使用的产品里，验证技术能否解决实际问题。',
    '除了薪酬，也有面向符合条件的毕业生与实习生的长期激励机会。技术贡献可以随着团队业务的发展获得进一步回报。'
  ];
  document.querySelectorAll('.benefit-grid p').forEach((el,i)=>{el.textContent=benefits[i];});

  // Grazing light is strongest where the pointer meets the capsule's edge.
  // Its *direction* uses screen-space coordinates; falloff uses normalized axes.
  const mail=$('.email');
  const glow=document.createElement('i');
  glow.className='email-edge'; glow.setAttribute('aria-hidden','true'); mail.append(glow);
  const clearLight=()=>{mail.style.setProperty('--edge-line','0');mail.style.setProperty('--edge-light','0');};
  mail.addEventListener('pointermove',e=>{
    if (e.pointerType==='touch'||reduced.matches) return;
    const box=mail.getBoundingClientRect(),x=e.clientX-box.left-box.width/2,y=e.clientY-box.top-box.height/2;
    const proximity=Math.min(1,Math.max(Math.abs(x)/(box.width/2),Math.abs(y)/(box.height/2)));
    const intensity=Math.max(0,(proximity-.2)/.8);
    mail.style.setProperty('--edge-angle',(90+Math.atan2(y,x)*180/Math.PI)+'deg');
    mail.style.setProperty('--edge-line',String(intensity));
    mail.style.setProperty('--edge-light',String(proximity));
  });
  mail.addEventListener('pointerleave',clearLight);
  reduced.addEventListener('change',clearLight);

  const brand=$('.footer-brand'),logo=$('img',brand),top=document.createElement('button');
  top.className='return-top';top.type='button';top.setAttribute('aria-label','返回顶部');
  logo.replaceWith(top);top.append(logo);
  top.addEventListener('click',()=>window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'}));
  const groups=[...document.querySelectorAll('.footer-links')];
  groups.forEach((group,i)=>{
    const region=document.createElement('div'),links=document.createElement('div');
    region.className='foot-disclosure';region.id='foot-disclosure-'+i;
    links.className='foot-items';
    for(const n of [...group.children]) if(n.tagName!=='H3') links.append(n);
    region.append(links);group.append(region);
    $('button',group).setAttribute('aria-controls',region.id);
    const setInert=()=>{region.inert=textWidth()<1280&&!group.classList.contains('expanded');};
    new MutationObserver(setInert).observe(group,{attributes:true,attributeFilter:['class']});
    setInert();
  });
})();
