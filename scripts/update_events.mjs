import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const DATA="./data/events.json";
const META="./data/meta.json";
const ACCESS_DATA="./data/city_access.json";
const TRANSLATIONS_DATA="./data/title_translations.json";
const NOW=new Date();
const TODAY=NOW.toISOString().slice(0,10);
const cityAccess=JSON.parse(await fs.readFile(ACCESS_DATA,"utf8"));
let titleTranslations={};
try{titleTranslations=JSON.parse(await fs.readFile(TRANSLATIONS_DATA,"utf8"))}catch{}

const sources=[
  // 城市官方 / 文旅
  {name:"Visit Busan",city:"釜山",url:"https://www.visitbusan.net/schedule/list.do?boardId=BBS_0000009&menuCd=DOM_000000204012000000",sourceType:"tour"},
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
  {name:"Ticketlink",city:null,url:"https://www.ticketlink.co.kr/",sourceType:"ticket",softFail:true},

  // 文化财团：重点补地方节庆 / 展览 / 艺术活动；会自动发现官网链接的 Instagram
  {name:"釜山文化财团",city:"釜山",url:"https://www.bscf.or.kr/main.do",sourceType:"culture",discoverInstagram:true},
  {name:"大邱文化艺术振兴院",city:"大邱",url:"https://dgfca.or.kr/",sourceType:"culture",discoverInstagram:true},
  {name:"光州文化财团",city:"光州",url:"https://www.gjcf.or.kr/cf/index.do",sourceType:"culture",discoverInstagram:true},
  {name:"忠北文化财团（清州）",city:"清州",url:"https://www.cbfc.or.kr/home/main.php",sourceType:"culture",discoverInstagram:true},
  {name:"大田文化财团",city:"大田",url:"https://dcaf.or.kr/web/index.do",sourceType:"culture",discoverInstagram:true},
  {name:"蔚山文化观光财团",city:"蔚山",url:"https://uctf.or.kr/",sourceType:"culture",discoverInstagram:true},
  {name:"仁川文化财团",city:"仁川",url:"https://www.ifac.or.kr/index.do",sourceType:"culture",discoverInstagram:true},
  {name:"庆南文化艺术振兴院",city:null,url:"https://www.gcaf.or.kr/",sourceType:"culture",discoverInstagram:true},

  // 社媒：小红书与 Instagram 都用 soft-fail，失败不会影响其他来源
  {name:"韩国旅游发展局 · 小红书",city:null,url:"https://www.xiaohongshu.com/user/profile/62a2e4f1000000001b027b63",kind:"xiaohongshu",sourceType:"social",softFail:true}
];

const cityMap=[
  ["부산","釜山"],["대구","大邱"],["인천","仁川"],["광주","光州"],["대전","大田"],["울산","蔚山"],
  ["청주","清州"],["수원","水原"],["전주","全州"],["여수","丽水"],["경주","庆州"],["강릉","江陵"],
  ["춘천","春川"],["김해","金海"],["포항","浦项"],["창원","昌原"],["익산","益山"],["군산","群山"],
  ["평택","平泽"],["천안","天安"],["세종","世宗"],["안동","安东"],["무안","务安"],["아산","牙山"],
  ["목포","木浦"],["전남","全南"],["전북","全北"],["충주","忠州"],["제천","堤川"],["거창","居昌"],
  ["진주","晋州"],["통영","统营"],["양산","梁山"],["구미","龟尾"],["원주","原州"],["속초","束草"]
];

const keywords={
  concert:["콘서트","뮤직","음악제","페스티벌","festival","팬미팅","fanmeeting","팬콘","라이브","live","공연","록페스티벌","rock","월드투어","world tour","쇼케이스"],
  food:["푸드","음식","먹거리","야시장","마켓","시장","팝업","popup","국밥","맥주","치킨","커피","빵","미식","food"],
  season:["벚꽃","꽃","수국","장미","단풍","억새","핑크뮬리","봄꽃","가을","겨울","눈꽃","season","개화","낙엽"],
  art:["전시","비엔날레","미술","영화제","아트","예술제","갤러리","뮤지컬","연극","오페라","클래식","박람회","biennale","film","공예"],
  sport:["마라톤","런","워크","걷기","라이딩","자전거","경기","대회","스포츠","드론","불꽃","도시축제","축제","엑스포","expo","레이스"]
};

