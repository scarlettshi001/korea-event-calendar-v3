import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const DATA="./data/events.json";
const META="./data/meta.json";
const ACCESS_DATA="./data/city_access.json";
const VERIFIED_DATA="./data/verified_events.json";
const NOW=new Date();
const TODAY=NOW.toISOString().slice(0,10);
const cityAccess=JSON.parse(await fs.readFile(ACCESS_DATA,"utf8"));
const verifiedSeed=JSON.parse(await fs.readFile(VERIFIED_DATA,"utf8")).events||[];

const sources=[
  // 城市官方 / 文旅
  {name:"Visit Busan",city:"釜山",url:"https://www.visitbusan.net/schedule/list.do?boardId=BBS_0000009&menuCd=DOM_000000204012000000",sourceType:"tour"},
  {name:"釜山国际电影节 BIFF",city:"釜山",url:"https://biff.kr/kor/",sourceType:"official",kind:"biff"},
  {name:"光州旅游",city:"光州",url:"https://tour.gwangju.go.kr/home/tour/culture/calendar.cs?m=315",sourceType:"tour"},
  {name:"光州艺术殿堂",city:"光州",url:"https://gjart.gwangju.go.kr/",sourceType:"culture"},
  {name:"清州市活动日历",city:"清州",url:"https://schedule.cheongju.go.kr/",sourceType:"tour"},
  {name:"大田市活动日历",city:"大田",url:"https://www.daejeon.go.kr/fvu/FvuEventDayScheduleList.do",sourceType:"tour"},
  {name:"蔚山市活动入口",city:"蔚山",url:"https://ulsan.go.kr/y/yes/main.do",sourceType:"tour"},

  // 票务：重点补演唱会 / 音乐节 / 粉丝见面会
  {name:"NOL Ticket 区域演出",city:null,url:"https://ticket.interpark.com/tiki/Special/TPRegionMain.asp",sourceType:"ticket"},
  {name:"NOL Ticket 演唱会",city:null,url:"https://ticket.interpark.com/TPGoodsList.asp?Ca=Liv&Sort=",sourceType:"ticket"},
  {name:"YES24 Ticket 地区演出",city:null,url:"https://ticket.yes24.com/New/Recommend/Area.aspx",sourceType:"ticket"},
  {name:"Melon Ticket 地区演出",city:null,url:"https://ticket.melon.com/region/index.htm",sourceType:"ticket",softFail:true},
  {name:"Ticketlink 开票公告",city:null,url:"https://www.ticketlink.co.kr/help/notice",sourceType:"ticket",kind:"ticketlinkIndex",softFail:true},

  // 文化财团：重点补地方节庆 / 展览 / 艺术活动；会自动发现官网链接的 Instagram
  {name:"釜山文化财团",city:"釜山",url:"https://www.bscf.or.kr/main.do",sourceType:"culture",discoverInstagram:true},
  {name:"大邱文化艺术振兴院",city:"大邱",url:"https://dgfca.or.kr/",sourceType:"culture",discoverInstagram:true},
  {name:"光州文化财团",city:"光州",url:"https://www.gjcf.or.kr/cf/index.do",sourceType:"culture",discoverInstagram:true},
  {name:"忠北文化财团（清州）",city:"清州",url:"https://www.cbfc.or.kr/home/main.php",sourceType:"culture",discoverInstagram:true},
  {name:"大田文化财团",city:"大田",url:"https://dcaf.or.kr/web/index.do",sourceType:"culture",discoverInstagram:true},
  {name:"蔚山文化观光财团",city:"蔚山",url:"https://uctf.or.kr/",sourceType:"culture",discoverInstagram:true},
  {name:"庆南文化艺术振兴院",city:null,url:"https://www.gcaf.or.kr/",sourceType:"culture",discoverInstagram:true},

  // 购物：重点补 O.Y SALE、免税店折扣季与大型购物促销
  {name:"Olive Young 韩国官方",city:"韩国多地",url:"https://www.oliveyoung.co.kr/store/main/getEventList.do",sourceType:"shopping",softFail:true},
  {name:"乐天免税店",city:"韩国多地",url:"https://kor.lottedfs.com/",sourceType:"shopping",softFail:true},
  {name:"新罗免税店",city:"韩国多地",url:"https://www.shilladfs.com/estore/kr/ko",sourceType:"shopping",softFail:true},

  // 社媒：小红书与 Instagram 都用 soft-fail，失败不会影响其他来源
  {name:"韩国旅游发展局 · 小红书",city:null,url:"https://www.xiaohongshu.com/user/profile/62a2e4f1000000001b027b63",kind:"xiaohongshu",sourceType:"social",softFail:true}
];

