const CATEGORY = {
  concert: { label: "🎤 演唱会 / 音乐节 / 追星", short: "🎤 演出" },
  food:    { label: "🍗 美食节 / 市集 / 快闪", short: "🍗 市集" },
  season:  { label: "🌸 花期 / 枫叶 / 季节限定", short: "🌸 季节" },
  art:     { label: "🎨 展览 / 电影节 / 艺术节", short: "🎨 艺术" },
  sport:   { label: "🏃 体育赛事 / 城市大型活动", short: "🏃 城市" }
};

let allEvents = [];
let meta = {};
let cityAccess = {};
let activeCategories = new Set(Object.keys(CATEGORY));
let cursor = new Date();
cursor.setDate(1);

const $ = (s) => document.querySelector(s);
const fmt = (d) => new Intl.DateTimeFormat("zh-CN",{month:"long",year:"numeric"}).format(d);
const iso = d => d.toISOString().slice(0,10);
const esc = s => (s || "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const normalize = s => (s||"").toLowerCase().replace(/\s+/g," ");
const daysInclusive = (start,end) => Math.max(1,Math.round((new Date(end)-new Date(start))/86400000)+1);

function fallbackOps(e){
  let score=0;const reasons=[];const access=cityAccess[e.city];const text=normalize([e.title,e.titleOriginal,e.tags?.join(" ")].join(" "));const duration=daysInclusive(e.startDate,e.endDate||e.startDate);
  if(access?.chinaDirect){score+=2;reasons.push("中国直飞城市")}
  if(e.category==="concert" && /(팬미팅|팬콘|월드투어|world tour|festival|페스티벌|콘서트|concert|뮤직|rock)/i.test(text)){score+=2;reasons.push("追星/音乐节信号")} else if(e.category==="concert"){score+=1;reasons.push("演出事件")}
  if(duration>=2){score+=1;reasons.push(`持续${duration}天`)}
  if(/국제|세계|international|비엔날레|biennale|영화제|festival|페스티벌|박람회|expo/i.test(text)){score+=1;reasons.push("国际/大型节庆")}
  if(e.sourceType==="ticket" || /ticket|interpark|melon|yes24/i.test(e.sourceName||"")){score+=1;reasons.push("主流票务平台")}
  if(e.category==="food" || e.category==="season"){score+=1;reasons.push("旅行场景强")}
  if(e.isNew){score+=1;reasons.push("近期新增")}
  return {score,hot:score>=4,reasons:[...new Set(reasons)].slice(0,4),accessNote:access?.note||""};
}

async function load() {
  const [ev, mt, access] = await Promise.all([
    fetch("./data/events.json").then(r=>r.json()),
    fetch("./data/meta.json").then(r=>r.json()),
    fetch("./data/city_access.json").then(r=>r.json()).catch(()=>({}))
  ]);
  cityAccess=access;
  allEvents=(ev.events||[]).map(e=>({...e,ops:e.ops||fallbackOps(e)}));
  meta=mt;
  cursor=new Date();cursor.setDate(1);
  setupFilters();render();
}

function setupFilters(){
  const cat=$("#categoryFilters");cat.innerHTML="";
  for(const [key,val] of Object.entries(CATEGORY)){
    const b=document.createElement("button");b.className="chip active";b.dataset.cat=key;b.textContent=val.label;
    b.onclick=()=>{if(activeCategories.has(key)){activeCategories.delete(key);b.classList.remove("active")}else{activeCategories.add(key);b.classList.add("active")}render()};cat.appendChild(b);
  }
  const cities=[...new Set(allEvents.map(x=>x.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-CN"));
  $("#cityFilter").innerHTML=`<option value="ALL">所有城市</option>`+cities.map(c=>`<option>${esc(c)}</option>`).join("");
  ["#searchInput","#cityFilter","#newOnly","#hotOnly","#sortMode"].forEach(id=>$(id).addEventListener(id==="#searchInput"?"input":"change",render));
  $("#prevMonth").onclick=()=>{cursor.setMonth(cursor.getMonth()-1);render()};
  $("#nextMonth").onclick=()=>{cursor.setMonth(cursor.getMonth()+1);render()};
  $("#lastUpdated").textContent=meta.updatedAt?new Date(meta.updatedAt).toLocaleString("zh-CN",{hour12:false}):"未知";
  $("#legend").innerHTML=Object.values(CATEGORY).map(v=>`<span>${v.short}</span>`).join("");
  $("#hotSummary").textContent=`🔥 ${meta.hotCount ?? allEvents.filter(x=>x.ops?.hot).length} 个高潜活动`;
}

function filtered(){
  const q=normalize($("#searchInput")?.value||"");const city=$("#cityFilter")?.value||"ALL";const newOnly=$("#newOnly")?.checked;const hotOnly=$("#hotOnly")?.checked;const sort=$("#sortMode")?.value||"date";
  const items=allEvents.filter(e=>{
    if(!activeCategories.has(e.category)) return false;
    if(city!=="ALL"&&e.city!==city) return false;
    if(newOnly&&!e.isNew) return false;
    if(hotOnly&&!e.ops?.hot) return false;
    if(q){const hay=normalize([e.title,e.titleOriginal,e.city,e.venue,e.address,e.sourceName,e.tags?.join(" "),e.ops?.reasons?.join(" ")].join(" "));if(!hay.includes(q)) return false}
    return true;
  });
  if(sort==="potential") return items.sort((a,b)=>(b.ops?.score||0)-(a.ops?.score||0)||a.startDate.localeCompare(b.startDate));
  return items.sort((a,b)=>a.startDate.localeCompare(b.startDate)||(b.ops?.score||0)-(a.ops?.score||0)||a.title.localeCompare(b.title));
}

function render(){
  $("#monthTitle").textContent=fmt(cursor);const items=filtered();renderCalendar(items);renderList(items);
}

function renderCalendar(items){
  const grid=$("#calendarGrid");grid.innerHTML="";const y=cursor.getFullYear(),m=cursor.getMonth();const first=new Date(y,m,1);const mondayIndex=(first.getDay()+6)%7;const start=new Date(y,m,1-mondayIndex);const today=iso(new Date());
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const dIso=iso(d);const cell=document.createElement("div");cell.className="day"+(d.getMonth()!==m?" outside":"")+(dIso===today?" today":"");
    const n=document.createElement("div");n.className="day-number";n.textContent=d.getDate();cell.appendChild(n);const wrap=document.createElement("div");wrap.className="day-events";
    const dayEvents=items.filter(e=>e.startDate<=dIso&&(e.endDate||e.startDate)>=dIso).sort((a,b)=>(b.ops?.score||0)-(a.ops?.score||0));
    dayEvents.slice(0,4).forEach(e=>{const el=document.createElement("div");el.className=`day-event ${e.category}${e.ops?.hot?" hot":""}`;el.textContent=`${e.ops?.hot?"🔥 ":""}${e.title}`;el.title=`${e.title} · 运营潜力 ${e.ops?.score||0}分`;el.onclick=()=>scrollToEvent(e.id);wrap.appendChild(el)});
    if(dayEvents.length>4){const more=document.createElement("div");more.className="more";more.textContent=`+${dayEvents.length-4} 个`;wrap.appendChild(more)}cell.appendChild(wrap);grid.appendChild(cell);
  }
}

function renderList(items){
  $("#eventCount").textContent=items.length;const list=$("#eventList");list.innerHTML="";if(!items.length){list.innerHTML=`<div class="empty">当前筛选条件下没有活动</div>`;return}
  const tpl=$("#eventCardTemplate");items.forEach(e=>{
    const node=tpl.content.cloneNode(true);const card=node.querySelector(".event-card");card.id=`event-${e.id}`;if(e.ops?.hot) card.classList.add("hot-card");
    const pill=node.querySelector(".category-pill");pill.classList.add(e.category);pill.textContent=CATEGORY[e.category]?.label||e.category;
    const nb=node.querySelector(".new-badge");if(!e.isNew)nb.classList.add("hidden");
    const hb=node.querySelector(".hot-badge");if(e.ops?.hot){hb.textContent=`🔥 值得做 · ${e.ops.score}分`}else{hb.textContent=`潜力 ${e.ops?.score||0}分`;hb.classList.add("muted-hot")}
    node.querySelector(".event-title").textContent=e.title;
    node.querySelector(".event-date").textContent=`🗓 ${e.startDate}${e.endDate&&e.endDate!==e.startDate?" → "+e.endDate:""}`;
    node.querySelector(".event-city").textContent=`📍 ${e.city}${e.venue?" · "+e.venue:""}`;
    node.querySelector(".event-address").textContent=`⌂ ${e.address||e.venue||"地址待更新"}`;
    node.querySelector(".event-source").textContent=`来源：${e.sourceName||"未知"}`;
    const reasons=node.querySelector(".ops-reasons");reasons.innerHTML=(e.ops?.reasons||[]).map(r=>`<span>${esc(r)}</span>`).join("");
    if(e.ops?.accessNote){const tip=document.createElement("div");tip.className="access-note";tip.textContent=e.ops.accessNote;reasons.after(tip)}
    const sl=node.querySelector(".source-link");sl.href=e.sourceUrl;sl.textContent=`查看原始信息 ↗`;
    const ml=node.querySelector(".map-link");ml.href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address||`${e.venue||e.title} ${e.city} Korea`)}`;
    list.appendChild(node);
  });
}

function scrollToEvent(id){document.getElementById(`event-${id}`)?.scrollIntoView({behavior:"smooth",block:"center"})}
load().catch(err=>{console.error(err);document.body.insertAdjacentHTML("beforeend",`<div class="empty">数据加载失败。请通过网页服务器打开本项目（例如 GitHub Pages / npx vite）。</div>`)});
