# Nosana 일회성 이미지 생성

구현된 경로: 로그인 → 검증된 책·인물 콘셉트 선택 → `/api/generate` → Nosana SIMPLE deployment 생성 → CUDA SDXL 추론 → 앱에 PNG 업로드 → GPU 작업 정리.

## 구성

- 원본 deployment: `Aa2BjYJuDjS9vbN5rpDrJM2qGF9Ak6fz9esSuFESRcsa`
- API: `https://deployment-manager.k8s.prd.nos.ci` (공식 `@nosana/api` 2.20.0의 경로/스키마 확인)
- API 키 인증: `Authorization: Bearer ...`; 지갑 시드/비밀키는 필요하지 않습니다. 계정의 배포 접근 권한과 결제 잔액은 필요합니다.
- 모델: `stabilityai/stable-diffusion-xl-base-1.0`, FP16 safetensors, 1024×768, 30 steps, 요청별 seed
- 기반 이미지: 공식 PyTorch 2.6 CUDA 12.4 런타임을 SHA-256 digest로 고정
- 컨테이너 레지스트리 계정 없이 실행 가능: 공식 기반 이미지에 고정된 Python 의존성과 내장 worker 코드를 실행합니다. 모델 다운로드/초기화 시간도 작업 실행 시간에 포함될 수 있습니다.
- 요청당 별도 `SIMPLE` deployment, replica 1, 20분 제한, 컨테이너 재시작 없음
- 원본 deployment의 vault를 사용합니다. market이 설정돼 있으면 원본을 따르므로 실제 GPU 사양을 확인해야 합니다. market이 없으면 24GB급 RTX 3090/4090을 요구합니다.

## 설정 적용

보안 환경 변수 `NOSANA_API_KEY`가 실제 실행 환경에 주입돼 있어야 합니다. `NOSANA_DEPLOYMENT_ID`는 위 기본값을 사용하거나 기존 배포 ID로 설정하세요.

```bash
# 검토용 JSON을 생성합니다. 원격에는 적용하지 않습니다.
node scripts/configure-nosana.mjs --write
# 인증 후 원본 Ubuntu deployment를 중지하고 안전한 설정 revision을 적용합니다.
node --env-file-if-exists=.env scripts/configure-nosana.mjs
# 앱 배포. HTTPS callback origin과 만료 시간을 설정하고, 제공된 API 키를
# 서버 프로세스 환경에 전달합니다. 키를 파일·로그·브라우저에 기록하지 않습니다.
node --env-file-if-exists=.env scripts/deploy-daytona.mjs
```

`job-definition.json`은 `LL_SETUP_ONLY=1`인 안전한 설정 템플릿입니다. 원본을 임의로 시작해도 추론을 하지 않으며, 앱이 실제 요청마다 발급하는 토큰이 있어야 이미지를 생성할 수 있습니다. 설정 적용 스크립트는 원본 deployment를 자동 시작하지 않습니다. 실제 앱 요청은 별도 deployment에 동적인 작업 정의를 제출합니다.

## 결과·재시도·개인정보

SQLite `generations` 테이블에 작업 상태/공급자 ID/seed를 저장합니다. 결과는 `DATA_DIR/generated`에 저장합니다. 외부 S3/R2 없이 사용할 수 있으나 sandbox 삭제에 대비한 백업 또는 외부 저장소 전환이 필요합니다.

- 요청별 idempotency key; 중복 클릭은 같은 작업을 반환
- 전체 앱 동시 GPU 작업 1개; 정리 미완료·제출 결과 불명 상태에서도 신규 작업 차단
- 제출 응답이 유실되면 자동 재제출하지 않음: Nosana 콘솔에서 해당 idempotency key/작업 이름을 확인해야 함
- GPU에는 해당 작업만 claim/upload할 수 있는 임시 capability만 전달. Nosana 계정 키는 전달하지 않음
- PNG 형식·해상도·디코딩 검증. 완료 업로드는 멱등 처리
- 개인 생성 이미지는 소유자에게만 제공. 생성 결과를 저장하고 공개한 방만 공개 접근 허용
- 결과 수신/실패 후 provider stop을 재시도하며, 앱 재시작 후에도 미완료 정리를 재개
- 생성 이미지에는 예시 핫스폿/치수를 붙이지 않음. 이미지별 소재·치수 분석은 별도 구현 필요

Daytona의 임시 서명 URL을 callback으로 쓰면 24시간 후 만료됩니다. 만료 25분 전부터 새 GPU 작업을 거절합니다. 장기 운영에는 안정적인 HTTPS 앱 도메인을 `LL_PUBLIC_URL`로 설정하세요. Nosana GPU에서는 앱 origin, PyPI, Hugging Face 모델 파일 호스트와 Docker 이미지 호스트에 접근할 수 있어야 합니다.

## 검증

```bash
npm test
npm run check
npm run build
npx playwright test
# requests==2.32.5가 설치된 별도 venv에서:
python -m unittest discover -s gpu -p 'test_*.py'
# Docker의 Python 의존성 다운로드가 가능한 경우:
docker build --target protocol-test -t literary-living-gpu-protocol gpu
```

Node 테스트는 실제 HTTP/SQLite/PNG 처리와 mock Nosana transport를 사용합니다. Python·CPU Docker 테스트는 실제 모델 추론을 하지 않습니다. **실제 GPU 생성 성공은 API 키 인증, Nosana 설정 적용, CUDA 모델 실행 및 결과 수신을 별도로 검증한 뒤에만 주장해야 합니다.**