const activeTicketCities=[
  ["釜山","부산"],["大邱","대구"],["光州","광주"],["大田","대전"],["蔚山","울산"],
  ["清州","청주"],["水原","수원"],["全州","전주"],["庆州","경주"],["昌原","창원"],["浦项","포항"],
  ["丽水","여수"],["江陵","강릉"],["春川","춘천"],["天安","천안"],["世宗","세종"],["金海","김해"]
];
for(const [city,ko] of activeTicketCities){
  sources.push({name:`NOL Ticket · ${city}`,city,url:`https://tickets.interpark.com/contents/search?keyword=${encodeURIComponent(ko)}`,sourceType:"ticket",kind:"ticketSearch",softFail:true});
  sources.push({name:`Melon Ticket · ${city}`,city,url:`https://ticket.melon.com/search/index.htm?q=${encodeURIComponent(ko)}`,sourceType:"ticket",kind:"ticketSearch",softFail:true});
}

const cityMap=[
  ["부산","釜山"],["대구","大邱"],["인천","仁川"],["광주","光州"],["대전","大田"],["울산","蔚山"],
  ["청주","清州"],["수원","水原"],["전주","全州"],["여수","丽水"],["경주","庆州"],["강릉","江陵"],
  ["춘천","春川"],["김해","金海"],["포항","浦项"],["창원","昌原"],["익산","益山"],["군산","群山"],
  ["평택","平泽"],["천안","天安"],["세종","世宗"],["안동","安东"],["무안","务安"],["아산","牙山"],
  ["목포","木浦"],["전남","全南"],["전북","全北"],["충주","忠州"],["제천","堤川"],["거창","居昌"],
  ["진주","晋州"],["통영","统营"],["양산","梁山"],["구미","龟尾"],["원주","原州"],["속초","束草"]
];

const categoryKeywords={
  shopping:["올리브영","olive young","o.y sale","올영세일","세일","sale","할인","discount","면세점","면세","duty free","쇼핑","shopping","백화점","롯데면세","신라면세","신세계면세","특가"],
  festival:["뮤직페스티벌","록페스티벌","music festival","rock festival","영화제","film festival","비엔날레","biennale","음악제","예술제","art festival","국제축제","세계축제","박람회","expo","국제 페스티벌","festival"],
  star:["팬미팅","fanmeeting","fan meeting","팬콘","fancon","콘서트","concert","월드투어","world tour","쇼케이스","showcase","리사이틀","recital","투어 콘서트","팬사인회","사인회","anniversary fanmeeting","fan concert","fanmeeting","live tour","live ‘","live \'"],
  local:["불꽃","fireworks","드론","drone","푸드","음식","먹거리","미식","야시장","마켓","market","팝업","popup","국밥","맥주","치킨","커피","빵","벚꽃","수국","장미","단풍","억새","핑크뮬리","전시","exhibition","공예","마라톤","라이딩","자전거","스포츠","고래축제","도시축제","축제"]
};

const obviousNonEvent=["채용","입찰","공모","선정결과","지원사업","모집공고","대관공고","계약","용역","교육생 모집","직원 모집"];
const explicitEvent=["행사","축제","공연","전시","콘서트","페스티벌","영화제","비엔날레","마켓","야시장","팝업","팬미팅","대회","마라톤","세일","할인","면세","festival","concert","exhibition","show","sale","discount"];

