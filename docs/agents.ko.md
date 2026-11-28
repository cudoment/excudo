# 에이전트와 지침

[README](../README.ko.md) | [English](agents.md) | 한국어

## 작업자와 독립 검토자 정하기

개선 작업을 구현할 에이전트 하나와 결과를 읽기 전용으로 검토할 에이전트 목록을 정합니다.
엔진은 역할 설정과 실행 인자를 보여 줍니다.
에이전트 실행은 호출자가 맡습니다.
`agents set`, `agents accept`, `agents decline`은 사용자가 요청하거나 승인한 뒤에만 실행합니다.

```js
agents: {
  worker: { tool: "codex", model: "gpt-6.1-sol", effort: "high" },
  reviewers: [
    { tool: "codex", model: "gpt-6.1-sol", effort: "xhigh" },
    { tool: "claude", model: "claude-opus-5-5", effort: "xhigh" },
  ],
  suggest: true,
},
```

`excudo.config.mjs`의 `agents`는 선택 설정입니다.
설정이 없으면 역할을 미정으로 보고합니다.
`agents --json`은 값과 출처, 권장값, 응답 대기 중인 제안을 보여 줍니다.
모델과 추론 수준을 비우거나 생략하면 도구 기본값을 따릅니다.

Codex 기본값은 `~/.codex/config.toml` 최상위의 `model`, `model_reasoning_effort`에서 읽습니다.
Claude 기본값은 CLI에 맡깁니다.
네트워크와 API 키는 쓰지 않습니다.

Codex 모델은 `~/.codex/models_cache.json`에서 읽습니다.
`CODEX_HOME`이 정해져 있으면 그 폴더에서 읽습니다.
`visibility: "list"`인 항목을 `priority` 오름차순으로 정렬합니다.
캐시가 없으면 오류 없이 목록 없음으로 보고합니다.

Claude 목록은 `src/agents.mjs`의 `CLAUDE_MODELS`에 순서대로 있습니다.
현재 Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 순서입니다.
ID는 `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`입니다.
추론 수준은 `low`, `medium`, `high`, `xhigh`, `max`입니다.
목록을 갱신할 때 이 상수와 시험, 영문, 국문 README를 함께 고칩니다.

최상위 모델은 제공사 목록의 첫 항목으로 추정합니다.
이 등급은 성능 측정 결과가 아닙니다.
권장은 두 번째 모델을 쓰며 작업자는 `high`, 검토자는 `xhigh`를 씁니다.
검토자 권장에는 작업자와 다른 제공사의 모델을 포함합니다.

두 번째 모델이나 지원하는 추론 수준이 없으면 해당 권장값은 미정으로 둡니다.
사용자가 직접 고른 최상위 모델은 유지합니다.
경고 없이 '최상위, 사용자 선택'으로 표시합니다.

```sh
npx --no-install excudo agents
npx --no-install excudo agents set worker --tool codex --model gpt-6.1-sol --effort high
npx --no-install excudo agents set reviewer --index 0 --tool claude --model claude-opus-5-5 --effort xhigh
npx --no-install excudo agents args worker --for orca
npx --no-install excudo agents args reviewer --index 0 --for cli
npx --no-install excudo agents suggest --new --json
npx --no-install excudo agents accept <id>
npx --no-install excudo agents decline <id>
```

화면의 검토자 번호는 1부터, `--index` 인자는 0부터 시작합니다.
`set`은 다음 인덱스에 검토자를 추가할 수 있습니다.
도구 기본값을 쓰려면 `--model "" --effort ""`를 넘깁니다.

`args --for orca`는 `orca orchestration worker-start`에 붙일 인자를 출력합니다.
`args --for cli`는 선택한 CLI에 붙일 인자를 도구 이름 없이 출력합니다.
빈 값의 플래그는 생략합니다.
응답 대기 중인 제안은 stderr에 승인 명령과 함께 알리며 종료 코드는 0입니다.

처음 관찰한 목록을 기준으로 새 상위 모델을 제안합니다.
Codex의 `upgrade` 필드와 목록에서 사라진 설정 모델도 제안 조건입니다.
직접 고른 모델이 최상위였던 역할에만 최상위로 바꾸자는 제안을 냅니다.
호출자는 새 모델을 쓸지 사용자에게 먼저 묻습니다.

`agents suggest --new`는 알리지 않은 제안만 출력하고 알린 것으로 표시합니다.
알린 때, 승인, 거절, 첫 모델 목록 지문은 `.excudo/agents.json`에 남습니다.
거절한 제안은 다시 내지 않으며 `suggest: false`는 제안을 끕니다.

