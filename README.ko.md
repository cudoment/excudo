# Excudo

[English](README.md) | 한국어 | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

**전기는 공짜가 아니니까, AI도 전기값은 해야지.**

Excudo(엑스쿠도, 패키지 `excudo`)는 개인화된 AI 환경을 지속적으로 관리하고 발전시키는 엔진입니다. 이름은
라틴어로 '두드려 모양을 잡다'라는 뜻입니다. Claude Code와 Codex가 함께 따르는 규칙과 검사, 공통 스킬을
갖추고, 에이전트가 한 일을 그 기준에 맞게 다듬습니다. 이 엔진으로 운영하는 폴더를 **개인 프로젝트**라고
부릅니다. 개인 프로젝트는 자료, 판단 기준, 스킬, 자동화를 갖추고 업무, 학습, 창작의 결과를 만들어 가는
공간입니다.

**5분 안에 시작하기**

메모를 만들고 엔진을 설치한 뒤 다음 단계를 확인하세요.

```sh
npx -y excudo@^0.9.1 init my-memo
cd my-memo
npm install
git init
npx --no-install excudo start
```

코딩 에이전트에서 이 폴더를 열고 "책 한 장 읽기를 메모에 추가해 줘"라고 요청하세요.
로컬 웹 사이트를 만들면 브라우저에서 메모를 볼 수 있습니다.

```sh
npm install --save-dev cudoc-export@^1.1.0
npx --no-install excudo site --open
```

