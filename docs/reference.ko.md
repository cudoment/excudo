# 참조

[README](../README.ko.md) | [English](reference.md) | 한국어

## 명령

작업 폴더에서 `npx --no-install excudo <명령>`으로 실행합니다. 위치는 `--root`,
현재 폴더와 그 위의 `excudo.config.mjs`, `EXCUDO_ROOT` 순서로 정합니다. 작업 폴더를
찾지 못해도 `start`, `feedback`, `update`(`--apply` 제외)는 실행됩니다. 그 밖에는 `init`과 `skills --global`을 뺀 모든 명령이 멈추고 그 사실을 알립니다.

| 명령 | 동작 |
| --- | --- |
| `--version`, `-v` | 설치된 버전을 출력하고 끝냅니다. 작업 폴더 안팎에서 모두 실행됩니다 |
| `start [--json]` | 지금 어디까지 했는지 보여 줍니다. 이 컴퓨터에서 마친 처음 단계와 다음 단계를 명령과 함께 알려 주며, 작업 폴더가 없어도 실행됩니다 |
| `start --report [--json]` | 처음 단계마다 마쳤는지와 이어서 할 곳을 파일을 바꾸지 않고 알려 줍니다 |
| `update [--channel latest\|next] [--apply] [--json]` | 레지스트리를 확인하고 변경 이력과 명령을 보여 줍니다. 설치한 버전이 프리릴리스면 `next`를 따릅니다. `--apply`는 작업 폴더에서 업데이트를 설치하고 스킬을 갱신합니다 |
| `feedback [--title <글>] [--message <글>] [--details] [--out <파일>] [--json]` | 정리한 제보 초안과 링크를 이 컴퓨터에서 만듭니다. 아무것도 보내지 않으며 작업 폴더 없이도 실행됩니다 |
| `init [폴더]` | 설정, 지침, 스킬과 그래프를 만듭니다. 기존 파일은 보존합니다 |
| `build [--force]` | 뷰와 하위 트리를 생성합니다. force는 손으로 고친 생성물을 덮어씁니다 |
| `check [--json]` | 노드와 참조를 검사합니다. JSON에 `top`이 있고 오류는 종료 코드 1입니다 |
| `instructions [--json] [--limit <바이트>] [--check]` | AGENTS.md 크기와 후보를 읽고 한도 초과를 검증합니다 |
| `instructions move --lines <시작>-<끝> --to <스킬> --reference <이름> --pointer <문구> [--since <커밋>]` | 기존 작업 폴더 스킬로 원문을 옮깁니다 |
| `tree [노드]` / `tree --path <노드>` | 하위 트리 또는 맨 위까지의 경로와 요약을 출력합니다 |
| `home [--own] [--json]` | 홈을 누가 쓰는지, 사용자 홈이 임베드한 것과 빠진 것을 봅니다. `--own`은 홈을 넘겨받고 트리를 아카이브로 옮깁니다 |
| `inbox [--json]` | 아직 옮기지 않은 저널 항목과 `pages/`에서 기다리는 페이지를 봅니다 |
| `review [--json] [--limit N] [--node 노드]` | 식별자, 위치, `reasons`, 근거와 추천을 갖춘 질문 묶음을 냅니다 |
| `review keep <id>...` | 질문 전체의 남김을 `review.json`에 기록합니다. 개별 사유의 ID도 해당 묶음을 선택합니다 |
| `move <노드> <부모>` | 파일과 하위 폴더를 함께 옮기거나 `pages/`에서 기다리는 페이지를 트리에 놓습니다. `projects/` 같은 분류 폴더는 맨 위로 올립니다 |
| `rename <노드> <이름> [--home]` | 노드의 파일, 하위 폴더, 제목과 코드 밖에서 그 노드를 가리키는 링크의 이름을 바꾸고 빌드 보호 기록을 옮깁니다. 그 노드를 가리키는 설정은 알리기만 하고, 사용자 홈의 링크는 `--home`(사용자의 요청이 홈까지 다룰 때)일 때만 함께 바꿉니다 |
| `remove <노드> [--force]` | 노드와 하위를 지우고 남은 링크 위치를 냅니다. 열린 할 일, 방침, 사용자 홈이 가리키는 노드는 보호합니다 |
| `archive [노드]` | DONE 항목 또는 끝난 노드를 달별로 접어 둡니다. 열린 할 일이 있는 노드는 거부합니다. `--canceled`는 CANCELED 항목만 옮깁니다 |
| `find <말> [--history] [--json]` | 이름과 원문을 대소문자 구분 없이 찾고 git `-S`로 지운 줄도 찾습니다 |
| `sources [--json]` | 외부 출처를 보여 줍니다. items 출처는 마지막 수집 시각, 가져온 항목 수, 메모에서 아직 열린 항목 수를, repo와 page 출처는 노드와 마지막 반영 시각을 봅니다 |
| `sources script <이름> [--action 동작] [--args JSON]` | 출처 페이지에서 실행할 JavaScript를 출력합니다. 수집 스크립트 또는 출처의 동작입니다 |
| `ingest <이름> <파일> [--dry-run] [--json]` | 출처에서 모은 새 열린 항목을 넣습니다(`-`는 표준 입력). 끝났거나 목록에서 빠졌는데 열려 있는 항목을 알립니다 |
| `changes [이름] [--input 파일] [--all] [--json]` | 노드를 마지막으로 갱신한 뒤 바뀐 repo와 page 출처를 알립니다. `--all`은 꺼 둔 출처도 봅니다 |
| `changes mark <이름>... [--input 파일] [--expect 값]` | 노드를 최신으로 맞췄다고 기록합니다. `--expect`는 읽은 뒤 다시 바뀐 출처를 거부합니다 |
| `requests [--for cleanup\|reflect] [--candidates] [--since 시각] [--json]` | 목적별 표시 뒤에 코딩 에이전트에 입력한 요청을 노드와 함께 봅니다 |
| `requests mark --for <목적> [--until 시각]` | 그 목적으로 요청을 읽었다고 표시합니다. `--until`이 없으면 마지막으로 본 목록의 가장 새 요청까지입니다 |
| `workspaces [--input 파일] [--dry-run] [--json]` | 경로 줄의 브랜치와 창 이름을 갱신하고, 없어진 폴더, 노드가 없는 작업 폴더, 공유 폴더에서 어느 줄에도 없는 창, 앱의 작업 폴더마다 메모가 정하는 이름을 알립니다 |
| `workspaces untrack\|track <폴더>...` | 메모에서 추적하지 않는 폴더로 기록하거나 다시 추적합니다 |
| `fix [--dry-run] [--json]` | id를 함께 쓰는 블록을 고칩니다. 같은 복사본은 첫 블록의 임베드로, 다른 블록은 새 id로 바꿉니다 |
| `mirror [이름] [--note <출처>=<파일>] [--dry-run] [--json]` | 한 목록을 여러 위치(`mirrors`)에서 같게 유지합니다. 고친 것을 합쳐 페이지와 내보내기 구역에 쓰고, 메모마다 가질 글을 냅니다. 페이지를 누가 쓰는 중이거나 보류했으면 종료 코드 75입니다 |
| `mirror mark [이름] --wrote <출처>=<파일> [--note <출처>=<파일>]` | 작업 폴더가 메모에 쓴 줄을 그 메모의 기준으로 기록합니다 |
| `mirror text [이름] [출처] [--copy] [--json]` | 메모가 가질 글을 출력하거나, 메모의 표식 사이에 붙여 넣도록 클립보드에 넣습니다(`--copy`) |
| `snapshot [--only <파일>] [--settle N] [--json]` | 정리 전에 그래프의 사용자 편집, 남김 기록, 설정을 먼저 커밋합니다. `--only`(여러 번, 작업 폴더나 그래프 기준 경로 또는 그래프 안의 절대 경로)를 주면 그 그래프 파일만 따로 커밋합니다. 없는 경로는 아무것도 커밋하지 않고 종료 코드 1을 냅니다. 또 `--settle N`을 주면 `idle --settle N`이 `settled`로 보는 편집만 커밋합니다 |
| `save <메시지>` | 검사, 생성, 상태 줄 출력 후 그래프, `review.json`, `sources.json`, `reflect.json`, `skills.json`, 학습한 스킬, `excudo.config.mjs`를 커밋합니다. 그래프 잠금을 쥐고 실행하며 `private-line`, `sync-conflict` 경고도 알립니다. 없는 `--only` 경로는 아무것도 커밋하지 않고 종료 코드 1을 냅니다. `--only <파일>`(여러 번, 작업 폴더나 그래프 기준 경로 또는 그래프 안의 절대 경로)을 주면 그 파일과 생성이 쓴 파일만 커밋하고, 생성 전에 이미 다른 사람이 바꿔 둔 파일은 뺍니다. 그래서 예약 실행은 그사이 메모의 다른 곳에 쓴 편집을 그 사람의 커밋으로 남겨 둡니다. `--generated`는 같은 방식으로 생성이 쓴 파일만 커밋합니다 |
| `idle [--minutes N] [--settle N] [--json]` | 예약 실행이 지금 메모를 바꿔도 되는지 알려 줍니다. 쓰는 곳이 없으면 종료 코드 0, 다른 명령이 그래프 잠금을 쥐고 있거나 커밋하지 않은 그래프 파일(생성 페이지와 `EXCUDO_HOLD`에 보류한 파일은 빼고)이 최근 몇 분 안에 바뀌었으면 1, 일시 정지 줄이 있으면 3입니다. `--settle N`은 N분 동안 그대로이고 검사를 통과한 편집을 고치는 중이 아니라 끝난 편집(`settled`)으로 보고, 그보다 오래됐는데 검사를 통과하지 못한 편집은 `unsettled`로 냅니다 |
| `activity [--days N] [--json]` | 세션의 활동과 사용자의 커밋을 캐시에 모아 뷰의 `activity` 펜스에 씁니다(`conversations` 설정) |
| `activity show [--days N]` | 뷰가 보여 줄 활동을 출력합니다 |
| `sessions [<노드>] [--path <폴더>] [--days N] [--limit N] [--json]` | 노드와 그 아래에서 일한 코딩 에이전트 세션을 최근 것부터, 지금 폴더에서 이어 켜는 명령과 함께 보여 줍니다 |
| `queue [--json]` | 에이전트에게 맡긴 열린 할 일을 처리 대기와 검토 대기로 나눠, 노드, 작업 폴더, 방침과 함께 보여 줍니다 |
| `queue report <키> --summary <말> [--file <보고서>] [--stamp <지문>]` | 에이전트의 보고를 할 일 아래에 대기 줄로 남깁니다. 개인 정보로 보이는 요약을 거부하고, 맡을 때의 지문을 주면 같은 문구의 할 일이 있는 파일에서 그사이 바뀐 할 일도 거부합니다 |
| `runs [--days N] [--step <이름>] [--failed] [--deferred] [--full] [--json]` / `runs add <단계> --status <상태>` | 예약 실행의 단계를 보거나 기록합니다. `--step`은 여러 번 쓸 수 있고, 상태 옵션 둘을 함께 쓰면 어느 쪽이든 고릅니다. 글 출력의 이유는 160자까지이며 `--full`로 전체를 봅니다. JSON은 이유를 그대로 냅니다 |
| `backup <폴더>` | 캐시의 일관된 사본(기록, 빌드 보호 기록, 따라가는 메모, 보고서)을 씁니다 |
| `export [이름] [--dry-run] [--force] [--json]` | 메모로 사용자 형식의 파일(`exports`)을 씁니다. `build`와 `save`도 쓰며, 직접 고친 파일은 그대로 둡니다 |
| `site [--out <폴더>] [--mode site\|standalone] [--open] [--dry-run] [--json]` | 메모를 cudoc-export로 그래프 밖의 웹 사이트로 씁니다(`site`). `onSave`가 false가 아니면 `build`와 `save`도 씁니다 |
| `site setup [--project <이름>]` | 처음 한 번: 없는 것을 설치하고 Vercel에 로그인해 프로젝트를 만들어 연결한 뒤, 모든 배포를 Vercel Authentication으로 지키게 하고 올려서 엽니다 |
| `site publish [--force]` | 웹 사이트를 쓰고, 호스트가 준비되었고 바뀐 것이 있으면 Vercel에 올립니다. 사용자가 먼저 할 일이 있으면 75로 끝납니다 |
| `site open` | 올린 웹 사이트를 열고 주소를 복사하며 휴대폰으로 찍을 코드를 보여 줍니다 |
| `site status [--json]` | 로그인, 프로젝트, 보호, 주소, 마지막 배포, 받는 곳을 보여 줍니다 |
| `site pull [--now] [--dry-run] [--json]` | 웹 사이트에서 고른 할 일 상태를 가져옵니다. 5분마다, 페이지가 요청하거나 `--now`면 바로 가져오고, 페이지를 커밋한 뒤 이슈를 닫고 다시 올립니다 |
| `sync [--pull] [--push] [--status] [--json]` | `sync` 설정으로 작업 공간을 컴퓨터 사이에서 맞춥니다. 받은 뒤 올리며 `--pull`이나 `--push`로 한쪽만 합니다. `--status`는 방식, 리모트나 폴더, 마지막 동기화, 앞섬과 뒤처짐, 확인한 다른 컴퓨터를 네트워크 없이 보여 줍니다. 추적하는 파일에 커밋하지 않은 변경이 있으면 받지 않고(먼저 `save`, `auto`면 자동 저장), 충돌하는 병합은 취소하고 파일 이름을 알리며, 리베이스나 강제 푸시는 하지 않습니다. 설정이 없으면 그렇게 알립니다. `--status`는 종료 코드 0, 나머지는 1 |
| `sync setup github [--remote <이름>] [--create <owner/repo>] [--auto]` | 작업 공간 id와 함께 `sync: { github }`를 씁니다. `--create`는 `gh`로 비공개 저장소를 만들어 리모트로 추가하고, `--auto`는 먼저 받는 규칙도 `AGENTS.md`에 더합니다 |
| `sync setup drive --folder <경로> [--machine <이름>] [--id <id> \| --new] [--auto]` | `sync: { drive }`를 씁니다. `--id`는 다른 컴퓨터가 만든 메모에 합류하며(새 `init` 폴더는 첫 번째 받기에서 그 히스토리를 가져옴), `--new`는 이미 메모가 있는 폴더에 다른 메모를 시작합니다 |
| `receive --input <file\|-> [--dry-run] [--json]` | 웹 사이트에서 고른 할 일 상태를 가져옵니다. 묶음 하나, 묶음 목록, `gh issue list --json number,body`의 출력을 받습니다. 자리를 찾지 못한 변경은 오늘 저널의 WAITING 할 일로 남기고, 묶음이 없는 이슈는 건너뜁니다 |
| `skills [--global] [--force] [--replace <이름>\|--replace-all] [--link\|--copy]` | 스킬을 설치하거나 갱신하고 엔진 버전을 기록합니다. `--link`는 설치한 엔진에 연결합니다 |
| `skills lint [이름\|폴더]... [--json]` | 스킬이 스킬 규칙을 지키는지 검사하고 점수를 매깁니다. 작업 폴더 밖에서는 엔진의 스킬을 검사합니다 |
| `skills status [--json]` | 학습한 스킬의 적합성, 설치 상태, 새 요청, 휴면 여부, 채택하지 않은 폴더를 보여 줍니다 |
| `skills candidates [--json]` | 스킬로 만들 만한 되풀이된 요청을 에이전트가 판단할 수 있도록 최근 요청과 함께 보여 줍니다 |
| `skills adopt <이름> (--from <후보>\|--requested) [--force]` | 맞는 학습 스킬을 설치하고, 맞지 않으면 초안으로 기록합니다. `--force`는 누가 고친 설치본을 바꿉니다 |
| `skills dismiss <후보> --reason <이유>` | 이 후보와 비슷한 요청을 다시 제안하지 않습니다 |
| `skills mistake <이름> --case <경우> --why <요약> [--json]` | 사용자가 지적한 실수를 재현한 학습 스킬 검사의 경우를 기록합니다. lint가 그 경우를 실패해야 하는 경우로 지킵니다 |
| `skills retire <이름>` | 학습한 스킬을 쓰지 않도록 합니다. 원본과 기록은 남깁니다 |
| `skills upkeep [--json]` | 학습한 스킬을 다시 검사하고, 맞지 않는 스킬을 내리며, 설치본을 갱신하고 요청을 셉니다 |

