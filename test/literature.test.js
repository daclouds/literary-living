import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVerifier,curatedPair} from '../literature.js';
const claim=id=>({rank:'normal',mainsnak:{datavalue:{value:{id}}}});
function fixture({related=true,bookType='Q8261',fail=false}={}){return async p=>{if(fail)throw new Error('unavailable');if(p.action==='wbsearchentities')return {search:[{id:p.search==='듄'?'Q100':'Q200'}]};return {entities:{Q100:{id:'Q100',labels:{ko:{value:'듄'}},claims:{P31:[claim(bookType)],...(related?{P674:[claim('Q200')]}:{})}},Q200:{id:'Q200',labels:{ko:{value:'폴 아트레이데스'}},claims:{}}}};};}
test('verifies a work beyond the three examples using an explicit source relation',async()=>{const result=await createVerifier(fixture())('듄','폴 아트레이데스');assert.equal(result.bookId,'Q100');assert.equal(result.characterId,'Q200');assert.equal(result.source,'https://www.wikidata.org/wiki/Q100');});
test('does not accept unrelated names or nonliterary works',async()=>{await assert.rejects(createVerifier(fixture({related:false}))('듄','폴 아트레이데스'),{status:422});await assert.rejects(createVerifier(fixture())('이름이 다른 책','폴 아트레이데스'),{status:422});await assert.rejects(createVerifier(fixture({bookType:'Q11424'}))('듄','폴 아트레이데스'),{status:422});});
test('outages are distinct from invalid input and are never cached as success',async()=>{await assert.rejects(createVerifier(fixture({fail:true}))('듄','폴 아트레이데스'),{status:503});});
test('curated matching uses whole fields, including English aliases',()=>{assert.equal(curatedPair('The Great Gatsby','Jay Gatsby')?.id,'gatsby');assert.equal(curatedPair('위대한 개츠비','셜록 홈즈'),undefined);assert.equal(curatedPair('위대한 개츠비','개'),undefined);});