터미널과 Markdown 편집기는 원하는 것을 쓰세요. Orca, Tine, 사이트 호스팅은 선택 사항입니다.
로컬 사이트는 호스팅 계정 없이 열립니다.
[업데이트](#엔진-업데이트), [문제 제보](#문제-제보),
[버그 양식](https://github.com/cudoment/excudo/issues/new?template=bug.yml)과
[사용성 양식](https://github.com/cudoment/excudo/issues/new?template=usability.yml)을 참고하세요.

## 코딩 에이전트로 설치하기

비어 있는 위치에서 연 코딩 에이전트(Claude Code, Codex)에 아래 문장을 붙여 넣으세요.

> https://github.com/cudoment/excudo 의 README.ko.md에 있는 "코딩 에이전트로 설치하기" 절을 따라 새 폴더에 Excudo를 설치해 줘.

에이전트는 아래 규칙을 따릅니다. 4번 규칙의 명령과 보고서 확인만 실행하며, 5분 안에 시작하기의 웹 사이트 블록은 실행하지 않습니다.

1. Node.js가 22.16 이상인지 확인합니다(`node --version`). 아니면 멈추고 https://nodejs.org 를 안내합니다.
2. 폴더 이름과 파일의 언어(`en` 또는 `ko`)를 한 번만 묻고, 이후에는 다시 묻지 않습니다. 사용자가 한국어를 읽지 않으면 `en`을 고릅니다. 파일의 언어와 관계없이 사용자와는 사용자의 언어(일본어, 중국어 등)로 계속 대화합니다.
3. 전역 설치는 하지 않습니다. `npm install -g`도, npm 자체 캐시를 제외한 새 폴더 밖의 변경도 하지 않습니다.
4. `npx -y excudo@^0.9.1 init <폴더> --locale <언어>`를 실행한 뒤 다음 한 줄을 실행합니다: `cd <폴더> && npm install && git init && npx --no-install excudo start --report --json`. `init` 뒤의 모든 명령은 `<폴더>` 안에서 실행합니다. `init`은 git을 실행하지 않으므로 `git init`도 순서에 들어 있습니다.
5. 보고서(`--report --json`)를 읽어 확인합니다. `workspace`, `install`, `git`, `skills` 단계가 모두 `done`이면 설치에 성공한 것입니다. `done`이 아닌 단계가 있으면 그 단계의 `id`와 `state`를 보여 주고 사용자에게 어떻게 할지 묻습니다. 원인을 짐작하거나 다른 명령을 실행하지 않습니다.
6. 명령이 실패하면 멈추고 오류 출력의 마지막 몇 줄을 보여 준 뒤 사용자에게 묻습니다. 임의로 고치거나 다른 명령을 시도하지 않습니다.
7. 마지막에 남은 다음 단계, 곧 `stoppedAt`이 가리키는 단계를 사용자에게 넘깁니다. 그 단계의 `run`, `ask`, `setting`을 그대로 전하고 직접 실행하지는 않습니다.

## 시작하기

`excudo start`는 이 컴퓨터에서 마친 단계와 다음 단계를 보여 줍니다.
실행할 명령과 에이전트에게 할 말도 알려 줍니다. 엔진이 아래 목록을 관리합니다.

<!-- excudo:start (written by npm run start-docs from src/start.mjs) -->
**처음에 할 일**(차례대로):

1. **Node.js 22.16 이상**: 현재 LTS(24)를 설치합니다; https://nodejs.org
2. **작업 폴더**: 설정, 에이전트 스킬, 그래프가 든 메모 폴더를 만듭니다; `npx -y excudo init my-memo`; 또는 에이전트에게 “메모를 새로 만들어 줘”
3. **작업 폴더의 엔진**: 새 폴더에 엔진을 설치합니다; `npm install`
4. **git 저장소**: 메모의 이력입니다. save가 여기에 커밋합니다; `git init`
5. **에이전트 스킬**: init이 설치합니다. 작업 폴더에서 에이전트를 다시 엽니다; `npx --no-install excudo skills`

**필요할 때 할 일**:

1. **작업자와 독립 검토자 정하기**: 도구, 모델과 추론 수준을 직접 고르기; `npx --no-install excudo agents`; 또는 에이전트에게 “작업자와 검토자 정해 줘”
2. **요청에서 배우기**: 이 컴퓨터에서 코딩 에이전트에게 보낸 요청을 에이전트가 읽고, 오래 지킬 결정은 관심사로, 반복되는 일은 스스로 검사하는 스킬로 만들게 합니다(docs/sources-and-learning.ko.md의 '요청에서 배우기'와 docs/skills.ko.md의 '스킬은 코드를 품습니다' 참고). interests 설정에 적은 이름의 노드가 있어야 하므로 그 노드를 먼저 만드세요; `conversations: true, interests: "Interests"`; 또는 에이전트에게 “내 요청에서 배우게 해 줘”; https://github.com/cudoment/excudo/blob/main/docs/sources-and-learning.ko.md#요청에서-배우기
3. **Tine**: 그래프 폴더(notes/)를 Tine으로 열어 메모를 읽고 씁니다; https://tine.page
4. **휴대폰**: 그래프 폴더를 Syncthing으로 동기화하고 휴대폰의 Tine으로 엽니다; 또는 에이전트에게 “휴대폰에서도 보고 싶어”; https://syncthing.net
5. **내 홈**: 첫 화면을 직접 씁니다. 전체 트리는 아카이브로 옮겨 갑니다; `npx --no-install excudo home --own`; 또는 에이전트에게 “홈 구성 바꿔 줘”
6. **외부 업무**: 로그인한 브라우저로 이슈 트래커나 팀 게시판의 일을 가져옵니다; `npx --no-install excudo sources`; 또는 에이전트에게 “외부 할 일 가져와 줘”
7. **웹 사이트로 보는 메모**: 내 로그인으로만 열리는 Vercel에 올려 컴퓨터와 휴대폰에서 봅니다; `npx --no-install excudo site setup`; 또는 에이전트에게 “사이트 설정해 줘”
8. **웹 사이트에서 바꾸는 할 일 상태**: 웹 사이트에서 할 일 상태를 바꾸면 이 컴퓨터가 메모에 반영합니다; `site: { inbox: true }`; `npx --no-install excudo site setup`; 또는 에이전트에게 “사이트에서 할 일 상태를 바꾸게 해 줘”
9. **여러 컴퓨터에서 쓰기**: GitHub나 Google Drive로 작업 공간을 여러 컴퓨터에서 맞춥니다; 또는 에이전트에게 “여러 컴퓨터에서 메모를 맞춰 줘”

`npx -y excudo start`(작업 폴더에서는 `npx --no-install excudo start`)로 진행 상태를 확인합니다. `excudo start --report`는 모든 단계와 이어서 할 곳을 보여 줍니다.
<!-- /excudo:start -->

## 메모가 하는 일

개인 프로젝트의 중심은 메모입니다. 메모는 Markdown 노드를 담은 폴더이며, [Tine](https://tine.page)에서
컴퓨터와 휴대폰 모두 무한 트리로 보입니다. 맨 위 목록과 결정은 사용자가 맡고, 정리는 에이전트가 맡습니다.
엔진은 어느 개인 프로젝트에서나 쓸 수 있는 명령, 검사, 스킬을 맡고, 자료와 설정과 인증 정보는 각 개인
프로젝트에 둡니다.

개인 프로젝트의 이름은 'Excudo + 용도'로 짓기를 권장합니다. 업무 자동화용은 **Excudo Works**, 스터디용은
**Excudo Lab**처럼 짓습니다. 엔진은 'Excudo' 또는 '엔진'으로만 부르고, 개인 프로젝트는 이름 전체나 '이
프로젝트'로 부릅니다. 개인 프로젝트의 에이전트도 '엔진'을 이렇게 해석하고, 메모가 아닌 것을 고치기 전에는
엔진과 이 프로젝트 가운데 어느 쪽을 고칠지 사용자에게 묻습니다.

- **[짧게 유지되는 첫 화면](docs/memo.ko.md#맨-위는-짧게-자세한-내용은-아래에):** 에이전트가 기록한 내용을 알맞은
  노드 아래에 두고, 바뀐 곳 위의 요약을 최신으로 맞추며, 자세한 내용은 지우지 않고 아래에 접어 둡니다.
- **[답하기 전에는 옮기지 않습니다](docs/memo.ko.md#정리-인터뷰):** 정리 인터뷰가 근거와 추천을 붙여 네 건 이하씩
  묻고, 답한 묶음마다 따로 커밋해서 되돌릴 수 있게 합니다. 완료는 사용자만 표시합니다.
- **[외부 작업](docs/sources-and-learning.ko.md#외부-작업-가져오기)과 [최신 지식](docs/sources-and-learning.ko.md#지식을-최신으로-유지하기):** 이슈, 요청, 멘션을
  로그인한 브라우저로 한 번씩만 가져오고, 지켜보는 저장소와 페이지의 변경을 지식 노드에 반영합니다.
- **[검증하는 스킬만 만듭니다](docs/skills.ko.md#스킬은-코드를-품습니다):** 모든 스킬은 코드를 품습니다. 적어도
  요구 사항을 확인하는 검사와, 그 검사가 통과해야 하는 경우와 실패해야 하는 경우를 담습니다.
  `skills lint`가 그 경우들을 직접 실행해 점수를 매기므로, 프롬프트만 줄여 둔 것이나 실패할 수 없는
  검사는 스킬로 인정하지 않습니다. 되풀이된 요청도 이 기준을 넘을 때만 새 스킬이 되고, 기준에서
  벗어나면 쓰지 않게 됩니다.
- **[요청에서 배웁니다](docs/sources-and-learning.ko.md#요청에서-배우기):** 에이전트에게 입력한 요청을 읽어서(원문은 git에 넣지
  않습니다) 오래 갈 결정은 노드로, 되풀이된 일은 스킬로 자기 말로 정리합니다.

## cudoc 기반

Excudo는 [cudoc](https://www.npmjs.com/package/@cudoment/cudoc)(`@cudoment/cudoc`)에
의존하며, npm이 함께 설치합니다. cudoc은 엔진이 쓰는 별도의 의존성으로, 트리(조상, 순서, 요약)와 생성 뷰를
이루는 임베드를 제공합니다. Excudo는 그 위에 아웃라이너 형식, 검사, 정리 질문, 스킬을
더합니다. 엔진도 개인 프로젝트도 cudoc 제품군이 아닌 독립 프로젝트이므로 엔진의 문제는 이 저장소에서, cudoc
라이브러리 자체의 문제는 cudoc에서 다룹니다.
파일은 Logseq 형식을 따르며, Tine에서 검증했고 Logseq에서는 아직 검증하지 않았습니다.

## 그 밖의 기능

- [홈을 사용자의 페이지로](docs/memo.ko.md#홈을-사용자의-페이지로-쓰기): 홈에서 한 일을 체크하고 구성을 정하며, 전체 트리는 아카이브 뷰에 남습니다.
- [자세한 내용 찾기](docs/memo.ko.md#자세한-내용-찾아보기): 오래전에 지운 줄도 `find --history`로 찾습니다.
- 끝낸 일은 git 이력의 날짜로 달마다 보관합니다(`archive`).
- [노드의 작업 폴더](docs/memo.ko.md#노드의-작업-폴더): 경로, 브랜치, 창 이름 줄을 최신으로 맞춥니다.
- [사용자의 형식으로 쓴 파일](docs/mirrors-and-exports.ko.md#사용자의-형식으로-파일-유지하기): 할 일 목록 같은 파일을 저장할 때마다 메모로 다시 씁니다.
- 블록 id, 참조, 임베드를 검사하고 고칩니다(`fix`).
- 회고, 스킬 관리, 외부 출처 갱신을 예약 실행하고, 판단이 필요한 것은 질문으로 남깁니다.
- [Tine으로 휴대폰 동기화](docs/sync.ko.md#tine과-휴대폰-동기화)를 하며, 모든 메시지를 영어와 한국어로 제공합니다.
- 애드온: [`excudo-works`](https://github.com/cudoment/excudo-works)(npm `excudo-works`)는 Excudo 작업 폴더 위에 일상 루틴 도구 모음을 더합니다.

## 엔진 업데이트

새 버전과 변경 이력을 확인한 뒤 설치 여부를 정하세요.

```sh
npx --no-install excudo update
npx --no-install excudo update --channel next --json
npx --no-install excudo update --apply
```

기본 채널 `latest`는 안정 버전입니다.
`--channel next`는 베타 태그와 안정 태그를 비교해 높은 버전을 고릅니다. `--channel`을 주지 않으면 설치한 버전이 프리릴리스일 때 `next`를, 아니면 `latest`를 따릅니다.
명령은 설치 버전, 레지스트리 버전, 제공되는 변경 이력과 설치 명령을 출력합니다.
작업 폴더에서 `--apply`를 붙여야 설치하고 스킬을 갱신합니다.

설치한 엔진 스킬 사본은 지문을 기록하며, 수정하지 않은 사본만 교체합니다.
사용자 수정, 추가 파일과 외부 링크는 보존합니다.
캐시 폴더의 `skill-backups` 아래에 백업하고 경로를 출력합니다.
출력한 백업 경로에서 수정본을 비교하고 합친 뒤 다시 실행하세요.

조회 실패는 네트워크, 인증, 태그 없음으로 나눠 알리고 성공으로 끝납니다.
설치 실패는 npm 오류의 마지막 부분을 출력하고 오류로 끝납니다.
`--apply` 뒤에는 `excudo start --report`와 출력한 설정 검사를 실행해 빠진 템플릿 규칙을 확인하세요.
버전별 GitHub 릴리스와 CHANGELOG 링크도 출력하며, npm 메타데이터에는 최신 절을 담습니다.

## 문제 제보

컴퓨터에서 초안을 만들고 검토한 뒤 공유하려면 GitHub 이슈 링크를 여세요.

```sh
npx --no-install excudo feedback --title "빌드 실패" --message "일어난 일과 기대한 결과"
npx --no-install excudo feedback --out feedback.md --json
```

초안은 사용자 설명을 먼저 싣고 버전, 운영체제, 시작 단계 상태와 고정된 진단 식별자만 붙입니다.
엔진이 모르는 실행 단계는 `custom-step`, 실패한 스킬 검사는 `skill-check`로 표시합니다.
자유 문장으로 쓴 실행 상세와 스킬 이름은 `--details`를 붙여야 넣습니다. 보내기 전에 검토하라는 안내도 붙입니다.

홈, 작업 폴더, 그래프와 실제 경로를 지웁니다.
Windows 드라이브 경로, 두 단계 이상인 절대 경로, 이메일, IP 주소와 비공개 호스트도 지웁니다. `--details`에서는 그 밖의 경로도 줄 끝까지 지웁니다.
URL은 `github.com`과 `npmjs.com`만 남깁니다.

추가로 가릴 문자열은 `excudo.config.mjs`에 `private: ["비밀 값"]`으로 적으세요.
`private: true`를 붙인 객체 안의 문자열도 지웁니다.
설정이 깨져도 `feedback`과 `start --report`는 실행하며, 기본 출력은 비공개 오류 원문을 생략합니다.

명령은 제보를 전송하거나 브라우저를 열지 않습니다. `--out`은 가린 초안만 저장합니다.

## 스킬로 시작하기

Node.js 22.16 이상(현재 LTS인 24 권장)과 Agent Skills를 읽는 에이전트가 필요합니다. 저장소 공개 뒤에는 다음으로
입구 스킬을 받습니다.

```sh
npx skills add cudoment/excudo --skill excudo-setup
# 열 스킬을 모두 받으려면 다음을 씁니다.
npx skills add cudoment/excudo
```

에이전트에게 "메모를 새로 만들어 줘"라고 말합니다. 입구 스킬이 위치와 언어를 묻고 npm
엔진으로 `init`을 한 뒤 작업 폴더에서 `npm install`을 합니다. `init`이 열 스킬을
`.agents/skills/`에 복사하고 `.claude/skills/`에서 연결합니다. 그 폴더에서 에이전트를 다시
열면 됩니다.

저장소 맨 위의 `skills/`가 배포 원본이며 입구만 받으려면 `--skill`을 씁니다.
원격과 레지스트리 설치 경로는 첫 게시 뒤에 실제로 확인합니다.

| 작업 | Claude Code | Codex |
| --- | --- | --- |
| 기록 | `/excudo-capture 여권 갱신을 메모해 줘` | `$excudo-capture 여권 갱신을 메모해 줘` |
| 정리 인터뷰 | `/excudo-distill` | `$excudo-distill` |
| 설치와 설정 | `/excudo-setup` | `$excudo-setup` |
| 외부 출처 | `/excudo-sources 외부 할 일 가져와 줘` | `$excudo-sources 외부 할 일 가져와 줘` |
| 지식으로 답하기 | `/excudo-recall 사이트에서 바뀐 게 뭐야?` | `$excudo-recall 사이트에서 바뀐 게 뭐야?` |
| 회고 | `/excudo-reflect` | `$excudo-reflect` |
| 스킬 만들기 | `/excudo-skills` | `$excudo-skills` |
| 할 일 파일 유지 | `/excudo-export` | `$excudo-export` |
| 다른 앱의 메모 따라가기 | `/excudo-follow` | `$excudo-follow` |
| 에이전트에게 맡긴 일 처리 | `/excudo-queue` | `$excudo-queue` |

한국어나 영어로 그냥 요청해도 됩니다. 스킬마다 Markdown 지침과 스크립트가 함께 있으며, 적어도
스킬의 작업이 요구 사항을 충족했는지 확인하는 검사가 들어 있습니다("스킬은 코드를 품습니다" 참고).
생성, 검사, 이동, 보관, 커밋은 엔진이 하고, 넣을 자리와 요약과 결정은 스킬이 다룹니다. 네트워크는 설치
단계에서만 필요하며, 그 뒤에는 `npx --no-install excudo`로 로컬 엔진만 부릅니다.
없으면 작업 폴더에서 `npm install`을 먼저 합니다. 오래된 스킬은 `skills --force`로 갱신합니다. 패키지와 내용이 다른 사본은 한 번만 백업하고 그대로 두며, `skills --replace <이름>`이나 `--replace-all`이 백업한 뒤 교체합니다.
`skills --global`은 `~/.agents/skills/`에 설치하고, 학습한 스킬처럼 홈 폴더에 폴더가 있는 에이전트마다
`~/.claude/skills/`와 `~/.codex/skills/`에 연결합니다. 다른 폴더에서
전역 스킬을 부를 때는 `EXCUDO_ROOT`를 지정합니다. 엔진의 로컬 복제본을 `file:`로 설치한 작업
폴더는 스킬을 복사하지 않고 복제본에 연결할 수 있습니다. `skills --link --force`로 연결하면 스킬이
복제본과 함께 바뀌며, `skills --copy`는 다시 복사합니다.

### 명령줄로 시작하기

npm 게시 뒤에는 다음을 씁니다.

```sh
npx -y excudo@^0.9.1 init my-memo --locale ko
cd my-memo
npm install
git init
npx --no-install excudo check
```

게시 전에는 로컬 복제본에서 다음을 실행합니다.

```sh
npm install
node bin/excudo.mjs init ../my-memo --locale ko
```

새 작업 폴더로 들어가 `npm install`을 합니다. 의존성은 복제본을 가리킵니다.
`EXCUDO_PACKAGE`에 로컬 폴더나 tarball을 지정하면 입구 스킬에서도 같은 흐름을
시험할 수 있습니다. `init --example`은 [영문 더미 예시](example/notes)를 만들며 다른 언어를
지정하면 거부합니다.
`--graph`는 그래프 폴더 이름을 바꿉니다.

## 문서

아래 문서에 이 자리에 있던 절이 들어 있습니다. 영문 문서는 `.ko.md`가 없는 같은 이름의 파일입니다.

- [메모 다루기](docs/memo.ko.md): 첫 화면, 정리 인터뷰, 노드와 생성물의 경계, 자세한 내용 찾기, 홈, 작업 폴더
- [외부 출처와 학습](docs/sources-and-learning.ko.md): 외부 작업, 최신 지식, 따라가는 메모, 요청에서 배우기, 한 일 기록
- [목록 맞추기와 파일 내보내기](docs/mirrors-and-exports.ko.md): 한 목록을 여러 곳에서 같게 유지하기, 사용자의 형식으로 파일 유지하기
- [자동 실행](docs/automation.ko.md): 예약 실행, 에이전트에게 일 맡기기, 현황 보기
- [에이전트와 지침](docs/agents.ko.md): 작업자와 독립 검토자 정하기, 세션 지침 크기 관리
- [스킬](docs/skills.ko.md): 스스로 검사하는 스킬
- [웹 사이트](docs/website.ko.md): 메모를 웹 사이트로 보기, 게시, 할 일 상태 바꾸기, 홈의 대시보드
- [동기화](docs/sync.ko.md): Tine과 휴대폰 동기화, 여러 컴퓨터에서 쓰기
- [참조](docs/reference.ko.md): 명령과 설정 전체
- [개발](docs/development.ko.md): 시험, 릴리스, 저장소 구조

## 요청에서 배우기

에이전트가 이 컴퓨터에서 코딩 에이전트에게 보낸 요청을 읽고, 오래 지킬 결정은 관심사로, 되풀이되는 일은 스킬로 만듭니다.
자세한 안내는 [외부 출처와 학습](docs/sources-and-learning.ko.md#요청에서-배우기)에 있습니다.

## 스킬은 코드를 품습니다

모든 스킬은 스크립트와 통과해야 하는 검사를 품습니다.
자세한 안내는 [스킬](docs/skills.ko.md#스킬은-코드를-품습니다)에 있습니다.

## 홈의 대시보드

웹 사이트의 홈 맨 위에 대시보드를 둘 수 있습니다.
자세한 안내는 [웹 사이트](docs/website.ko.md#홈의-대시보드)에 있습니다.

## 여러 컴퓨터에서 쓰기

작업 공간을 비공개 GitHub 저장소나 Google Drive 앱이 동기화하는 폴더로 여러 컴퓨터에서 같게 유지할 수 있습니다.
자세한 안내는 [동기화](docs/sync.ko.md#여러-컴퓨터에서-쓰기)에 있습니다.

## 라이선스

MIT