`review`는 첫 목록 경고와 비활성 노드(사용자 홈이면 홈 밖의 맨 위 노드), 뒤처진 요약, 빈 노드와 긴 본문과 오래된 노드,
기한이 지났거나 오래된 할 일, 확인 표지, 오래된 생각, 중복, 오래된 저널, 폴더가 없어진 경로 줄을 찾습니다. 나이는
파일 수정 시각이 아니라 git log와 blame으로 셉니다. 이력이 없거나 짧으면 나이 후보는
생략하고 상대적인 요약 갱신은 계속 확인합니다. 이력을 끝까지 읽지 못하면 `review`와
`check`는 나이를 추측하지 않고 그 사실을 알립니다. 접힘, 생성 영역의 변경과 노드 이동은
본문 변경으로 세지 않으며 본문 삭제는 변경으로 봅니다. 완료와 기록, 그리고 그 아래의
노드는 빈 노드, 오래된 노드, 뒤처진 요약으로 묻지 않습니다. `1/5`처럼 연도가 없는 날짜는
가장 가까운 날짜로 해석합니다. 별도 줄의 `DEADLINE:`과 `SCHEDULED:`는 해당
할 일에 속하고 같은 문구의 할 일도 ID를 개별로 받습니다. 남김은 `keepDays`가 지나거나
내용이 바뀌면 만료됩니다. `top`의 뒤처진 요약 수에는 남김으로 기록한 요약을 세지 않습니다. JSON의 `questions`, `mergedReasons`, `suppressedQuestions`는
질문 수, 묶어서 줄인 사유 수, 남김으로 숨긴 질문 수입니다. `--limit`는 질문 묶음 수이며
한 명령 안에서 문서 수집과 git 분석을 공유하고, 커밋된 내용의 요약값과 blame 결과는
`.excudo/history.json`에 캐시합니다. 후보만 내며 스스로 옮기거나 지우지 않습니다.
기존 남김 ID도 대상 하나를 가리키면 유지합니다. 같은 문구의 할 일이 공유하던 ID는 어느
항목을 남겼는지 알 수 없으므로 각 항목을 따로 다시 물어봅니다.

