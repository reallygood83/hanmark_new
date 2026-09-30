# Third-Party Notices

## English

### Kami

HanMark's **Achmage Editorial** HTML theme adapts selected document-design principles from [Kami](https://github.com/tw93/kami).

- Upstream project: Kami
- Upstream author and copyright: Copyright (c) 2026 Tw93
- Upstream license: [MIT License](https://github.com/tw93/kami/blob/main/LICENSE)
- HanMark use: a small, static, dependency-free adaptation of selected editorial layout and styling ideas

HanMark does not redistribute the Kami package, its template collection, Python or WeasyPrint build tools, example documents, Source Han font files, or commercial TsangerJinKai font files. Generated Achmage Editorial HTML includes a concise attribution comment and contains no external font, CDN, or script dependency.

The Kami project and its authors are not responsible for HanMark or for HanMark-generated documents.

#### MIT License text

Copyright (c) 2026 Tw93

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Pretendard

HanMark embeds Pretendard weights 400 and 600 in `styles.css` for the built-in
Editorial PDF layout.

- Upstream project: [Pretendard](https://github.com/orioncactus/pretendard)
- Upstream author and copyright: Copyright (c) 2021 Kil Hyung-Jin
- Distribution source: `@fontsource/pretendard` 5.3.0
- License: SIL Open Font License 1.1
- CSS family alias: `HanMark Pretendard`
- Weight 400 WOFF2 SHA-256: `fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63`
- Weight 600 WOFF2 SHA-256: `c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0`

`scripts/gen-font-css.mjs` verifies the exact Fontsource package version,
license identifier, and both hashes before regenerating the stylesheet. The
font bytes are embedded unchanged. The complete SIL Open Font License 1.1 text
is copied into the generated Pretendard block in `styles.css`, immediately
before the two `@font-face` declarations.

### Software bundled in `main.js`

`main.js` is one esbuild bundle. It contains the following npm packages at the
versions pinned by `package-lock.json` (HanMark 2.7.0). HanMark uses JSZip under
the MIT option of its dual license.

| Package | Version | License | Copyright |
|---|---|---|---|
| pdfjs-dist (PDF.js) | 4.10.38 | Apache-2.0 | Mozilla Foundation |
| kordoc | 4.15.7 | MIT | Copyright (c) 2026 chrisryugj |
| docx-preview | 0.4.0 | Apache-2.0 | Volodymyr Baydalka |
| @xmldom/xmldom | 0.9.12 (Kordoc) and 0.8.15 | MIT | Copyright 2019 - present Christopher J. Brody and other contributors; Copyright 2012 - 2017 @jindw and other contributors |
| entities | 4.5.0 | BSD-2-Clause | Copyright (c) Felix Böhm |
| markdown-it | 14.3.0 | MIT | Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin |
| markdown-it-footnote | 4.0.0 | MIT | Copyright (c) 2014-2015 Vitaly Puzrin, Alex Kocharin |
| linkify-it | 5.0.2 | MIT | Copyright (c) 2015 Vitaly Puzrin |
| mdurl | 2.0.0 | MIT | Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin |
| uc.micro | 2.1.0 | MIT | Copyright Mathias Bynens |
| punycode.js | 2.3.1 | MIT | Copyright Mathias Bynens |
| pako | 1.0.11 | MIT and Zlib | Copyright (C) 2014-2017 Vitaly Puzrin and Andrei Tuputcyn; zlib (C) 1995-2013 Jean-loup Gailly and Mark Adler |
| jszip | 3.10.1 | MIT (dual MIT or GPL-3.0-or-later) | Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso |
| cfb | 1.2.2 | Apache-2.0 | SheetJS LLC |
| readable-stream | 2.3.8 | MIT | Copyright Node.js contributors |
| core-util-is | 1.0.3 | MIT | Copyright Node.js contributors |
| lie | 3.3.0 | MIT | Copyright (c) 2014-2018 Calvin Metcalf, Jordan Harband |
| process-nextick-args | 2.0.1 | MIT | Copyright (c) 2015 Calvin Metcalf |
| setimmediate | 1.0.5 | MIT | Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola |
| immediate | 3.0.6 | MIT | Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, Domenic Denicola, Brian Cavalier |
| safe-buffer | 5.1.2 | MIT | Copyright (c) Feross Aboukhadijeh |
| inherits | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter |
| isarray | 1.0.0 | MIT | Julian Gruber |
| util-deprecate | 1.0.2 | MIT | Copyright (c) 2014 Nathan Rajlich |

Of the Apache-2.0 packages, only Kordoc ships a NOTICE file; its attributions
are reproduced in the next section. The Apache License 2.0 text is available at
<https://www.apache.org/licenses/LICENSE-2.0>.

#### Work that Kordoc derives from (from Kordoc's NOTICE)

- **OpenDataLoader PDF** — Copyright 2025-2026 Hancom, Inc. — Apache License 2.0.
  Line-based and cluster-based PDF table detection, rewritten in TypeScript.
- **hml-equation-parser** — Copyright 2018 Open Bapul — Apache License 2.0.
  HWPX equation script to LaTeX conversion, rewritten in TypeScript.
- **rhwp** — Copyright 2025-2026 Edward Kim — MIT License. Lenient CFB reading
  and distribution-document decryption (rewritten in TypeScript), and the two
  standard draft letter forms described below.
- **claw-hwp** — Copyright (c) 2026 DoHyun468 — MIT License. Chart XML
  generation, form-matching rules, and validation checks.
- **Pix2Text** (MIT) and **PaddleOCR PP-OCRv5** (Apache License 2.0) — Kordoc's
  optional OCR code. It is present in the bundle but HanMark never calls it:
  no OCR option is ever passed, no model is downloaded, and no model weights are
  redistributed.

#### Embedded data

- **Standard draft letter forms** (일반기안문 and 간이기안문, forms No. 1 and 2
  of the Korean administrative efficiency regulation) — from rhwp `tools/forms`
  as bundled by Kordoc — Copyright 2025-2026 Edward Kim — MIT License. The two
  HWPX files are embedded unchanged (base64) in `src/io/formTemplateData.ts` by
  `scripts/gen-form-templates.mjs`. The underlying form layout is a statutory
  Korean public form.
- **Korean PDF CMaps** — 24 CMap files (Adobe-Korea1, UniKS, KSC and KSCms
  encodings) from `pdfjs-dist/cmaps`, embedded unchanged (base64) in
  `src/io/pdfCMapData.ts` by `scripts/gen-pdf-cmaps.mjs`. Copyright 1990-2009
  Adobe Systems Incorporated, under the license reproduced below.

#### Test fixture (not part of `main.js`)

- `tests/fixtures/password/HWP5-password-123456.hwpx` — an rhwp sample (MIT) used
  through Kordoc's test assets; see the README in that folder.

#### MIT License

The MIT License applies to the MIT packages above with their own copyright lines:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

#### BSD 2-Clause License (entities)

Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#### zlib License (pako)

(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use
of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.

#### ISC License (inherits)

Copyright (c) Isaac Z. Schlueter

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

#### Adobe CMap license (Korean PDF CMaps)

Copyright 1990-2009 Adobe Systems Incorporated.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

Neither the name of Adobe Systems Incorporated nor the names of its
contributors may be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## 한국어

### Kami

HanMark의 **Achmage Editorial** HTML 테마는 [Kami](https://github.com/tw93/kami)의 문서 디자인 원칙 일부를 응용했습니다.

- 원 프로젝트: Kami
- 원 저작자와 저작권: Copyright (c) 2026 Tw93
- 원 라이선스: [MIT License](https://github.com/tw93/kami/blob/main/LICENSE)
- HanMark의 사용 범위: 편집 레이아웃과 스타일 아이디어 일부를 작고 정적인 무의존성 테마로 재구성

HanMark는 Kami 패키지, 템플릿 모음, Python·WeasyPrint 빌드 도구, 예제 문서, Source Han 글꼴 파일 또는 상업용 TsangerJinKai 글꼴 파일을 재배포하지 않습니다. 생성된 Achmage Editorial HTML에는 간단한 저작자 표시 주석이 들어가며 외부 글꼴·CDN·스크립트 의존성이 없습니다.

Kami 프로젝트와 원 저작자는 HanMark 또는 HanMark가 생성한 문서에 책임을 지지 않습니다.

### Pretendard

HanMark는 내장 Editorial PDF 레이아웃을 위해 Pretendard 400·600 굵기를
`styles.css`에 포함합니다.

- 원 프로젝트: [Pretendard](https://github.com/orioncactus/pretendard)
- 원 저작자와 저작권: Copyright (c) 2021 Kil Hyung-Jin
- 배포 출처: `@fontsource/pretendard` 5.3.0
- 라이선스: SIL Open Font License 1.1
- CSS 글꼴 별칭: `HanMark Pretendard`
- 400 WOFF2 SHA-256: `fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63`
- 600 WOFF2 SHA-256: `c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0`

`scripts/gen-font-css.mjs`는 스타일시트를 다시 만들기 전에 정확한 Fontsource
패키지 버전·라이선스 식별자·두 해시를 검증합니다. 글꼴 바이트는 변경하지
않고 포함하며, SIL Open Font License 1.1 전문은 두 `@font-face` 선언 바로
앞의 `styles.css` 생성 블록 안에 함께 기록합니다.

### `main.js`에 포함된 소프트웨어

`main.js`는 esbuild로 묶은 파일 하나입니다. HanMark 2.7.0의 `package-lock.json`이
고정한 판의 npm 패키지 25개가 들어 있으며, 패키지·판·라이선스·저작권 표시는 영어
절의 표와 같습니다. JSZip은 이중 라이선스 중 MIT를 따릅니다. Apache-2.0 패키지
가운데 NOTICE 파일이 있는 것은 Kordoc뿐이며 그 내용을 아래에 옮깁니다.

#### Kordoc이 바탕으로 삼은 저작물 (Kordoc NOTICE)

- **OpenDataLoader PDF** — Copyright 2025-2026 Hancom, Inc. — Apache License 2.0.
  선 기반·군집 기반 PDF 표 인식(TypeScript로 재작성).
- **hml-equation-parser** — Copyright 2018 Open Bapul — Apache License 2.0.
  HWPX 수식 스크립트 → LaTeX 변환(TypeScript로 재작성).
- **rhwp** — Copyright 2025-2026 Edward Kim — MIT License. 손상 CFB 읽기와
  배포용 문서 복호화(TypeScript로 재작성), 아래 표준 기안문 서식 2종.
- **claw-hwp** — Copyright (c) 2026 DoHyun468 — MIT License. 차트 XML 생성,
  양식 대응 규칙, 검증 항목.
- **Pix2Text**(MIT)·**PaddleOCR PP-OCRv5**(Apache License 2.0) — Kordoc의 선택형
  OCR 코드입니다. 번들 안에 있지만 HanMark는 호출하지 않습니다. OCR 옵션을 넘기지
  않고, 모델을 내려받지 않으며, 모델 가중치를 재배포하지 않습니다.

#### 내장 데이터

- **표준 기안문 서식**(일반기안문·간이기안문, 「행정 효율과 협업 촉진에 관한 규정
  시행규칙」 별지 제1·2호서식) — Kordoc이 묶은 rhwp `tools/forms` 자산 — Copyright
  2025-2026 Edward Kim — MIT License. `scripts/gen-form-templates.mjs`가 HWPX 두 개를
  바꾸지 않고 `src/io/formTemplateData.ts`에 base64로 넣습니다. 서식 배치 자체는
  법령 부속 공공 서식입니다.
- **한국어 PDF CMap** — `pdfjs-dist/cmaps`의 CMap 24개(Adobe-Korea1·UniKS·KSC·KSCms
  인코딩). `scripts/gen-pdf-cmaps.mjs`가 바꾸지 않고 `src/io/pdfCMapData.ts`에
  base64로 넣습니다. Copyright 1990-2009 Adobe Systems Incorporated, 라이선스
  전문은 영어 절에 있습니다.

#### 시험 자료 (`main.js`에 들어가지 않음)

- `tests/fixtures/password/HWP5-password-123456.hwpx` — Kordoc 시험 자산으로 쓰인
  rhwp 예제(MIT). 해당 폴더의 README를 보세요.

MIT·BSD 2-Clause(entities)·zlib(pako)·ISC(inherits)·Adobe CMap 라이선스 전문은
영어 절에 원문 그대로 실었습니다.