function clean(s){return (s||"").replace(/\s+/g," ").trim()}
function absolute(base,href){try{return new URL(href,base).href}catch{return base}}
function classify(s,sourceType=""){
  const t=(s||"").toLowerCase();
  if(categoryKeywords.shopping.some(x=>t.includes(x.toLowerCase())) || sourceType==="shopping") return "shopping";
  // 音乐节/电影节等大型 Festival 优先归“特色盛典”，避免被 concert 关键词抢走
  if(categoryKeywords.festival.some(x=>t.includes(x.toLowerCase()))) return "festival";
  if(categoryKeywords.star.some(x=>t.includes(x.toLowerCase()))) return "star";
  return "local";
}

function looksLikeEvent(text,sourceType){
  const t=(text||"").toLowerCase();
  if(sourceType==="ticket" || sourceType==="shopping") return true;
  if(obviousNonEvent.some(x=>t.includes(x.toLowerCase())) && !explicitEvent.some(x=>t.includes(x.toLowerCase()))) return false;
  return explicitEvent.some(x=>t.includes(x.toLowerCase())) || Object.values(categoryKeywords).flat().some(x=>t.includes(x.toLowerCase()));
}
function inferCity(text,fallback){
  if(fallback) return fallback;
  for(const [ko,zh] of cityMap) if((text||"").includes(ko)) return zh;
  return null;
}
function normalizeDate(s){
  const raw=(s||"").trim();
  let m=raw.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m=raw.match(/(?:^|\s)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:$|\s)/);
  if(m) return `20${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  return null;
}
function extractDateRange(text,defaultYear=NOW.getUTCFullYear()){
  const t=clean(text);
  let m=t.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})(?:\s*(?:~|～|－|-|–|—|부터)\s*(?:(20\d{2})[.\-/년\s]+)?(\d{1,2})[.\-/월\s]+(\d{1,2}))?/);
  if(m){
    const y=Number(m[1]), start=`${y}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
    const ey=m[4]?Number(m[4]):y;
    const end=m[5]?`${ey}-${String(m[5]).padStart(2,"0")}-${String(m[6]).padStart(2,"0")}`:start;
    return [start,end];
  }
  // BIFF 等官网常只写“10월 7일”
  m=t.match(/(\d{1,2})월\s*(\d{1,2})일(?:\s*(?:~|～|-|–|—)\s*(\d{1,2})월\s*(\d{1,2})일)?/);
  if(m){
    const start=`${defaultYear}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
    const end=m[3]?`${defaultYear}-${String(m[3]).padStart(2,"0")}-${String(m[4]).padStart(2,"0")}`:start;
    return [start,end];
  }
  const first=[...t.matchAll(/(?:20\d{2}|\b\d{2})[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/g)].map(x=>normalizeDate(x[0])).filter(Boolean);
  return first.length?[first[0],first[1]||first[0]]:[null,null];
}

function hashId(city,title,start){return crypto.createHash("sha1").update(`${city}|${title}|${start}`.toLowerCase()).digest("hex").slice(0,12)}
function daysInclusive(start,end){return Math.max(1,Math.round((new Date(end)-new Date(start))/86400000)+1)}
function sourceLabel(src){return src.sourceType||"other"}
function operationalScore(e){
  let score=0;
  const reasons=[];
  const access=cityAccess[e.city];
  const text=clean([e.title,e.titleOriginal,e.tags?.join(" ")].join(" ")).toLowerCase();
  const duration=daysInclusive(e.startDate,e.endDate||e.startDate);
  if(access?.chinaDirect){score+=2;reasons.push("中国直飞城市")}
  if(e.category==="star"){score+=2;reasons.push("追星事件")}
  if(e.category==="festival"){score+=2;reasons.push("大型节庆/盛典")}
  if(e.category==="shopping"){score+=2;reasons.push("购物需求强")}
  if(duration>=2){score+=1;reasons.push(`持续${duration}天`)}
  if(e.sourceType==="ticket"){score+=1;reasons.push("主流票务平台")}
  if(e.verified||e.sourceType==="official"){score+=1;reasons.push("官方/票务已核验")}
  if(/불꽃|fireworks|드론|drone|미식|food|야시장|night market|벚꽃|cherry blossom|단풍|maple/.test(text)){score+=1;reasons.push("旅行场景强")}
  if(e.isNew){score+=1;reasons.push("近期新增")}
  return {score,hot:score>=4,reasons:[...new Set(reasons)].slice(0,4),accessNote:access?.note||"",categoryVersion:5};
}

const zhTerms=[
  [/부산/g,"釜山"],[/대구/g,"大邱"],[/인천/g,"仁川"],[/광주/g,"光州"],[/대전/g,"大田"],[/울산/g,"蔚山"],[/청주/g,"清州"],[/수원/g,"水原"],[/전주/g,"全州"],[/경주/g,"庆州"],[/강릉/g,"江陵"],
  [/국제/g,"国际"],[/세계/g,"世界"],[/전국투어/g,"全国巡演"],[/월드투어/gi,"世界巡演"],[/록페스티벌/gi,"摇滚音乐节"],[/뮤직페스티벌/gi,"音乐节"],[/음악제/g,"音乐节"],[/영화제/g,"电影节"],[/비엔날레/gi,"双年展"],[/예술제/g,"艺术节"],[/페스티벌/gi,"节"],[/festival/gi,"节"],
  [/팬미팅/gi,"粉丝见面会"],[/fan\s*meeting/gi,"粉丝见面会"],[/팬콘/gi,"粉丝演唱会"],[/콘서트/gi,"演唱会"],[/concert/gi,"演唱会"],[/쇼케이스/gi,"发布演出"],[/showcase/gi,"发布演出"],
  [/불꽃/g,"烟花"],[/드론/gi,"无人机"],[/야시장/g,"夜市"],[/마켓/gi,"市集"],[/market/gi,"市集"],[/팝업/gi,"快闪"],[/popup/gi,"快闪"],[/푸드/gi,"美食"],[/미식/g,"美食"],[/전시/g,"展览"],[/exhibition/gi,"展览"],
  [/올리브영/gi,"Olive Young"],[/올영세일/gi,"Olive Young 大促"],[/o\.?y\.?\s*sale/gi,"Olive Young 大促"],[/세일/gi,"折扣季"],[/sale/gi,"折扣季"],[/할인/g,"折扣"],[/면세점/g,"免税店"],[/duty\s*free/gi,"免税店"],[/쇼핑/g,"购物"]
];
function heuristicChineseTitle(raw){
  let s=clean(raw);
  for(const [re,to] of zhTerms) s=s.replace(re,to);
  return clean(s.replace(/\s*[-–—]\s*/g," · ").replace(/\s{2,}/g," "));
}
function hasHangul(s){return /[가-힣]/.test(s||"")}
function chineseCount(s){return ((s||"").match(/[\u3400-\u9fff]/g)||[]).length}
async function translateTitleToChinese(raw,city,category){
  const first=heuristicChineseTitle(raw);
  if(!hasHangul(first) && (chineseCount(first)>=2 || /^[\d\s·:：A-Za-z.&'_-]+$/.test(first)===false)) return first;
  try{
    const u=new URL("https://api.mymemory.translated.net/get");
    u.searchParams.set("q",raw);u.searchParams.set("langpair","ko|zh-CN");
    const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 KoreaEventCalendar/6.0"},signal:AbortSignal.timeout(15000)});
    if(r.ok){const j=await r.json();const tr=clean(j?.responseData?.translatedText||"");if(tr) return heuristicChineseTitle(tr)}
  }catch(e){console.error("TRANSLATE_SOFT_FAIL",raw,e.message)}
  const label={festival:"特色盛典",star:"演唱会 / 见面会",local:"特色活动",shopping:"购物优惠"}[category]||"活动";
  return `${city||"韩国"}${label}`;
}

async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 KoreaEventCalendar/6.0","accept-language":"ko-KR,ko;q=0.9,en;q=0.8"},redirect:"follow"});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}

function discoverInstagramUrls(html,src){
  const $=cheerio.load(html);
  const urls=[];
  $('a[href*="instagram.com"]').each((_,a)=>{
    const href=$(a).attr("href");
    if(!href) return;
    const u=absolute(src.url,href).split("?")[0];
    if(/instagram\.com\/(?!p\/|reel\/|explore\/)/.test(u)) urls.push(u);
  });
  return [...new Set(urls)].slice(0,3);
}

function extractBiff(html,src){
  const $=cheerio.load(html); const text=clean($("body").text()); const out=[];
  const mainRange=extractDateRange(text,2026);
  if(/제31회\s*부산국제영화제|31st\s*Busan\s*International\s*Film\s*Festival/i.test(text) && mainRange[0]){
    out.push({id:"biff-2026-main",title:"第31届釜山国际电影节",titleOriginal:"제31회 부산국제영화제",category:"festival",city:"釜山",startDate:mainRange[0],endDate:mainRange[1],venue:"电影殿堂等釜山市内场馆",address:"Busan Cinema Center, Busan, South Korea",sourceName:src.name,sourceUrl:src.url,sourceType:"official",tags:["BIFF","电影节","国际盛典"],firstSeen:TODAY,lastSeen:TODAY,isNew:true,verified:true});
  }
  const actorRe=/액터스\s*하우스\s*:\s*([^\s\d]{2,12})\s+(\d{1,2})월\s*(\d{1,2})일/g;
  const actorZh={"이민호":"李敏镐","김고은":"金高银","김민하":"金敏荷","류승룡":"柳承龙","신민아":"申敏儿","주지훈":"朱智勋"};
  for(const m of text.matchAll(actorRe)){
    const ko=m[1], zh=actorZh[ko]||ko, date=`2026-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
    out.push({id:hashId("釜山",`Actors House ${ko}`,date),title:`釜山国际电影节 Actors’ House：${zh}`,titleOriginal:`액터스 하우스: ${ko}`,category:"star",city:"釜山",startDate:date,endDate:date,venue:"新世界百货 Centum City 9层文化厅",address:"Shinsegae Centum City, Busan, South Korea",sourceName:src.name,sourceUrl:src.url,sourceType:"official",tags:["演员","Actors House",zh],firstSeen:TODAY,lastSeen:TODAY,isNew:true,verified:true});
  }
  return out;
}

