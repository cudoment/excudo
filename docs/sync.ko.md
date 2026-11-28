# 동기화

[README](../README.ko.md) | [English](sync.md) | 한국어

## Tine과 휴대폰 동기화

그래프 폴더(기본 `notes/`)를 Tine에서 엽니다. macOS에서 다른 그래프로 바꾸려면 앱을 완전히
끈 뒤 실행합니다.

```sh
TINE_GRAPH=<그래프폴더> /Applications/Tine.app/Contents/MacOS/tine <그래프폴더>
/Applications/Tine.app/Contents/MacOS/tine doctor <그래프폴더>
```

켜진 앱에 `open -a`나 `tine open`으로 경로를 넘겨도 그래프가 바뀌지 않습니다.
0.6.986의 `tine export`는 “Rebuilding the query index…”에서 실패했습니다. 0.7.1에서는 내보내기가
되지만, 그래프 검증에는 내보내기 대신 `tine doctor`를 씁니다.
Tine이 없으면 [tine.page](https://tine.page)에서 설치합니다.

Syncthing으로 그래프만 공유하고 파일 변경 감지와 휴지통 방식의 30일 보관을 켭니다.
Android의 Syncthing-Fork로 연결한 뒤 동기화 폴더를 Tine에서 엽니다. `.stignore`는 뷰,
아웃라이너 백업과 엔진의 임시 파일을 PC에 남깁니다. 급히 적은 것은 저널에 두고 정리 인터뷰로 노드에 옮깁니다.
엔진, 스킬, 캐시, 남김 기록은 휴대폰에 공유하지 않습니다.

## 여러 컴퓨터에서 쓰기

git으로 작업 공간 하나를 여러 컴퓨터에서 맞춥니다. GitHub 비공개 저장소나 Google Drive 폴더 중에서 고릅니다. 에이전트에게 “여러 컴퓨터에서 메모를 맞춰 줘”라고 요청하거나 아래 명령을 실행합니다. `sync`를 설정하지 않은 작업 공간은 동기화 코드를 실행하지 않습니다. 검사도, 경고도, 네트워크 접근도 없습니다. `excudo start`가 선택 단계 하나("여러 컴퓨터에서 쓰기")를 알 수 없음으로 더 보여 줄 뿐입니다.

**방식 고르기.**

- **GitHub**: 비공개 저장소가 리모트입니다. GitHub 계정이 있으면 이 방식을 고릅니다. 가장 간단하고 빠르며, 저장소에 전체 히스토리가 남습니다.
- **Google Drive**: 컴퓨터마다 자기 git 번들을 Google Drive 데스크톱 앱이 동기화하는 폴더에 쓰고, 다른 컴퓨터가 쓴 번들을 병합합니다. GitHub 계정이 없으면 이 방식을 고릅니다. 동기화 앱이 열려 있는 저장소를 파일 단위로 복사하면 저장소가 깨지므로 `.git` 폴더는 Drive에 넣지 않습니다. 번들은 한 번에 쓰는 파일 하나이고, 컴퓨터마다 자기 번들만 씁니다.

**첫 번째 컴퓨터에서 설정하기.** 작업 공간은 커밋이 하나 이상 있는 git 저장소여야 합니다(`git init` 뒤 `excudo save`).

```sh
# GitHub: gh로 비공개 저장소를 만들고 리모트로 추가합니다
npx --no-install excudo sync setup github --create <owner/repo>
# Google Drive: Drive 앱이 동기화하는 폴더 안의 폴더
npx --no-install excudo sync setup drive --folder "~/Google Drive/My Drive/excudo"
npx --no-install excudo save "동기화 설정"
npx --no-install excudo sync
```

설정은 `sync` 설정을 작업 공간 id와 함께 한 번 씁니다. id 덕분에 작업 공간 두 개가 Drive 폴더 하나를 `<폴더>/<id>/` 아래에서 나눠 쓸 수 있습니다. `gh`가 없거나 로그아웃되어 있으면 실행할 명령(`brew install gh`, `gh auth login --web`)을 출력하고 멈춥니다. Excudo는 자격 증명을 입력하거나 저장하지 않습니다. `--create`가 없으면 `sync setup github`은 사용자가 추가한 리모트(`--remote <이름>`, 기본 `origin`)를 씁니다.

**두 번째 컴퓨터에서 설정하기.**

- GitHub: `git clone <url> my-memo`, `cd my-memo`, `npm install`을 실행합니다. 설정은 clone에 들어 있습니다. 첫 번째 생성이나 저장 전에 `npx --no-install excudo sync --pull`을 실행해 새 clone으로 표시한 뒤 `npx --no-install excudo sync --status`로 확인합니다.
- Google Drive: 빈 작업 공간을 만들어 id로 그 메모에 합류합니다. 첫 번째 컴퓨터에서 `excudo sync --status`를 실행하면 id가 보입니다. 이 id는 Drive 폴더 안의 폴더 이름이기도 합니다.

  ```sh
  npx -y excudo init my-memo --locale <첫 컴퓨터와 같은 en 또는 ko> && cd my-memo && git init && npm install
  npx --no-install excudo sync setup drive --folder "<이 컴퓨터의 Drive 폴더>" --id <id>
  npx --no-install excudo sync --pull
  ```

  설정은 번들에서 메모의 언어와 그래프 폴더를 읽어, 이 폴더가 다르게 만들어졌으면 멈춥니다(`init`에 같은 `--locale`과 `--graph`를 줍니다). 첫 번째 받기는 다른 컴퓨터의 히스토리를 가져오고 다시 빌드하지 않습니다. 그래프 폴더에서 `init`이 쓴 것 전부와, 히스토리에도 있는 다른 파일은 `.excudo/sync-before/`로 옮겨 두므로 잃는 것이 없습니다. 설정은 그 메모의 읽을 수 있는 번들이 폴더에 없는 동안(id가 틀렸거나 Drive가 아직 동기화 중) 멈추므로 기다린 뒤 다시 실행합니다. 첫 번째 받기 전에는 `excudo save`를 실행하지 않습니다. 메모와 이어지지 않는 히스토리가 생깁니다. 합류하는 폴더에서 아무것도 가져오지 못한 받기는 그렇게 알리며 실패하고, 아직 커밋이 없는 첫 번째 컴퓨터에는 `excudo save`를 안내합니다. 히스토리가 있는 컴퓨터에서는 다른 브랜치의 번들을 경고와 함께 건너뛰고, 관련된 번들이 하나라도 있으면 다른 메모의 번들도 건너뜁니다. 찾은 번들이 모두 다른 메모의 것이면 올리기 전에 실패합니다.

**쓰기.**

- `excudo sync`는 받은 뒤 올립니다. `--pull`은 받기만, `--push`는 올리기만 합니다. `--status`는 방식, 리모트나 폴더, 마지막 동기화, 앞섬과 뒤처짐, 확인한 다른 컴퓨터를 보여 주며 네트워크에 접근하지 않습니다. 모두 `--json`을 받습니다.
- 추적하는 파일에 커밋하지 않은 변경이 있으면 받기를 멈춥니다. 먼저 `excudo save "<메시지>"`를 실행합니다. 병합은 fast-forward이거나 일반 병합입니다. 리베이스나 강제 푸시는 하지 않습니다.
- 병합이 깔끔하게 끝나면 `save`가 실행하는 생성을 그대로 실행하고 쓴 파일을 커밋하므로 생성 영역이 맞습니다. 생성 글 중 두 가지는 손으로 고친 것이 아니라 다른 컴퓨터 엔진의 출력으로 인정합니다. 한 컴퓨터의 기록을 보여 주는 뷰(`activity` 또는 `status` 펜스)에서 병합이 그 글을 바꾼 경우, 그리고 아직 생성하지 않은 컴퓨터(새 clone이나 가져오기이며 첫 `sync`가 표시함)에서 히스토리의 생성 페이지와 영역을 그대로 받는 경우입니다. 그 밖에 들어온 생성 영역이나 페이지의 변경은 clone 직후가 아닌 곳에서 `.excudo/build.json`을 지운 경우를 포함해 손으로 고친 것처럼 계속 보호합니다. 생성이 멈추고 그 파일을 알려 줍니다.
- 병합 충돌이 나면 병합을 취소하고 폴더를 그대로 두며, 종료 코드 1과 충돌한 파일 이름을 냅니다. 일반 git으로 풀거나 에이전트에게 요청하고, 양쪽을 읽은 뒤 결정합니다. 자동으로 풀지 않습니다.
- Drive에서는 온전하지 않은 번들(Drive가 아직 동기화 중일 수 있음)이나 이 엔진이 쓰지 않는 이름(`name (1).bundle` 같은 Drive 충돌 사본)을 건너뛰고 알립니다. 잠시 뒤 `excudo sync`를 다시 실행합니다.
- Drive 폴더와 작업 공간은 서로를 포함하면 안 되고 작업 공간은 Google Drive 밖에 있어야 합니다. 설정은 앞의 경우를 거부하고 뒤의 경우를 경고합니다.
- 컴퓨터의 번들 이름은 호스트 이름에서 만들어 `.excudo/sync.json`에 두며, git은 이 파일을 무시합니다. 설정할 때 `--machine <이름>`으로 바꿀 수 있습니다. 이 컴퓨터가 쓴 적 없는 번들의 이름은 직접 골라도 거부하므로 한 컴퓨터가 다른 컴퓨터의 번들을 덮어쓰지 않습니다. 브랜치 이름이 다르면(`master`와 `main`) 새 컴퓨터는 첫 번째 받기에서 메모의 브랜치를 따르고, 둘 다 히스토리가 있는데 브랜치가 다르면 두 이름을 밝히고 실패합니다.

**git이 낯선 사용자를 위한 자동 동기화.** 설정에 `--auto`(또는 `auto: true`)를 붙입니다. 그러면 `excudo save`가 커밋한 뒤 올리기까지 하며, 커밋할 것이 없어도 오프라인에서 한 이전 커밋이 아직 올라가지 않았으면 올리고(올리기가 실패하면 경고만 내고 커밋은 남으므로 예약 실행도 올립니다), `sync`는 받기 전에 변경을 먼저 저장합니다. 설정은 `AGENTS.md`에 규칙을 더하며, 설정 검사는 `auto: true`인 작업 공간에서만 이 규칙을 요구합니다. 에이전트는 요청마다 메모를 읽거나 바꾸기 전에 `npx --no-install excudo sync --pull`을 실행하고, 끝에 `excudo save`를 실행합니다. 사용자가 git을 직접 실행할 일이 없습니다. 받거나 올리는 명령은 `sync`와 `auto`가 켜진 `save`뿐입니다.

**동기화되는 것.** git 히스토리입니다. 그래프, `save`가 커밋하는 기록, `excudo.config.mjs`가 들어 있습니다. `save`는 이것만 커밋하므로 `sync setup`과 첫 번째 올리기가 `init`이 그 곁에 쓴 파일 중 git이 아직 추적하지 않는 것도 커밋하고 목록을 보여 줍니다. `package.json`, `package-lock.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, 스킬 폴더입니다. clone에서 `npm install`을 하려면 이 파일이 필요합니다. 무시되는 파일과 사용자의 다른 추적 안 된 파일은 추가하지 않습니다. **동기화되지 않는 것.** `node_modules/`와 `.excudo/`(캐시, 에이전트 로그에서 읽은 요청, 컴퓨터별 상태)입니다. 컴퓨터마다 `npm install`로 설치하고, 에이전트 로그도 각자 읽습니다.

예약 실행은 한 컴퓨터에서만 돌립니다. 예약이 둘이면 같은 페이지를 동시에 씁니다. Syncthing 휴대폰 동기화는 별개입니다. git이 아니라 그래프 폴더를 공유합니다("Tine과 휴대폰 동기화" 참고). `sync-conflict` 검사는 Syncthing 같은 동기화 앱이 남긴 사본에 대한 것이며 이 명령과 무관합니다.
