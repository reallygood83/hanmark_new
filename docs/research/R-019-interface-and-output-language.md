# R-019 — 화면 언어(한/영)와 출력 문서 언어 계약

- 상태: REQUIRED (구조·검사는 CONFIRMED, 기존 문구 이전은 진행 중)
- 작성일: 2026-09-28
- 최종 갱신: 2026-09-28
- 기준 버전/커밋: 작업 브랜치 `2.7.0`(R-018 이후), Obsidian API 1.13.1 타입, eslint-plugin-obsidianmd 0.4.1
- 관련 문서: R-006, R-009, R-018, 2.7.0 통합 업데이트 계획(W9)
- 담당 범위: `src/i18n/`, 설정 v12, `scripts/check-i18n.mjs`, 영어 문구 lint, 출력 문서에 적는 말의 언어

## 1. 조사 질문

한국어가 기본인 HanMark에 영어 화면을 더하면서, 한국어 사용자의 화면·출력은 그대로 두고, 같은 노트가 어느 PC에서나 같은 문서로 나오게(제품 계약 3) 하려면 언어를 어떻게 정하고 문구를 어떻게 관리해야 하는가?

## 2. 범위

### 포함

- 화면 언어 결정(자동/한국어/English)과 적용 시점
- 출력 문서에 HanMark가 직접 적는 말(콜아웃 제목, 임베드 자리표시, HTML `lang`)의 언어 결정
- 문구 표 구조, 자리표시 검사, 한글 문자열 추적 기준선, 영어 문장형 대소문자 검사

### 제외

- Kordoc 엔진이 만드는 경고 문장의 번역(오류·경고 카탈로그에서 다룬다, W2·W3)
- 한국어·영어 외 언어

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| `getLanguage()` 선언 | 소스(API 타입) | `node_modules/obsidian/obsidian.d.ts` — "@since 1.8.7", 기본값 'en' | 높음. minAppVersion 1.8.9라 항상 존재 |
| `prefer-get-language` 규칙 | 소스(lint) | eslint-plugin-obsidianmd 0.4.1 `preferGetLanguage.js` — `localStorage.getItem("language")`·i18next 감지기 금지 | 높음 |
| `sentence-case-locale-module` 규칙 | 소스(lint) | 같은 패키지 `ui/sentenceCaseLocaleModule.js`, `sentenceCaseUtil.js` | 높음. 경로가 `en.ts` 등 영어 locale 파일일 때만 동작, 권장 설정에서 warn |
| 규칙 옵션 의미 | 소스 | `normalizeOptions`: `brands`·`acronyms`를 주면 기본 목록을 **대체**한다. `{…}` 자리표시가 있는 문자열은 검사하지 않는다 | 높음 |
| 규칙 동작 확인 | 재현 | `en.ts`의 "Manage templates"를 "Manage Templates"로 바꾸면 CLI가 오류 1건(38:31)을 보고 | 높음 |
| 한글 문자열 수 | 재현 | `node scripts/check-i18n.mjs --update-baseline` → 34개 파일 1,188개(이전 대상), 이전 완료 파일 0개 | 높음. 문자열 노드 단위 |

## 4. 확인된 사실

- Obsidian은 앱 언어 코드를 `getLanguage()`로 준다. 한국어는 `ko`다(obsidian-translations 목록).
- 커뮤니티 lint는 영어 locale 모듈의 문자열에 문장형 대소문자(첫 글자만 대문자, 제품명·약어 예외)를 요구한다. 권장 설정이 warn이고 HanMark lint는 `--max-warnings 0`이라 사실상 오류다.
- 규칙에 제품명·약어 목록을 넘기면 기본 목록이 사라진다. 기본 목록을 펼쳐 넣어야 Obsidian·Windows·PDF 같은 기본 예외가 유지된다.
- 명령 이름과 리본 설명은 `onload`에서 한 번 등록된다. 실행 중 언어를 바꿔도 이미 등록된 이름은 바뀌지 않는다.
- 2.6.1까지 콜아웃 제목("참고", "주의" 등), 임베드 자리표시("[임베드: …]"), HTML `lang="ko"`는 언제나 한국어였다.