설정 편집은 기본 내보내기 객체 맨 앞의 표식 구역을 씁니다.
파일에는 줄 시작의 `export default {`가 하나만 있어야 합니다.
다른 설정의 import, 함수, 정규식, 템플릿 문자열과 스프레드는 바이트 단위로 유지합니다.
기존 `agents` 값이 리터럴이면 처음 고칠 때 표식 구역으로 옮깁니다.
리터럴이 아니거나 내보내기가 모호하면 수동 편집을 안내합니다.

```js
export default {
  // excudo:agents start
  agents: { worker: { tool: "claude", model: "claude-opus-5-5", effort: "high" } },
  // excudo:agents end
  // 다른 설정은 이 자리에 둡니다.
}
```

이후 편집은 표식을 포함한 구역만 바꿉니다.
매번 별도 Node 프로세스에서 실제 설정을 import하고 `agents` 값을 확인합니다.
import가 실패하거나 값이 다르면 원문을 복원하고 필요한 수동 편집 값을 안내합니다.
사용자가 동시에 편집한 내용은 보존합니다.

## 세션 지침 크기 관리

`excudo instructions`는 `AGENTS.md`에서 작업 폴더 스킬로 옮길 절차를 보고합니다.
보고 명령은 한도를 넘어도 파일을 읽기만 합니다.
기본 한도는 줄바꿈을 포함한 32,768바이트이며 목표 크기는 한도의 85%입니다.
`instructions: { limit: 65536, target: 49152, auto: false, keep: ["항상", "프로젝트 > 안전"] }`으로 값을 정합니다.
`target`은 한도보다 작은 0 이상의 정수이며 `null`이면 기본값을 씁니다.

`excudo check`는 한도를 넘으면 `instructions-size` 경고를 냅니다.
목표를 넘고 한도 이내면 `instructions-target` 알림을 냅니다.
둘 다 예약 저장을 막지 않습니다.
작업 폴더의 검증에서 `instructions --check`를 실행하면 한도 초과 시 1, 나머지는 0으로 끝납니다.
목표를 넘으면 한 줄로 알리고 목표 이하면 아무것도 출력하지 않습니다.

```sh
npx --no-install excudo instructions --json
npx --no-install excudo instructions --check
npx --no-install excudo instructions --limit 65536
```

`instructions: false`나 `{ limit: false }`면 크기 제한과 후보 보고를 끕니다.
`--limit <바이트>`는 꺼진 제한도 이번 보고에 한해 바꿉니다.
설정한 목표가 새 한도보다 작으면 유지하고, 나머지는 새 한도의 85퍼센트를 목표로 씁니다.
파일이 없으면 크기는 0이고 후보도 없습니다.

`instructions.keep`에는 제목이나 ` > `로 이은 전체 제목 경로를 넣어 절과 하위 절을 고정합니다.
`<!-- excudo: keep -->`를 제목이나 최상위 목록 항목 바로 앞줄에 두어 원문을 고정합니다.
고정 항목은 중첩된 줄을 포함하며, 같은 절의 다른 항목은 후보로 남습니다.
엔진 템플릿 규칙은 언제나 원문대로 남습니다.

보고의 `pinned`는 고정한 절, 항목과 템플릿 규칙의 바이트 수이며 겹친 부분은 한 번만 셉니다.
`movable`은 나머지 크기이며 후보가 아닌 글도 포함할 수 있습니다.
`pinnedBlocks`는 보호 블록의 이름, 줄 범위와 크기를 담습니다.
`pinned`가 `target` 이상이면 `targetBlocked`가 참이고 큰 보호 블록을 경고로 알립니다.
크기 경고와 검증 명령도 이 이유를 알리며 검증의 종료 코드는 한도로만 정합니다.

후보는 512바이트 이상인 `##` 또는 `###` 절이나 최상위 목록 항목입니다.
코드 펜스와 주석 안의 제목과 항목은 블록으로 보지 않습니다.
작업 폴더 스킬을 명시하거나 명령, 코드 펜스, 번호 단계, 중첩 항목 세 개 이상의 절차 근거가 있어야 합니다.
후보는 큰 순서로 나열하고 겹치지 않으며, 옮길 수 있는 절 전체가 개별 항목보다 우선합니다.

가장 많이 언급한 작업 폴더 스킬을 대상으로 제안합니다.
백틱 안의 이름과 스킬 경로를 세며, 동률이면 이름순으로 고릅니다.
`skills.dir`과 `.agents/skills/`에서 찾고 엔진 스킬은 제외합니다.

명시한 작업 폴더 스킬이 없으면 기존 이름과 겹치지 않게 제목으로 새 이름을 제안합니다.
제목에 영문자와 숫자가 없으면 `workspace-procedure-<줄>`을 씁니다.
엔진 스킬을 언급했다는 이유만으로 일반 규칙을 작업 폴더 절차로 보지 않습니다.

제목 절 하나나 최상위 목록 항목 하나를 원문 그대로 옮깁니다.