| 검사 | 수준 |
| --- | --- |
| `node-title`, `node-summary`, `duplicate-name`, `orphan-folder`, `list-trailing-text` | 오류입니다 |
| `block-id-duplicate`, `block-ref-missing`, `embed-cycle`, `reflect-invalid` | 오류입니다 |
| `summary-long`, `top-summary-long`, `list-wide`, `node-large`, `doing-wide` | 경고입니다 |
| `dangling-link`, `bullet-heading`, `heading-spacing`, `paragraph-gap`, `skills-outdated`, `history-failed` | 경고입니다 |
| `embed-page-missing`, `embed-twice`, `path-duplicate`, `path-window-twice`, `knowledge-missing` | 경고입니다 |
| `sync-conflict`, `private-line` | 경고입니다 |
| `instructions-size` | 경고입니다 |
| `instructions-target` | 알림입니다 |

`sync-conflict`는 동기화 앱이 충돌 뒤에 남긴 사본(`*.sync-conflict-*`, `(conflicted copy)`)을
알리며, 트리는 이 사본을 읽지 않습니다. `private-line`은 마지막 커밋 뒤에 들어간 줄 가운데 note
출처가 버리는 규칙에 걸리는 줄을 파일과 줄 번호로만 알리며, 커밋한 줄은 다시 알리지 않습니다.
`list-wide`는 홈의 메타 노드와 날짜별 보관 노드를 제외합니다. 기본값은 요약 120자,
첫 목록 요약 60자, 목록 9개, 한 노드의 열린 할 일 12개, 진행 중인 할 일 9개입니다(`doingMax`는 `widthMax`를 따르고,
`taskMax: false`나 `doingMax: false`를 주면 그 할 일 수를 세지 않습니다). 외부 출처의 노드는 받은편지함이므로
이보다 많아도 됩니다.