const obviousNonEvent=["채용","입찰","공모","선정결과","지원사업","모집공고","대관공고","계약","용역","교육생 모집","직원 모집"];
const explicitEvent=["행사","축제","공연","전시","콘서트","페스티벌","영화제","비엔날레","마켓","야시장","팝업","팬미팅","대회","마라톤","festival","concert","exhibition","show"];

function clean(s){return (s||"").replace(/\s+/g," ").trim()}
function hasHangul(s){return /[\uac00-\ud7af]/.test(s||"")}
async function translateTitle(original){
  const key=clean(original);
  if(!hasHangul(key)) return key;
  if(titleTranslations[key]) return titleTranslations[key];
  try{
    const url=new URL("https://api.mymemory.translated.net/get");
    url.search=new URLSearchParams({q:key,langpair:"ko|zh-CN"});
    const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 KoreaEventCalendar/3.0"},signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw new Error(`translate ${r.status}`);
    const data=await r.json();
    const translated=clean(data?.responseData?.translatedText||"");
    if(translated&&!hasHangul(translated)){
      titleTranslations[key]=translated;
      return translated;
    }
  }catch(e){console.error("TRANSLATE_SOFT_FAIL",key.slice(0,50),e.message)}
  return key;
}
function absolute(base,href){try{return new URL(href,base).href}catch{return base}}
function classify(s){
  const t=(s||"").toLowerCase();
  for(const [k,arr] of Object.entries(keywords)) if(arr.some(x=>t.includes(x.toLowerCase()))) return k;
  return "sport";
}
function looksLikeEvent(text,sourceType){
  const t=(text||"").toLowerCase();
  if(sourceType==="ticket") return true;
  if(obviousNonEvent.some(x=>t.includes(x.toLowerCase())) && !explicitEvent.some(x=>t.includes(x.toLowerCase()))) return false;
  return explicitEvent.some(x=>t.includes(x.toLowerCase())) || Object.values(keywords).flat().some(x=>t.includes(x.toLowerCase()));
}
function inferCity(text,fallback){
  if(fallback) return fallback;
  for(const [ko,zh] of cityMap) if((text||"").includes(ko)) return zh;
  return null;
}
function normalizeDate(s){
  const m=(s||"").match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if(!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
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
  if(e.category==="concert" && /(팬미팅|팬콘|월드투어|world tour|festival|페스티벌|콘서트|concert|뮤직|rock)/i.test(text)){
    score+=2;reasons.push("追星/音乐节信号");
  } else if(e.category==="concert") {score+=1;reasons.push("演出事件")}
  if(duration>=2){score+=1;reasons.push(`持续${duration}天`)}
  if(/국제|세계|international|비엔날레|biennale|영화제|festival|페스티벌|박람회|expo/i.test(text)){
    score+=1;reasons.push("国际/大型节庆");
  }
  if(e.sourceType==="ticket"){score+=1;reasons.push("主流票务平台")}
  if(e.category==="food" || e.category==="season"){score+=1;reasons.push("旅行场景强")}
  if(e.isNew){score+=1;reasons.push("近期新增")}
  return {score,hot:score>=4,reasons:[...new Set(reasons)].slice(0,4),accessNote:access?.note||""};
}

async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 KoreaEventCalendar/3.0","accept-language":"ko-KR,ko;q=0.9,en;q=0.8"},redirect:"follow"});
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
    if(!city||city==="首尔"||city==="济州"||!looksLikeEvent(text,"social")) return;
    const dates=[...text.matchAll(/20\d{2}[.\-/年년\s]+\d{1,2}[.\-/月월\s]+\d{1,2}/g)].map(x=>normalizeDate(x[0])).filter(Boolean);
    if(!dates.length) return;
    const start=dates[0],end=dates[1]||start,key=`${city}|${title}|${start}`;
    if(seen.has(key)) return;seen.add(key);
    out.push({id:hashId(city,title,start),title,titleOriginal:title,category:classify(text),city,startDate:start,endDate:end,venue:"",address:`${city}, South Korea`,sourceName:src.name,sourceUrl:absolute(src.url,href),sourceType:"social",tags:[src.kind==="xiaohongshu"?"小红书":"Instagram"],firstSeen:TODAY,lastSeen:TODAY,isNew:true});
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
    const box=$(a).closest("li,tr,article,section,div");
    const text=clean(box.text());
    if(!looksLikeEvent(text,src.sourceType)) return;
    const dates=[...text.matchAll(/20\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}/g)].map(x=>normalizeDate(x[0])).filter(Boolean);
    if(!dates.length) return;
    const city=inferCity(text+" "+title,src.city);
    if(!city||city==="首尔"||city==="济州") return;
    const start=dates[0],end=dates[1]||start;
    if(start<"2026-01-01") return;
    const key=`${city}|${title}|${start}`;
    if(seen.has(key)) return;seen.add(key);
    let venue="";
    const venueMatch=text.match(/(?:공연 장소|장소|venue)\s*[:：]?\s*([^|]{2,80})/i);
    if(venueMatch) venue=clean(venueMatch[1]).slice(0,90);
    out.push({id:hashId(city,title,start),title,titleOriginal:title,category:classify(text),city,startDate:start,endDate:end,venue,address:venue?`${venue}, ${city}, South Korea`:`${city}, South Korea`,sourceName:src.name,sourceUrl:absolute(src.url,$(a).attr("href")||src.url),sourceType:sourceLabel(src),tags:[],firstSeen:TODAY,lastSeen:TODAY,isNew:true});
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
    const rows=(src.kind==="xiaohongshu"||src.kind==="instagram") ? extractSocialPosts(html,src) : extractFromHtml(html,src);
    fresh.push(...rows);
    console.log(src.name,rows.length);
  }catch(e){
    console.error(src.softFail?"SOURCE_SOFT_FAIL":"SOURCE_FAIL",src.name,e.message);
  }
}

