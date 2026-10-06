# 개발 계획 — 기관 공문 템플릿

- 상태: 제안
- 작성일: 2026-10-06
- 기준: HanMark 2.7.0 작업 트리
- PRD: [company-template.md](../prd/company-template.md)
- 스펙: [company-template.md](../spec/company-template.md)
- 연구: [R-029](../research/R-029-company-template-workflow.md)

구현은 스펙의 수용 테스트를 통과하는 순서로 한다. 엔진, 네트워크, 새 패키지는 넣지 않는다.

## 0. 시작 조건

- R-029를 읽고 스펙의 미확정 항목이 없으면 구현을 시작한다. 기본 폴더는 현재 노트 폴더, PDF·DOCX는 이 명령에서 제외, 버전 번호는 릴리스 직전에 정한다.
- 기존 명령 ID와 설정 v12 읽기를 깨는 변경은 하지 않는다.
- 각 단계 끝에 해당 순수 테스트를 실행한다. 마지막에 `npm run check`를 실행한다.

## 1. 순수 모델

새 파일 `src/io/companyTemplate.ts`.

- 스펙 4.2의 문서 스타일 → 공문 양식 초안 변환.
- 등록 기록 정규화, v12 → v13에서 빈 `companyTemplates`.
- 복사할 머리말에서 템플릿 키를 빼고 공문 속성은 유지하는 함수.
- 적용 시 없는 속성만 더하는 함수.
- 내보내기 옵션이 노트 연결을 전역 활성 템플릿보다 먼저 쓰는 순수 선택 함수.

테스트 `tests/companyTemplate.test.ts`에 스펙 12의 순수 항목을 넣는다. 샘플 HWPX가 저장소에 없으면 최소 header.xml을 가진 픽스처를 테스트 안에 만든다. 기관 실물 파일과 개인 경로는 넣지 않는다.

이 단계에서는 Obsidian API를 가져오지 않는다.

## 2. 설정과 경로

- `src/legacy-port/settings.ts`: 스키마 13. v12는 기관 템플릿이 빈 맵이다.
- `src/io/templateLibrary.ts`: `companyTemplates` 읽기·쓰기. 활성 전역 ID 변경 함수는 호출하지 않는다.
- `src/io/formMemory.ts`의 경로 변경·삭제에 `companyTemplateByNote`를 포함한다.
- 문서 스타일 저장과 공문 양식 저장은 기존 `putTemplateRecord`, `putGongmunTemplateInMemory`를 쓴다. 저장 함수에 전역 활성 전환을 강제하는 분기가 있으면, 기관 템플릿 경로에서는 전환하지 않는 인자를 더한다.

테스트: 설정 마이그레이션, 경로 변경 후 연결 유지, 활성 ID 불변.

## 3. 파일에서 초안 만들기

- `create-company-template` 명령.
- 파일 선택은 기존 `FileGateway`의 HWPX 필터.
- 본문과 그림은 `importRunner`의 서식 문서 프리셋.
- 스타일과 표는 스펙 4.1, 4.2.
- 실패 시 노트 파일을 남기지 않는다. 암호는 기존 대화상자를 쓰고 저장하지 않는다.
- 초안 노트를 연 뒤 알림 한 줄.

UI 문구와 명령 등록은 `src/main.ts`, `src/i18n/ko.ts`, `src/i18n/en.ts`.

## 4. 등록과 새 문서

- 등록 모달: 이름, 종류, 기관명, 결재란. 종류 후보는 스펙 5의 단어 목록으로만 제안한다.
- 새 문서: 볼트에 노트 생성, 연결, 공문 미리보기 오픈. 미리보기 모드는 기존 `hwpxPreviewMode`의 공문 분기를 노트 연결의 양식으로 연다.
- 템플릿 관리 창에 기관 템플릿 목록을 더한다. 행에는 이름, 문서 종류, 새 문서, 삭제가 있다.

## 5. 적용과 내보내기

- 작업 노트의 내보내기와 빠른 미리보기가 `companyTemplateByNote`의 문서 스타일 ID와 공문 양식 ID를 쓴다.
- 문서 스타일 편집은 그 노트에 연결이 있으면 그 프로필을 연다. 저장은 그 프로필만 갱신한다.
- 연결이 없는 노트는 현재 `HanmarkExportModal` 경로와 같은 옵션이다. 회귀 테스트로 고정한다.
- 공문서 내보내기 창과 HWPX 템플릿 관리에 **회사 템플릿 만들기**를 둔다.

## 6. 검증

1. `tests/companyTemplate.test.ts`
2. 설정 마이그레이션과 명령 ID 존재 테스트. 기존 명령 ID 목록은 스냅샷으로 줄지 않았는지 확인한다.
3. `npm run check`
4. 수동: 샘플 HWPX 등록, 새 문서, 미리보기, HWPX를 한컴오피스에서 열어 바탕글과 제목 스타일 확인. 네트워크를 끈 상태. 다른 노트의 활성 템플릿이 바뀌지 않았는지 확인. 직인 그림이 본문 그림으로만 들어가는지 확인.

번들이 4,305,000바이트를 넘으면 기능을 더 넣기 전에 상한 변경을 별도 연구 문서로 올린다. 이번 계획 안에서는 상한을 올리지 않는다.

## 7. 순서와 예상 변경

| 단계 | 끝나는 조건 | 주로 건드리는 파일 |
|---|---|---|
| 1 | 순수 테스트 통과 | `src/io/companyTemplate.ts`, `tests/companyTemplate.test.ts` |
| 2 | v12 읽기, 경로 갱신, 활성 ID 불변 | `settings.ts`, `templateLibrary.ts`, `formMemory.ts` |
| 3 | HWPX 초안 노트와 스타일 기록 | `main.ts`, `importRunner.ts` 호출부, i18n |
| 4 | 등록, 복사, 미리보기 | 새 등록 모달, `QuickHwpxPreviewView.ts` |
| 5 | 노트별 내보내기, 스타일 편집 칸이 채워짐 | `kordocSave.ts`, `HanmarkExportModal.ts`, `DocumentStyleModal.ts` |
| 6 | `npm run check`와 수동 목록 | 릴리스 노트는 버전을 정한 뒤 |

`src/io/gongmunStyle.ts`의 정규화 규칙은 바꾸지 않는다. 범위 밖 값을 걸러 내는 쪽은 기관 템플릿 변환 함수다.

## 8. 위험

- 전역 활성 템플릿을 바꾸는 기존 저장 함수를 그대로 호출하면 다른 노트의 내보내기가 바뀐다. 단계 2의 테스트가 막는다.
- 공문 여백을 HWP 단위 그대로 넣으면 5–60mm 검사에서 빠지거나 잘못된 여백이 된다. 변환은 스펙의 상수만 쓰고, 범위 밖은 생략한다.
- 템플릿 노트와 작업 노트를 같은 파일로 두면 기안이 원본 양식을 고친다. 복사는 항상 새 파일이다.
- 2.6.1에 설치되어 있는 플러그인에는 이 명령이 없다. 수동 확인은 2.7.0 작업 트리를 빌드한 Obsidian에서 한다.

## 9. 하지 않는 단계

- 직인 좌표, 표지 복제, `.hwp` 저장, AI 호출, 템플릿 서버.
- 기존 양식 채워 저장의 필드 채우기 변경.
- 한림대 내장 양식의 마감 코드 변경.