```sh
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "배포 근거를 보존할 것." --dry-run
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "배포 근거를 보존할 것."
```

대상은 이미 있는 작업 폴더 스킬이어야 하며 엔진 스킬은 거부합니다.
고정한 글, 엔진 템플릿 규칙, 일부만 지정한 블록도 거부합니다.
`--since`가 없으면 `AGENTS.md`, 대상 `SKILL.md`, 기존 참고 파일이 추적 중이며 변경이 없어야 합니다.
원문은 `skills/<스킬>/references/<이름>.md`에 붙이고 새 파일에는 제목을 만듭니다.
`SKILL.md`의 참고 절을 재사용해 링크를 한 번만 추가합니다.

기존 블록은 두 개까지 지정한 `--pointer` 줄로 바꾸며, 필요하면 대상 스킬을 알리는 문구를 붙입니다.
이 파일들과 지침 캐시만 쓰며, `--dry-run`은 쓰지 않고 `--json`은 결과를 출력합니다.
명령 자체는 스킬을 만들지 않습니다.

`--since <기준>`을 지정하면 저장한 기준 커밋 이후 여러 블록을 한 번에 옮길 수 있습니다.
템플릿 규칙, 고정한 글, 삭제 구간을 보존할 때만 지침과 스킬의 미커밋 변경을 허용합니다.
다음 블록을 옮기기 전에 보고를 다시 읽어 현재 줄 범위를 찾습니다.

삭제 구간은 기준 문서의 2/3단계 제목 절과 최상위 목록 항목 경계에서 나눕니다.
각 조각의 줄은 한 파일 안에서 붙어 있어야 하며 기준 커밋만큼 자주 나와야 합니다.
서로 다른 참고 파일로 옮겨도 각 조각이 보존되면 통과합니다.
양쪽에서 `AGENTS.md`와 스킬의 Markdown을 합쳐 검사하고, 빈 줄뿐인 조각은 무시합니다.
기준은 git에서 읽고 HEAD와 비교하며, `--uncommitted`를 지정하면 작업 트리와 비교합니다.

커밋 전에는 스킬 검사에 `--trim-since <기준> --uncommitted`를 지정합니다.
지침, 스킬, 기록과 링크의 변경만 허용하며 다른 미저장 작업은 계속 검사합니다.
`--uncommitted`가 없으면 이동 결과도 저장한 상태여야 합니다.

`excudo-skills`는 요청받으면 절차를 옮기고 매 세션 필요한 규칙은 안내 줄에 남깁니다.
`instructions.auto: true`면 예약 실행에서 한도를 넘을 때 정리를 시작하고 목표 크기까지 옮깁니다.
이동 명령으로 큰 후보부터 옮기며 대상 스킬의 설명이 절차를 포함하는지 확인합니다.
새 작업 폴더 스킬은 이미 있는 스크립트, 검사, 알려진 성공/실패 사례로 만들 수 있어야 합니다.
그렇지 않으면 블록을 남기고 이유를 보고합니다.

보존 검사, `excudo check`, `skills lint`를 통과한 뒤 지침과 스킬을 함께 한 번 커밋합니다.
검사가 실패하면 바꾼 파일을 기준 커밋에서 복원하고 이번 실행에서 만든 파일만 삭제합니다.
`auto`를 켜지 않으면 예약 실행은 후보만 보고합니다.
보호된 크기 때문에 목표에 도달할 수 없어도 한도를 넘으면 자동 이동을 계속합니다.
한도 이내가 되면 보호 블록을 보고하고 정리를 멈춥니다.

JSON은 파일을 `file`, `exists`, `bytes`로 나타냅니다.
예산은 `enabled`, `limit`, `target`, `auto`로 나타냅니다.
초과 여부는 `aboveTarget`과 `over`이며 후보의 최소 크기는 `threshold`입니다.
`candidates`는 `kind`와 `headingPath`, 양끝을 포함한 `startLine`/`endLine`으로 블록을 나타냅니다.

각 후보에는 `bytes`와 `target`, `engineSkills`와 `reason`도 있습니다.
후보 원문은 출력하지 않습니다.

`lastTrim`은 마지막 정리의 크기와 커밋이고 `growth`는 이후 바이트 증가량입니다.
기록이 없으면 둘 다 `null`입니다.
이동이 성공하면 무시되는 `.excudo/instructions.json` 캐시에 기록합니다.

보존 검사를 통과하고 `AGENTS.md`와 스킬 파일을 커밋하면 정리 커밋으로 갱신합니다.
다른 메모의 미저장 변경으로 전체 검사가 실패해도 갱신하며 검사의 실패 종료 코드는 유지합니다.
`--uncommitted`, `--facts`, `--self-test`는 캐시를 갱신하지 않습니다.
텍스트 보고도 기록이 있으면 증가량을 출력합니다.