function extractTicketlinkNoticeLinks(html,src){
  const $=cheerio.load(html); const links=[];
  $("a").each((_,a)=>{const title=clean($(a).text()); const href=$(a).attr("href")||""; if(/티켓오픈|ticket.?open/i.test(title) && /notice\//.test(href)) links.push({title,url:absolute(src.url,href)});});
  return [...new Map(links.map(x=>[x.url,x])).values()].slice(0,80);
}

function extractTicketDetail(html,src){
  const $=cheerio.load(html); const text=clean($("body").text());
  if(!looksLikeEvent(text,"ticket")) return [];
  let title=clean($("h1").first().text()||$("title").text());
  const tm=text.match(/제목\s*([^]{4,160}?)(?:오픈일|장소|등록일)/); if(tm) title=clean(tm[1]);
  title=title.replace(/티켓오픈 안내.*$/," ").trim();
  const [start,end]=extractDateRange(text); if(!start) return [];
  const city=inferCity(text,src.city); if(!city||city==="首尔"||city==="济州"||city==="仁川") return [];
  const vm=text.match(/(?:공연 장소|장소)\s*[:：]?\s*([^]{2,80}?)(?:티켓|예매|등록일|공연정보)/); const venue=vm?clean(vm[1]):"";
  return [{id:hashId(city,title,start),title,titleOriginal:title,category:classify(text,"ticket"),city,startDate:start,endDate:end,venue,address:venue?`${venue}, ${city}, South Korea`:`${city}, South Korea`,sourceName:src.name,sourceUrl:src.url,sourceType:"ticket",tags:["Ticketlink"],firstSeen:TODAY,lastSeen:TODAY,isNew:true}];
}

function extractTicketSearch(html,src){
  // 先跑通用 DOM 解析，再从页面内嵌 JSON / 文本块补漏。
  const out=extractFromHtml(html,src); const seen=new Set(out.map(e=>e.id));
  const $=cheerio.load(html); const candidates=[];
  $("a").each((_,a)=>{
    const title=clean($(a).text()); if(title.length<4||title.length>150) return;
    let box=$(a).parent(), text="";
    for(let i=0;i<7;i++){text=clean(box.text()); if(extractDateRange(text)[0] && text.length<1200) break; box=box.parent();}
    if(!extractDateRange(text)[0]) return; candidates.push({title,text,href:$(a).attr("href")||src.url});
  });
  for(const c of candidates){
    const [start,end]=extractDateRange(c.text); const city=inferCity(c.text+" "+c.title,src.city); if(!start||!city||city==="首尔"||city==="济州"||city==="仁川") continue;
    if(!looksLikeEvent(c.text,"ticket")) continue; const id=hashId(city,c.title,start); if(seen.has(id)) continue; seen.add(id);
    out.push({id,title:c.title,titleOriginal:c.title,category:classify(c.text,"ticket"),city,startDate:start,endDate:end,venue:"",address:`${city}, South Korea`,sourceName:src.name,sourceUrl:absolute(src.url,c.href),sourceType:"ticket",tags:[],firstSeen:TODAY,lastSeen:TODAY,isNew:true});
  }
  return out;
}

function extractSocialPosts(html,src){
  const $=cheerio.load(html);
  const out=[];
  const seen=new Set();
  const linkSelector=src.kind==="xiaohongshu" ? 'a[href*="/explore/"],a[href*="/discovery/item/"]' : 'a[href*="/p/"],a[href*="/reel/"]';
  $(linkSelector).each((_,a)=>{
    const href=$(a).attr("href")||"";
    const box=$(a).closest("section,article,li,div");
    const title=clean($(a).attr("title")||$(a).attr("aria-label")||box.find("h1,h2,h3,h4,.title,.note-title").first().text()||$(a).text());
    if(title.length<4||title.length>140) return;
    const text=clean(box.text()+" "+title);
    const city=inferCity(text,src.city);
    if(!city||city==="首尔"||city==="济州"||city==="仁川"||!looksLikeEvent(text,"social")) return;
    const dates=[...text.matchAll(/(?:20\d{2}|\b\d{2})[.\-/年년\s]+\d{1,2}[.\-/月월\s]+\d{1,2}/g)].map(x=>normalizeDate(x[0])).filter(Boolean);
    if(!dates.length) return;
    const start=dates[0],end=dates[1]||start,key=`${city}|${title}|${start}`;
    if(seen.has(key)) return;seen.add(key);
    out.push({id:hashId(city,title,start),title,titleOriginal:title,category:classify(text,src.sourceType),city,startDate:start,endDate:end,venue:"",address:`${city}, South Korea`,sourceName:src.name,sourceUrl:absolute(src.url,href),sourceType:"social",tags:[src.kind==="xiaohongshu"?"小红书":"Instagram"],firstSeen:TODAY,lastSeen:TODAY,isNew:true});
  });
  return out;
}

function extractFromHtml(html,src){
  const $=cheerio.load(html);
  $("script,style,noscript").remove();
  const out=[];
  const seen=new Set();

  $("a").each((_,a)=>{
    const title=clean($(a).text());
    if(title.length<4||title.length>140) return;
    let box=$(a).parent(), text="";
    for(let i=0;i<7;i++){text=clean(box.text());if(extractDateRange(text)[0]&&text.length<1400)break;box=box.parent();}
    if(!text) text=clean($(a).closest("li,tr,article,section,div").text());
    if(!looksLikeEvent(text,src.sourceType)) return;
    const range=extractDateRange(text);
    if(!range[0]) return;
    const city=inferCity(text+" "+title,src.city);
    if(!city||city==="首尔"||city==="济州"||city==="仁川") return;
    const start=range[0],end=range[1]||start;
    if(start<"2026-01-01") return;
    const key=`${city}|${title}|${start}`;
    if(seen.has(key)) return;seen.add(key);
    let venue="";
    const venueMatch=text.match(/(?:공연 장소|장소|venue)\s*[:：]?\s*([^|]{2,80})/i);
    if(venueMatch) venue=clean(venueMatch[1]).slice(0,90);
    out.push({id:hashId(city,title,start),title,titleOriginal:title,category:classify(text,src.sourceType),city,startDate:start,endDate:end,venue,address:venue?`${venue}, ${city}, South Korea`:`${city}, South Korea`,sourceName:src.name,sourceUrl:absolute(src.url,$(a).attr("href")||src.url),sourceType:sourceLabel(src),tags:[],firstSeen:TODAY,lastSeen:TODAY,isNew:true});
  });
  return out;
}

const old=JSON.parse(await fs.readFile(DATA,"utf8")).events||[];
const oldById=new Map(old.map(x=>[x.id,x]));
let fresh=[];
const queue=[...sources];
const processed=new Set();
let socialDiscovered=0;

while(queue.length){
  const src=queue.shift();
  if(processed.has(src.url)) continue;
  processed.add(src.url);
  try{
    const html=await fetchText(src.url);
    if(src.discoverInstagram){
      for(const url of discoverInstagramUrls(html,src)){
        if(!processed.has(url)){
          queue.push({name:`${src.name} · Instagram`,city:src.city,url,kind:"instagram",sourceType:"social",softFail:true});
          socialDiscovered++;
        }
      }
    }
    if(src.kind==="ticketlinkIndex"){
      for(const item of extractTicketlinkNoticeLinks(html,src)) if(!processed.has(item.url)) queue.push({name:`Ticketlink · ${item.title}`,city:null,url:item.url,sourceType:"ticket",kind:"ticketDetail",softFail:true});
    }
    let rows;
    if(src.kind==="xiaohongshu"||src.kind==="instagram") rows=extractSocialPosts(html,src);
    else if(src.kind==="biff") rows=extractBiff(html,src);
    else if(src.kind==="ticketSearch") rows=extractTicketSearch(html,src);
    else if(src.kind==="ticketDetail") rows=extractTicketDetail(html,src);
    else rows=extractFromHtml(html,src);
    fresh.push(...rows);
    console.log(src.name,rows.length);
  }catch(e){
    console.error(src.softFail?"SOURCE_SOFT_FAIL":"SOURCE_FAIL",src.name,e.message);
  }
}

const merged=new Map();
for(const e of verifiedSeed){
  const age=(NOW-new Date((e.endDate||e.startDate)+"T00:00:00Z"))/86400000;
  if(age<30) merged.set(e.id,{...e,isNew:false,verified:true});
}
for(const e of old){
  const age=(NOW-new Date((e.endDate||e.startDate)+"T00:00:00Z"))/86400000;
  if(age<120) merged.set(e.id,{...e,isNew:false});
}
for(const e of fresh){
  const prev=oldById.get(e.id);
  const mergedEvent={...prev,...e,firstSeen:prev?.firstSeen||TODAY,lastSeen:TODAY,isNew:!prev};
  merged.set(e.id,mergedEvent);
}

const translated=[];
for(const event of merged.values()){
  if(event.city==="首尔"||event.city==="济州"||event.city==="仁川") continue;
  const original=event.titleOriginal||event.title||"";
  event.category=classify([original,event.tags?.join(" "),event.sourceName].join(" "),event.sourceType);
  if(!event.titleZh || hasHangul(event.titleZh)){
    event.titleZh=await translateTitleToChinese(original,event.city,event.category);
  }
  event.title=event.titleZh;
  translated.push({...event,ops:operationalScore(event)});
}
const events=translated.sort((a,b)=>a.startDate.localeCompare(b.startDate)||b.ops.score-a.ops.score||a.city.localeCompare(b.city,"zh-CN"));

await fs.writeFile(DATA,JSON.stringify({events},null,2));
await fs.writeFile(META,JSON.stringify({updatedAt:new Date().toISOString(),sourceCount:sources.length,socialDiscovered,eventCount:events.length,verifiedCount:events.filter(x=>x.verified).length,newCount:events.filter(x=>x.isNew).length,hotCount:events.filter(x=>x.ops?.hot).length,coverageVersion:6},null,2));
console.log(`Saved ${events.length} events; hot=${events.filter(x=>x.ops?.hot).length}; discovered Instagram=${socialDiscovered}`);
