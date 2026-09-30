# R-020 — 불러오기 옵션·암호·보고서·진입점과 한글 파일 보기 화면 계약

- 상태: REQUIRED (자동 검증 CONFIRMED, Obsidian 실기 E2E는 미완료)
- 작성일: 2026-09-28
- 최종 갱신: 2026-09-28
- 기준 버전/커밋: 작업 브랜치 `2.7.0`, Kordoc 4.15.7
- 관련 문서: R-018(엔진·오프라인 잠금), R-019(언어), 2.7.0 통합 업데이트 계획(W3·W4)
- 담당 범위: `src/io/importOptions.ts`, `src/io/messageCatalog.ts`, `src/io/importRunner.ts`, `src/ui/ImportModal.ts`, `src/ui/ImportReportModal.ts`, `src/ui/HanmarkDocumentView.ts`, `src/io/outputReveal.ts`(기본 앱으로 열기)

## 1. 조사 질문

2.6.1은 `parse(arrayBuffer)`만 불러 옵션·경고·실패 코드를 버렸다. 오프라인 계약을 지키면서 초보자가 이해할 수 있는 결과와 해결 방법을 주려면 불러오기를 어떻게 바꿔야 하는가?

## 2. 범위

### 포함

- 변환 방식(프리셋)과 고급 옵션, 암호 문서, 경고·실패 안내, 결과 보고서
- 진입점(리본·파일 탐색기 메뉴·끌어 놓기·폴더), 저장 위치, 큰 파일, 동시 처리, 중지
- Vault 안 HWP/HWPX를 Obsidian에서 보는 읽기 전용 화면

### 제외

- OCR·수식 OCR(모델 다운로드, R-018 오프라인 잠금), PDF 암호(Kordoc 미지원), 한컴 DRM 해제
- 편집기 위로 끌어 놓기(Obsidian 기본 첨부 동작과 충돌)

## 3. 조사 방법과 증거

| 증거 | 유형 | 재현 또는 위치 | 신뢰도/한계 |
|---|---|---|---|
| `ParseOptions`·`ParseResult`·`ErrorCode`(13)·`WarningCode`(17) | 소스(타입) | `node_modules/kordoc/dist/index.d.ts` | 높음 |
| 암호 지원 형식 | 소스 | `ParseOptions.password` 주석: HWPX(AES-256-CBC)·HWP3(DES) | 높음 |
| 암호 문서 실물 | 재현 | `tests/fixtures/password/HWP5-password-123456.hwpx`(rhwp, MIT) — 암호 없음 → ENCRYPTED, 틀린 암호 → ENCRYPTED, `123456` → 본문 | 높음 |
| 쪽 경계 신뢰도 | 소스 | `DocumentMetadata.pageMode` "layout"/"section" | 높음 |
| 보기 화면 렌더러 | 소스 | `renderDocumentToScene(input, { pages })` — 선택 쪽만 SVG, 원본 형식 "hwpx"/"hwp" | 높음. 매 호출마다 문서를 다시 읽음 |
| 번들 크기 | 재현 | M4 후 3,999,757B(상한 4,010,000B) | 기능 완료 뒤 재측정 필요 |

## 4. 확인된 사실

- 기본 프리셋은 옵션을 넘기지 않으므로 Markdown이 Kordoc 기본 출력과 같다(`toParseOptions(DEFAULT) = {}` 테스트).
- `HanmarkParseOptions`는 `ParseOptions`의 Pick이다. `ocr`·`formulaOcr`·`filePath`·`inlineImages`는 타입에 없어서 어느 호출 지점도 넘길 수 없다(모든 프리셋·토글 조합 테스트).
- Kordoc은 틀린 암호를 성공으로 위장하지 않고 다시 ENCRYPTED를 돌려준다.

## 5. 결정(구현됨)

