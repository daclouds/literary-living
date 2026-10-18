# Literary Living

책 속 인물에서 영감을 얻는 인테리어 콘셉트 탐색 앱. React + TypeScript + Express + Node SQLite.

## 현재 구현

- 책 제목과 등장인물을 각각 입력하는 폼; 예시 목록 밖의 작품도 Wikidata로 검증
- 콘셉트 상세 화면과 가구별 소재·제안 치수 핫스폿
- 이메일·비밀번호 회원가입/로그인, scrypt 비밀번호 해시, HttpOnly 세션
- 사용자별 비공개 방 저장, 공개 전환, 커뮤니티 갤러리, 삭제
- 반응형 데스크톱/모바일 화면

Nosana 일회성 생성 코드가 구현돼 있습니다. GPU worker, 작업 제출·상태 조회·이미지 수신·개인 저장을 포함합니다. 실제 사용에는 `NOSANA_API_KEY`와 유효한 HTTPS callback 주소, Nosana 계정 권한/잔액이 필요합니다. 누락 시 GPU 작업을 제출하지 않고 503을 반환합니다. [Nosana 설정·검증 안내](nosana/README.md)를 확인하세요.

초기 세 콘셉트 이미지는 미리 제작된 AI 데모입니다. 실제 생성 결과에는 별도로 `GPU 생성 이미지`를 표시하며 예시 가구 핫스폿을 붙이지 않습니다.

세 작품은 오프라인 예시일 뿐 허용 목록이 아닙니다. 다른 작품은 Wikidata의 이름/별칭과 작품–등장인물 관계(P674/P1441), 문학 작품 유형을 확인합니다. 한국어·영어 검색과 다국어 별칭을 지원합니다. 공개 자료의 범위에 따라 실제 작품도 확인되지 않을 수 있으며, 연결 장애는 503, 관계 미확인은 422로 구분합니다. 서버가 www.wikidata.org에 HTTPS 접근할 수 있어야 합니다. 새 작품의 콘셉트도 DB에 보관해 개인 저장·공개 갤러리에서 유지합니다. 새 작품 이미지는 공통 데모임을 표시하며 인물별 생성으로 주장하지 않습니다.

## 실행

Node.js 24+ 필요(내장 `node:sqlite` 사용).

```bash
npm ci
npm run check
npm test
npm run build
npm start
```

기본 포트 3000. `/api/health`로 DB 연결과 생성 연결 상태를 확인합니다. 소스 변경 후 `npm run build`하고 서버를 재시작하세요. SQLite는 `DATA_DIR`(기본 `./data`)에 보존합니다. 서버는 0.0.0.0에 바인딩합니다.

브라우저 검증:

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test
```

Chromium이 없는 환경에서는 Playwright 공식 설치 안내에 따라 브라우저와 시스템 의존성을 설치한 뒤 `playwright.config.ts`의 실행 경로를 설정하세요.

## Daytona 배포

Daytona 공식 `@daytona/sdk` 사용. API 키는 보안 환경 설정으로 주입하고, 노출된 키는 폐기·재발급하세요. `DAYTONA_SANDBOX`는 키가 아닌 기존 sandbox 이름/ID입니다.

```bash
node --env-file-if-exists=.env scripts/deploy-daytona.mjs
```

배포 스크립트는 중지된 sandbox를 시작하고 Node 24+를 확인합니다. 없는 경우 Linux x64에서 공식 Node.js 배포 파일을 다운로드하고 SHA-256을 확인해 사용자 경로에 설치합니다. 이후 로컬 빌드 → 독립 릴리스 디렉터리 업로드 → SHA-256 검증 → production 의존성 설치 → 세션에서 앱 실행 → 내부 health 검사 → 24시간 유효한 서명 URL 발급 및 외부 HTML 응답 확인 순서로 진행합니다. 기존 포트 3000의 서비스를 중지하거나 덮어쓰지 않습니다. 서명 URL은 접근 권한을 가진 링크이므로 공유 범위에 주의하세요. 전체 sandbox를 공개로 바꾸지 않습니다.

재배포 시 기존 literary-living 세션을 확인하여 그 세션만 명시적으로 중지한 뒤 실행하세요. 데이터는 릴리스 디렉터리 바깥 `literary-living/data`에 유지됩니다. sandbox 자동 중지/삭제 시 서비스가 내려가거나 데이터가 손실될 수 있습니다. 실제 운영 전 외부 DB·스토리지, 백업, HTTPS 커스텀 도메인, 이메일 인증·비밀번호 재설정, 분산 rate limit 구성이 필요합니다. 현재는 단일 인스턴스 MVP입니다.

Docker 실행도 가능합니다:

```bash
docker build -t literary-living .
docker run --rm -p 3000:3000 -v literary-living-data:/app/data literary-living
```

## Nosana 작업별 생성

[구성 및 적용 방법](nosana/README.md), [GPU worker](gpu/worker.py), [검토용 작업 JSON](nosana/job-definition.json).

현재 구현과 실제 클라우드 검증을 구분하세요. 자동 테스트가 통과해도 계정 인증과 실제 GPU 결과를 확인하기 전에는 연결 완료로 표시하지 않습니다.