## 5. 결정(구현됨)

1. **문구 표**: `src/i18n/ko.ts`가 기준이다. `en.ts`는 `MessageTable` 타입이라 키가 빠지거나 남으면 컴파일이 실패한다. `t(key, params)`의 자리표시는 한국어 문구의 `{이름}`에서 타입으로 뽑아, 빠진 인자도 컴파일 오류가 된다. 영어 복수형은 `{ one, other }`를 `count`로 고른다.
2. **화면 언어**: 설정 `uiLanguage` = `auto`(기본) | `ko` | `en`. `auto`는 `getLanguage()`가 `ko`(또는 `ko-…`)면 한국어, 그 밖에는 영어다. 새 창·알림·설정 화면은 즉시 바뀌고, 명령 이름·리본 설명은 재시작 뒤 바뀐다(설정 설명과 알림으로 안내).
3. **출력 문서 언어**: 설정 `outputLanguage` = `auto`(기본) | `ko` | `en`. `auto`는 **문서 내용**으로 정한다. 한글이 있으면 한국어, 없으면 영어다.
	- 계획서는 기본값을 "UI 언어"로 적었다. 이를 바꾼 이유: UI 언어는 PC의 Obsidian 설정이라, 같은 노트가 PC마다 다른 문서로 나온다(제품 계약 3 위반). 문서 내용 기준은 PC와 무관하다.
	- 한국어 노트의 출력은 2.6.1과 같다(콜아웃 제목·자리표시·`lang="ko"` 불변). 한글이 전혀 없는 노트만 영어 제목과 `lang="en"`이 된다. 설정에서 한국어로 고정할 수 있다.
4. **언어 이름**: 선택지의 "한국어"·"English"는 모든 화면 언어에서 제 언어로 표시한다. 언어 설정 제목은 두 언어를 병기한다("언어 (Language)" / "Language (언어)").
5. **설정 v12**: `uiLanguage`, `outputLanguage`, `previewAutoPause`(M2의 느린 미리보기 자동 멈춤을 끌 수 있게)를 추가한다. 기존 키와 화면 구성은 그대로다.
6. **검사**
	- `scripts/check-i18n.mjs`(npm run check에 포함): 두 표의 키·자리표시 일치, 영어 문구에 괄호 밖 한글 없음, 쓰이지 않는 키 없음.
	- 같은 스크립트가 `src/` 속 한글 문자열을 파일별로 세어 `scripts/i18n-baseline.json`과 **정확히** 비교한다. 늘면 실패, 줄면 기준선을 낮추라고 실패한다. 글꼴 이름처럼 본래 한국어인 데이터는 `i18n-data` 표시로 제외한다.
	- `eslint.config.mjs`: `src/i18n/en.ts`에 `sentence-case-locale-module`을 error로 두고, HanMark 제품·형식 이름(HanMark, Kordoc, Pandoc, Hancom, Hangul, HWPX, DOCX 등)을 기본 목록에 더했다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| i18next + 언어 감지기 | 널리 쓰임 | 의존성 추가, 감지기는 커뮤니티 lint가 금지 | 언어가 셋 이상으로 늘 때 |
| JSON 언어 파일 | 번역가 친화 | 키·자리표시 타입 검사 불가, 번들에 별도 로더 필요 | 외부 번역 기여를 받을 때 |
| 출력 언어 auto = 화면 언어 | 계획서 원안, 단순 | 같은 노트의 출력이 PC 설정마다 달라짐 | 없음(제품 계약 3) |
| 명령 이름 즉시 재등록 | 재시작 불필요 | 명령 ID 재등록은 단축키·팔레트 기록과 충돌 위험 | Obsidian이 이름 갱신 API를 제공할 때 |

## 7. 한계와 미해결 질문

