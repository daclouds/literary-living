import axios from 'axios';
import {createHash} from 'node:crypto';
import {catalog,publicConcept} from './catalog.js';
const normalize=s=>s.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const ids=(entity,property)=>(entity?.claims?.[property]||[]).filter(s=>s.rank!=='deprecated').map(s=>s.mainsnak?.datavalue?.value?.id).filter(Boolean);
const names=entity=>[...Object.values(entity.labels||{}).map(x=>x.value),...Object.values(entity.aliases||{}).flat().map(x=>x.value)];
export class VerificationError extends Error{constructor(message,status=422){super(message);this.status=status;}}
export function curatedPair(book,character){return catalog.find(c=>[c.book,c.original].some(x=>normalize(x)===normalize(book))&&[c.character,...c.aliases].some(x=>normalize(x)===normalize(character)));}
export function createVerifier(request=async params=>(await axios.get('https://www.wikidata.org/w/api.php',{params,timeout:10000,headers:{'User-Agent':'LiteraryLiving/0.2 (book-character verification)'}})).data){
 const cache=new Map();
 return async function verifyPair(book,character){
  const key=normalize(book)+'|'+normalize(character);const cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.value;
  const query=params=>request({format:'json',...params});
  async function search(text){const pages=await Promise.all(['ko','en'].map(language=>query({action:'wbsearchentities',search:text,language,uselang:'ko',type:'item',limit:8})));return [...new Set(pages.flatMap(p=>(p.search||[]).map(x=>x.id)).filter(x=>/^Q\d+$/.test(x)))];}
  try{
   const [books,characters]=await Promise.all([search(book),search(character)]);
   if(!books.length||!characters.length)throw new VerificationError('책 또는 등장인물을 찾지 못했습니다. 정식 제목이나 원어 이름으로 다시 입력해 주세요.');
   const response=await query({action:'wbgetentities',ids:[...new Set([...books,...characters])].join('|'),props:'labels|aliases|claims'});const entities=response.entities||{};
   // Exact names (including translations and aliases) prevent accepting an unrelated search result.
   const matchedBooks=books.map(id=>entities[id]).filter(e=>e&&names(e).some(n=>normalize(n)===normalize(book)));
   const matchedCharacters=characters.map(id=>entities[id]).filter(e=>e&&names(e).some(n=>normalize(n)===normalize(character)));
   let pair;
   for(const b of matchedBooks)for(const c of matchedCharacters)if(ids(b,'P674').includes(c.id)||ids(c,'P1441').includes(b.id))pair={b,c};
   if(!pair)throw new VerificationError('자료에서 이 작품과 등장인물의 관계를 확인하지 못했습니다. 제목·이름의 다른 표기를 시도해 주세요. 자료가 부족한 작품도 확인되지 않을 수 있습니다.');
   const {b,c}=pair;
   // Confirm a literary work/series, rather than accepting a film or game with the same title.
   const literary=new Set(['Q571','Q7725634','Q47461344','Q8261','Q49084','Q1667921','Q49085','Q277759','Q1004','Q25379','Q14406742','Q21198342','Q1760610','Q2635894','Q8274','Q747381']);
   let frontier=ids(b,'P31'),seen=new Set(),isLiterary=false;
   for(let depth=0;depth<4&&frontier.length;depth++){
    if(frontier.some(x=>literary.has(x))){isLiterary=true;break;}
    const fresh=frontier.filter(x=>!seen.has(x));fresh.forEach(x=>seen.add(x));if(!fresh.length)break;
    const classes=await query({action:'wbgetentities',ids:fresh.slice(0,40).join('|'),props:'claims'});
    frontier=Object.values(classes.entities||{}).flatMap(e=>ids(e,'P279'));
   }
   if(!isLiterary)throw new VerificationError('이 항목이 책 또는 문학 작품인지 확인하지 못했습니다. 책의 정식 제목으로 입력해 주세요.');
   const value={book,character,bookId:b.id,characterId:c.id,source:`https://www.wikidata.org/wiki/${b.id}`,characterSource:`https://www.wikidata.org/wiki/${c.id}`};
   if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+3600000});return value;
  }catch(e){if(e instanceof VerificationError)throw e;throw new VerificationError('작품 확인 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',503);}
 };
}
export const verifyPair=createVerifier();
export function verifiedConcept(v){const base=publicConcept(catalog[0]);return {...base,id:'verified-'+createHash('sha256').update(v.bookId+':'+v.characterId).digest('hex').slice(0,24),book:v.book,original:v.book,author:'Wikidata에서 작품·인물 관계 확인',character:v.character,title:v.character+'의 공간',subtitle:'YOUR LITERARY INSPIRATION',description:`《${v.book}》의 ${v.character}을(를) 선택했습니다. 작품·인물 관계를 확인했으며, 현재 이미지는 공간 탐색을 위한 공통 데모입니다. 해당 인물에 맞춘 이미지 생성은 GPU 연결 후 제공됩니다.`,verification:{source:v.source,characterSource:v.characterSource},isGenericDemo:true};}
