import {test,expect} from '@playwright/test';
test('discover, validate a character, inspect furniture, save and publish',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'좋아하는 이야기, 살고 싶은 공간으로.'})).toBeVisible();
 await page.getByRole('button',{name:'나만의 이야기 시작하기'}).click();
 await page.getByRole('textbox',{name:'책 제목',exact:true}).fill('위대한 개츠비');
 await page.getByRole('textbox',{name:'등장인물',exact:true}).fill('제이 개츠비');
 await page.getByRole('button',{name:'공간 콘셉트 찾기'}).click();
 await expect(page.getByRole('dialog',{name:'초록 불빛이 머무는 밤'})).toBeVisible();await page.getByRole('button',{name:'올리브 벨벳 소파 상세 보기'}).click();await expect(page.locator('.dimensions')).toHaveText('220 × 92 × 78 cm');
 await page.getByRole('button',{name:'내 공간에 저장하기'}).click();await page.getByRole('button',{name:'처음이신가요? 회원가입'}).click();
 await page.getByRole('textbox',{name:'이름',exact:true}).fill('테스트 독자');await page.getByRole('textbox',{name:'이메일',exact:true}).fill(`reader-${Date.now()}@example.com`);await page.getByLabel('비밀번호',{exact:true}).fill('test-password-1234');await page.getByRole('button',{name:'계정 만들기'}).click();
 await expect(page.getByRole('dialog',{name:'회원가입'})).not.toBeVisible();await page.getByRole('button',{name:'내 공간에 저장하기'}).click();await expect(page.getByRole('status')).toContainText('비공개로 저장');await page.getByRole('dialog',{name:'초록 불빛이 머무는 밤'}).getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'나의 공간',exact:true}).click();await expect(page.locator('.room-card')).toHaveCount(1);await page.getByRole('button',{name:'비공개 · 공개하기'}).click();await expect(page.getByRole('button',{name:'공개 중 · 비공개로'})).toBeVisible();await page.getByRole('button',{name:'커뮤니티 갤러리'}).click();await expect(page.locator('.room-card')).toHaveCount(1);expect(errors).toEqual([]);
});
test('mobile navigation fits viewport and can open a room',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.room-card')).toHaveCount(3);await page.screenshot({path:'test-results/mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'메뉴',exact:true}).click();await page.getByRole('button',{name:'나의 공간',exact:true}).click();await expect(page.getByRole('heading',{name:'당신의 이야기를 모아보세요'})).toBeVisible();});
test('desktop layout',async({page})=>{await page.setViewportSize({width:1440,height:1000});await page.goto('/');await expect(page.locator('.room-card')).toHaveCount(3);await expect.poll(()=>page.locator('.hero-visual>img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);await page.locator('.room-card').last().scrollIntoViewIfNeeded();await expect.poll(()=>page.locator('.card-image img').evaluateAll((imgs:HTMLImageElement[])=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'test-results/desktop.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});

test('separate fields allow any title and retain values on validation errors',async({page})=>{
 await page.route('**/api/design',async route=>{const body=route.request().postDataJSON();expect(body).toEqual({book:'듄',character:'폴 아트레이데스'});await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'작품과 등장인물의 관계를 확인하지 못했습니다.'})});});
 await page.goto('/');await page.getByRole('button',{name:'나만의 이야기 시작하기'}).click();await expect(page.locator('textarea')).toHaveCount(0);const submit=page.getByRole('button',{name:'공간 콘셉트 찾기'});await expect(submit).toBeDisabled();await page.getByRole('textbox',{name:'책 제목',exact:true}).fill('듄');await expect(submit).toBeDisabled();await page.getByRole('textbox',{name:'등장인물',exact:true}).fill('폴 아트레이데스');await submit.click();await expect(page.getByRole('alert')).toContainText('관계를 확인하지 못했습니다');await expect(page.getByRole('textbox',{name:'책 제목',exact:true})).toHaveValue('듄');await expect(page.getByText('현재 3개 작품 지원')).toHaveCount(0);
});

test('generated results can be reopened and saved without demo furniture markers',async({page})=>{
 const concepts=await (await page.request.get('/api/catalog')).json();const concept=concepts[0];
 const job={id:'generated-test-job',conceptId:concept.id,state:'succeeded',error:null,image:'/images/gatsby.png'};
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'test-user',name:'GPU 독자',email:'gpu@example.com'}}}));
 await page.route('**/api/generations',r=>r.fulfill({json:{configured:true,jobs:[job]}}));
 let saved=false;
 await page.route('**/api/rooms',r=>{if(r.request().method()==='POST'){expect(r.request().postDataJSON()).toEqual({conceptId:concept.id,generationId:job.id});saved=true;return r.fulfill({status:201,json:{room:{...concept,id:'saved-generated',conceptId:concept.id,generationId:job.id,isGenerated:true,items:[],isPublic:false}}});}return r.fulfill({json:[]});});
 await page.goto('/');await page.getByRole('button',{name:'나의 공간',exact:true}).click();await page.getByRole('button',{name:'결과 보기'}).click();
 await expect(page.locator('.detail-tag')).toHaveText('Nosana GPU 생성');await expect(page.locator('.hotspot')).toHaveCount(0);await expect(page.locator('.detail-info')).toContainText('소재·치수 분석은 준비 중');
 await page.getByRole('button',{name:'내 공간에 저장하기'}).click();await expect(page.getByRole('status')).toContainText('비공개로 저장');expect(saved).toBe(true);
});