1. **변환 방식**: 기본(옵션 없음) / 글 위주(`plain`, 그림 저장 안 함) / 서식 문서(`keepTrailingEmptyCols`·`includeFieldPlaceholders`·`keepEmptyParagraphs`) / 시험지·안내문 PDF(`tables:false`). 고급(접힘): 쪽 범위·그림·표 HTML·PDF 머리글 제거·HWP 반복 제목 정리. 고급은 저장하지 않는다(매번 기본값).
2. **안내 카탈로그**: 오류 13·경고 17 코드마다 한/영 제목과 해결 방법. Kordoc 원문은 보고서의 접힌 "원문 메시지(문제 보고용)"에만 둔다. 콘솔 출력은 쓰지 않는다(Community 기준).
3. **암호**: HWPX·HWP3만 암호를 묻는다(최대 3회). 암호는 대화상자 입력칸과 한 번의 변환 호출에만 있고, 닫을 때 입력칸을 비운다. 저장·기록하지 않는다. PDF 암호는 해제 방법을 안내한다.
4. **결과**: `ImportResult`가 형식·쪽 수·쪽 기준·표 수·그림 수·쪽 번호 붙은 경고를 담는다. 실패만 원본 바이트를 보관해 보고서에서 다시 시도한다(성공은 즉시 버림).
5. **보고서**: 단건·다건 공용. 경고 없는 단건 성공은 알림 + 노트 열기로 끝내고, 그 밖에는 보고서를 연다(실패 → 경고 → 성공 → 중지 순).
6. **진입점**: 명령·툴바·새 리본 아이콘 → 불러오기 창(끌어 놓기·파일·폴더). 파일 탐색기 메뉴 "Markdown 노트로 변환"(여러 개 선택 포함), HWP/HWPX에는 "HanMark로 보기". `.hml` 확장자 추가.
7. **저장 위치(설정 v12)**: 현재 노트 폴더(기본, 2.6.1 동작) / 지정 폴더 / 매번 창에서 확인. Vault 안 파일을 변환하면 원본 옆에 만든다. 폴더 경로는 `.obsidian`·절대 경로·`..`를 거부한다.
8. **큰 파일·동시 처리**: 50MB 초과는 확인을 받는다. PDF는 한 번에 하나, 나머지는 둘, 클라우드 이미지 모드는 하나씩. 중지는 진행 중인 파일을 끝낸 뒤 나머지를 건너뛴다.
9. **보기 화면**: `registerExtensions(["hwp","hwpx"])`(설정으로 끔, 재시작 후 적용, 다른 플러그인이 이미 등록했으면 건너뜀). 5쪽씩 지연 렌더, SVG는 미리보기와 같은 정화기(`svgSanitize.ts`)를 거친다. "기본 앱으로 열기"는 HWP/HWPX 확장자만, 기존 단일 프로세스 경계(`runUserProcess`)로 실행한다.
10. **구조**: 변환 실행기(`importRunner.ts`)는 Obsidian 런타임을 import하지 않고, 클라우드 이미지 이전은 주입한다. 그래서 실제 Kordoc으로 Node 테스트가 가능하다.

## 6. 대안과 기각 사유

| 대안 | 장점 | 위험/기각 사유 | 재검토 조건 |
|---|---|---|---|
| 명령이 바로 파일 선택기를 여는 2.6.1 방식 유지 | 한 번 덜 누름 | 옵션·끌어 놓기·폴더·진행 표시를 둘 곳이 없음 | 사용자 피드백 |
| 편집기 위 끌어 놓기로 변환 | 빠름 | Obsidian 첨부 동작과 충돌, 의도하지 않은 변환 | 명시적 수정 키 조합 설계 시 |
| 고급 옵션 저장 | 반복 작업 편함 | 이전 선택이 다음 문서에 조용히 적용되는 혼란 | 요청 시 프리셋 사용자 정의로 |
| 보기 화면에서 전체 쪽 한 번에 렌더 | 구현 단순 | 큰 문서에서 멈춤 | 없음 |

## 7. 한계와 미해결 질문

- Obsidian 실기 E2E(체크리스트 1·7·12)는 사용자 환경에서 확인해야 한다.
- 보기 화면은 "더 보기"마다 문서를 다시 읽는다. 매우 큰 HWP에서 느릴 수 있다.
- 파일 탐색기 메뉴 변환은 알림으로만 진행을 보이며 중지 버튼이 없다(불러오기 창은 있음).
- 테스트 자료(rhwp 암호 문서)의 고지는 THIRD_PARTY_NOTICES에 추가해야 한다(M7).

## 8. 구현 영향

- 설정 v12 키: `importPreset`, `importDestination { mode, folder }`, `openHangulFilesInHanmark`.
- 제거: `src/io/BulkImportReportModal.ts`, `kordocImport.importDocument`(불러오기 창으로 대체). 클라우드 이미지 흐름(`kordocImport.ts`)의 동작은 그대로, 문구만 i18n.
- 보안: 암호 비저장, 폴더 경로 검증, 기본 앱 열기 확장자 제한, 새 프로세스 경계 없음.

## 9. 검증 조건

- 자동: `tests/importFlow.test.ts`(프리셋·화이트리스트·쪽 범위·설정 정규화, 카탈로그 한/영 완전성, 실제 HWPX·PDF 변환, 실물 암호 문서 3단계, 순서·진행·중지, 이름 충돌), `importCloudIntegration`·`importMigration` 갱신, `npm run check`.
- 수동: E2E 체크리스트 1(형식별 불러오기·암호·진입점), 7(보기 화면), 12(큰 파일·중지).

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-09-28 | 작성. M4 구현과 자동 검증(314 tests) 완료 |