- 이전 완료(M7): 화면 문구는 모두 `src/i18n`에 있고 기준선은 비어 있다(1,412키, 남은 한국어 문자열 0). `check-release`가 빈 기준선을 요구한다.
- 영어 문구는 원어민 검토를 거치지 않았다. 용어는 계획서 용어표를 따른다.
- 한국어로 남는 데이터(`i18n-data`): 글꼴 이름·글꼴 대체 표, 한글 글리프 검사용 견본, HWPX 스타일 이름(바탕글·제목 N), 공문서 글머리 기호, 예전 가져오기 표지 콜아웃(옛 노트 정리용 정규식이 원문 그대로 찾음), 저장값으로 쓰는 내장 이름. 내장 HWPX 템플릿과 내장 PDF 테마는 저장 이름을 한국어로 두고 화면에만 언어별 이름을 보인다(`templateDisplayName`, `editorialPdfThemeDisplayName`). 이름을 읽지 못한 사용자 글꼴 파일의 대체 글꼴 이름("사용자 글꼴")은 저장·중복 판정에 쓰여 영어 화면에서도 한국어로 보인다.
- 편집기에 넣는 자리표시(링크 텍스트·표 머리·콜아웃 제목 등)는 사용자가 바로 고쳐 쓰는 값이라 화면 언어를 따른다. 출력 문서에 쓰는 글(HTML 할 일 표시, PDF 대체 라벨, 누락 이미지 표시, 대조표·양식 노트)은 출력 언어를 따른다.
- Kordoc 엔진에서 오는 일부 문장(공문서 표기 점검 메시지, HWPX 검증 세부 내용)은 한국어로만 온다. 가져오기 오류·경고는 코드별 카탈로그로, 알 수 없는 글꼴 경고는 `isKnownFont`로 HanMark가 직접 만든다.
- 영어로만 된 하위 계층 문장 가운데 사용자에게 보일 수 있는 것(외부 프로그램 없음·시간 초과, Pandoc 결과 없음, Word 미리보기 Windows 전용, 파일 선택 개수, Word 템플릿 이름·JSON 오류, Chromium 버전)은 옮겼다. PDF 인쇄 단계 내부 오류는 개인정보 보호로 2.5.3부터 단계 이름과 오류 종류만 보이므로 영어로 둔다.

## 8. 구현 영향

- 변경 파일: `src/i18n/*`, `src/legacy-port/settings.ts`(v12), `src/main.ts`(언어 결정·연결), `src/ui/HanmarkSettingTab.ts`(전체 이전 + 언어 절), `src/ui/QuickHwpxPreviewView.ts`, `src/ui/dialogs.ts`, `src/io/markdownAdapter.ts`, `src/io/kordocEngine.ts`, `src/io/fontGuide.ts`, `src/io/legacyEngine.ts`, `src/io/kordocSave.ts`, `src/io/docxExport.ts`, `src/io/editorialPdfLayout.ts`, `src/legacy-port/htmlExport.ts`, `src/utils/errors.ts`, `eslint.config.mjs`, `package.json`(check-i18n)
- 불변조건: 한국어 화면·한국어 노트 출력은 2.6.1과 같다. 명령 ID는 바뀌지 않는다. 기본 경로는 네트워크를 쓰지 않는다.
- 마이그레이션: v11 → v12, 새 키만 기본값으로 추가(멱등).
- 보안·개인정보: 없음(언어 코드만 읽음).

## 9. 검증 조건

- 자동 테스트: `tests/i18n.test.ts`(언어 결정, 자리표시·복수형, 두 표 일치, 문서 기준 출력 언어, 콜아웃·임베드·HTML `lang`, 설정 v12 멱등), `npm run check` 전체.
- 수동 테스트: Obsidian 언어를 English로 바꾸고 재시작 → 명령·설정·알림·미리보기가 영어인지, 설정에서 한국어로 고정 후 즉시 바뀌는지(E2E 체크리스트 10).
- 완료 기준: 키 동수·자리표시 일치, 기준선 0(출시 전), 영어 문장형 lint 오류 0.

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-09-28 | 작성. M3 구조·검사·설정 화면·미리보기·글꼴 안내·어댑터 이전 완료, 전체 check 통과(300 tests) |
| 2026-09-28 | M7: 남은 932개 문자열(28개 파일)을 영역별로 이전해 기준선 0, 1,412키. 내장 이름의 표시 전용 라벨, 외부 프로그램·하위 계층 오류 현지화, `check-i18n --list` 이전 도구, `check-release`의 빈 기준선 관문 추가. 전체 check 통과(373 tests) |