const merged=new Map();
for(const e of old){
  const age=(NOW-new Date((e.endDate||e.startDate)+"T00:00:00Z"))/86400000;
  if(age<120) merged.set(e.id,{...e,isNew:false});
}
for(const e of fresh){
  const prev=oldById.get(e.id);
  const mergedEvent={...prev,...e,firstSeen:prev?.firstSeen||TODAY,lastSeen:TODAY,isNew:!prev};
  merged.set(e.id,mergedEvent);
}

const translatedEvents=[];
for(const e of [...merged.values()].filter(e=>e.city!=="首尔"&&e.city!=="济州")){
  const original=clean(e.titleOriginal||e.title);
  const title=await translateTitle(original);
  translatedEvents.push({...e,title,titleOriginal:original});
}

const events=translatedEvents
  .map(e=>({...e,ops:operationalScore(e)}))
  .sort((a,b)=>a.startDate.localeCompare(b.startDate)||b.ops.score-a.ops.score||a.city.localeCompare(b.city,"ko"));

await fs.writeFile(DATA,JSON.stringify({events},null,2));
await fs.writeFile(TRANSLATIONS_DATA,JSON.stringify(titleTranslations,null,2));
await fs.writeFile(META,JSON.stringify({updatedAt:new Date().toISOString(),sourceCount:sources.length,socialDiscovered,eventCount:events.length,newCount:events.filter(x=>x.isNew).length,hotCount:events.filter(x=>x.ops?.hot).length},null,2));
console.log(`Saved ${events.length} events; hot=${events.filter(x=>x.ops?.hot).length}; discovered Instagram=${socialDiscovered}`);