## 설정

```js
export default {
  graph: "notes",
  locale: "ko",       // en 또는 ko입니다.
  private: [],       // 제보 진단에서 지울 문자열입니다.
  summaryMax: 120,
  topSummaryMax: 60,
  widthMax: 9,
  taskMax: 12,       // false면 한 노드의 열린 할 일 수를 세지 않음
  doingMax: undefined, // 진행 중인 할 일의 최대 수. widthMax를 따르고, false면 세지 않음
  doneKeep: 5,
  metaNodes: ["완료", "기록"], // 기본값은 해당 언어의 라벨입니다.
  staleDays: 30,
  keepDays: 90,
  bodyMax: 20,
  sources: [],        // 외부 출처입니다. "외부 작업 가져오기", "지식을 최신으로 유지하기", "다른 앱의 메모 따라가기"를 참고합니다.
  knowledge: [],      // 참고 지식만 담는 노드입니다.
  interests: undefined, // 회고 스킬이 오래 갈 결정을 두는 노드입니다.
  conversations: false, // 코딩 에이전트에 입력한 요청을 읽습니다. true 또는 { claude, codex, exclude }입니다.
  moved: {},          // 이름을 바꾼 폴더의 이전 경로와 새 경로입니다. 경로 줄과 요청에 씁니다.
  skills: {},         // 학습 스킬입니다. { dir, install, keep, minScore, minRequests, minSessions, windowDays, dormantDays, similarity }
  instructions: { limit: 32768, target: null, auto: false, keep: [] }, // 목표 기본값은 한도의 85%이며 auto는 예약 정리를 켭니다.
  exports: [],        // 메모로 쓰는 사용자 형식의 파일입니다. "사용자의 형식으로 파일 유지하기" 참고
  agents: undefined, // 작업자와 독립 검토자 설정(선택)
  queue: {},          // 에이전트에게 맡긴 할 일입니다: { tag, limit }. "에이전트에게 일 맡기기" 참고
  site: undefined,    // 메모로 쓰는 웹 사이트입니다: { out, title, mode, open, journals, css, onSave, inbox, publish }. "메모를 웹 사이트로 보기" 참고(inbox: true 또는 { github: { repo }, schedule })
  sync: undefined,    // 작업 공간을 컴퓨터 사이에서 맞춥니다: { github: { remote, branch } } 또는 { drive: { folder } }와 { id, auto }. sync setup이 쓰며 "여러 컴퓨터에서 쓰기" 참고
  labels: {},         // 생성하는 단어를 바꿉니다.
}
```

`excudo.config.mjs`는 그래프 밖에 둡니다. 메타 노드를 order로 지정하지 않으면 맨 끝에 둡니다.
`messages`, `review`, `recommendations` 같은 라벨 묶음은 항목 단위로 합칩니다.
줄 머리말과 확인 표지(`markers`: `생각:`, `방침:`, `#확인`)는 언어 설정과 관계없이 모든 언어의 것을
알아봅니다.
기본 홈 쿼리는 DOING만 펼칩니다. 언어나 생성 절의 라벨을 바꿀 때는 기존 생성물의 경계를
확인한 뒤 강제 빌드합니다.
