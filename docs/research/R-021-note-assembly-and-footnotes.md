# R-021 — 노트 조립(임베드 합치기)과 HTML·PDF 각주 계약

- 상태: REQUIRED (자동 검증 CONFIRMED, Obsidian 실기 E2E 미완료)
- 작성일: 2026-09-28
- 최종 갱신: 2026-09-28
- 기준 버전/커밋: 작업 브랜치 `2.7.0`, markdown-it 14.3.0, markdown-it-footnote 4.0.0
- 관련 문서: R-006(기본 출력 보존), R-018, R-019(출력 언어), 2.7.0 통합 업데이트 계획(W6·W10)
- 담당 범위: `src/io/noteAssembly.ts`, `src/io/exportPreparation.ts`, `src/io/vaultAssemblyHost.ts`, `src/io/editorialDocument.ts`

## 1. 조사 질문

`![[노트]]`가 내보내기에서 이름만 남는 문제를 모든 형식에서 같은 방식으로 풀고, HTML·PDF에서도 각주가 HWPX·DOCX처럼 살아 있게 하려면 무엇을 어디서 바꿔야 하는가? 기존 출력(R-006)은 어떻게 보존하는가?

## 2. 범위

### 포함

- 노트 전체·제목 구역·블록 임베드, 중첩, 순환, 누락, 깊이 한도, 포함된 노트의 그림 경로
- HWPX·DOCX·HTML·Editorial PDF·빠른 미리보기(DOCX 간이 미리보기는 Obsidian 렌더러가 임베드를 직접 그림)
- Editorial HTML·PDF 각주

### 제외

- Classic HTML 테마의 각주(2.6.1 동작 유지), 그림이 아닌 파일 임베드(PDF·오디오)의 내용 삽입, 예전 노트 패치 경로

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| 내보내기 본문 추출 지점 6곳 | 소스 | kordocSave(HWPX), QuickHwpxPreviewView, main(HTML·PDF), docxExport | 높음 |
| 그림 로더의 경로 해석 | 소스 | `obsidianImageLoader`: `getFirstLinkpathDest(path, 루트 노트) ?? getAbstractFileByPath(path)` → Vault 절대 경로는 어디서든 해석 | 높음 |
| markdown-it-footnote 토큰 | 소스 | `footnote_ref`(인라인, meta.id), 문서 끝 `footnote_block_open`…`footnote_open`/`footnote_anchor`/`footnote_close`…`footnote_block_close` | 높음 |
| 정의 없는 참조 | 재현 | `[^x]`는 정의가 없으면 글자 그대로 남음(테스트) | 높음 |

## 4. 확인된 사실

- 2.6.1 어댑터는 `![[노트]]`를 `[임베드: 이름]`으로 바꾸고 경고만 냈다. HTML·PDF는 임베드를 따로 처리하지 않았다.
- Editorial HTML과 PDF는 같은 문서 모델(`parseEditorialDocument`)을 쓴다. 이 모델에는 윗첨자 인라인과 순서 목록 블록이 이미 있다.

## 5. 결정(구현됨)

1. **한 단계, 모든 형식**: `prepareExportMarkdown(host, 본문, 경로, { assembleEmbeds, outputLanguage })`를 모든 생성 경로가 한 번 거친다. 설정 `assembleEmbeds`(기본 켜짐)를 끄면 2.6.1처럼 이름만 남는다.
2. **순수 모듈**: `assembleNote`는 링크 해석과 파일 읽기만 주입받는다(`vaultAssemblyHost`가 Obsidian 메타데이터 캐시·`cachedRead`로 제공). 그래서 Node 테스트로 모든 사례를 검증한다.
3. **해석 규칙**
	- 전체 임베드는 머리말(YAML)을 빼고 넣는다. `#제목`은 그 제목부터 같거나 높은 단계의 다음 제목 전까지, `#제목#하위`는 마지막 제목을 쓴다. `#^블록`은 문단·목록 항목·단독 표시줄 앞 블록을 넣고 표시(`^id`)는 지운다.
	- 인용·콜아웃 안의 임베드는 줄마다 같은 `>` 접두어를 붙인다. 글 사이의 임베드는 앞글·내용·뒷글을 각각 블록으로 나눈다. 목록 기호만 남는 줄은 버린다.
	- 코드 블록과 인라인 코드 안, 그림·PDF 같은 노트가 아닌 임베드는 건드리지 않는다.
	- 포함된 노트의 그림(`![[그림]]`, `![](상대 경로)`)은 Vault 경로로 바꿔 루트 노트 기준 로더가 찾게 한다. 원격 URL은 그대로 둔다.
4. **안전장치**: 순환(같은 노트·구역 재진입), 누락 노트, 없는 제목·블록, 깊이 한도(기본 10)는 문서에 **보이는 자리표시**(출력 언어, R-019)와 경고로 남긴다. 경고는 HWPX 보고서·미리보기 안내·HTML/PDF/DOCX 알림에 나온다.
5. **각주**: markdown-it-footnote 4.0.0을 정확히 고정해 Editorial 파서에 붙였다. 참조는 기존 윗첨자 인라인(번호)으로, 정의는 본문 끝의 구분선 + 번호 목록으로 바꾼다. 렌더러(HTML·PDF)는 바꾸지 않았다.
6. **R-006 보존**: 각주 문법이 없는 문서는 토큰이 같으므로 모델·출력이 같다(테스트). 기존 PDF·HTML 기준 테스트는 모두 통과했다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| 형식별로 임베드 처리 | 형식 특화 | 결과가 형식마다 달라짐, 중복 코드 | 없음 |
| 메타데이터 캐시의 제목·블록 위치 사용 | Obsidian과 같은 해석 | 캐시 시점 차이, 테스트 불가 | 캐시 기반 오차가 보고될 때 |
| PDF 쪽 하단 각주 | 인쇄물다움 | Chromium이 CSS 각주 배치를 지원하지 않음 | 지원될 때 |
| 각주 전용 DOM 요소 추가 | 뒤로 가기 링크 | 렌더러 두 곳 수정, R-006 위험 | 사용자 요청 시 |

## 7. 한계와 미해결 질문

- 루트 노트 자신의 구역 임베드(`![[#제목]]`)는 저장된 파일 내용을 읽는다(편집 중 미저장 내용은 반영 안 됨).
- 임베드된 노트가 바뀌어도 빠른 미리보기는 자동 갱신하지 않는다(수동 갱신 시 반영).
- Obsidian 실기 E2E(체크리스트 4·8)는 사용자 환경에서 확인해야 한다.

## 8. 구현 영향

- 설정 v12: `assembleEmbeds`(기본 true). 어댑터 경고 코드: `file-embed-flattened`, `embed-missing/cycle/depth/section`.
- 의존성: `markdown-it-footnote` 4.0.0(MIT, 의존성 없음) — `check-release` 고정 목록에 추가.

## 9. 검증 조건

- 자동: `tests/noteAssembly.test.ts`(14건: 전체·제목·블록·중첩·순환·누락·깊이·언어·그림 경로·코드·인용·인라인), `tests/editorialFootnotes.test.ts`(4건), 기존 editorial·PDF·HTML 기준 테스트.
- 수동: E2E 4(네 형식 + 미리보기), 8(HTML·PDF 각주, 각주 없는 문서의 R-006 동일성).

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-09-28 | 작성. M5 노트 조립·각주 구현과 자동 검증(341 tests) 완료 |
