# 개발

[README](../README.ko.md) | [English](development.md) | 한국어

## 개발

테스트 파일을 동시에 실행하며 코어 14개에서 약 75초가 걸립니다. 모든 테스트가 자신의 임시 폴더와 GitHub, Vercel, npm 대역을 쓰므로 네트워크가 필요하지 않습니다.

```sh
npm install
npm run example
npm test
npm pack --dry-run
npm run release:check
```

빌드 단계 없는 ESM JavaScript와 node:test를 씁니다. README나 docs 문서를 고치면 다른 언어의 짝도 함께 고치고, 메시지는 두 언어로 함께 추가합니다. 두 언어의
메시지가 같은지는 테스트가 확인합니다. CI는 Linux, macOS, Windows에서 Node 22와 24로 테스트하고 묶은 tarball을 설치해 봅니다.
필요한 환경이 없으면 macOS 앱과 POSIX 전용 대역 검사를 건너뜁니다.

git 이력을 읽는 라이브러리 함수(`check`, `review`, `keepCandidates`, `move`, `archive`)는 Promise를
돌려주며, blame은 여러 파일에 동시에 실행합니다.
엔진은 레지스트리 패키지 `@cudoment/cudoc@^1.1.0`을 씁니다.

깊이 6, 생성물 보호와 접힘 유지, NFD 이름, 명령, 날짜를 고정한 git 후보, 완료 보관, 설치,
환경 변수, 커밋된 예시를 검사합니다. 코드 예시 보존, 캐시 삭제, 이동 후 보호, 묶음 남김,
CLI 인터뷰의 답변 반영, 저장, 해당 묶음 되돌리기, 읽지 못한 이력, 이력 캐시, 이동 후 나이,
보관 보호도 검증합니다. Tine doctor와 모델 호출 없는 Codex 스킬 인식은 설치되어
있으면 검사하고 없으면 전제 조건과 함께 건너뜁니다. 수동 Claude Code, Codex 인터뷰 검증은
`test/fixtures/messy/`의 사본을 쓰며 개인 메모는 쓰지 않습니다.

엔진 버전을 올릴 때 입구 스킬의 버전 범위도 바꿉니다. 테스트가 정합성을 확인합니다.
게시하기 전에 `npm run release:check`를 실행합니다(`npm publish`도 먼저 실행합니다). 복제본이 `main`에
커밋되어 있는지, 버전에 아직 태그가 없는지, 입구 스킬이 그 버전을 설치하는지, 테스트가 통과하는지,
예시가 최신인지, 모든 스킬이 100점인지, 패키지에 들어갈 파일이 맞는지 확인합니다. 로컬 복제본을
`file:`로 쓰는 작업 폴더는 계속 복제본을 실행합니다. 게시한 버전으로 옮기려면 그 폴더에서
`npm install excudo@^<버전>`을 실행하고 검사를 돌립니다. 연결한 스킬은 `node_modules`를 거쳐
가리키므로 어느 쪽이든 따라갑니다.
`src/dialects/logseq.mjs`에 아웃라이너 문법을 모으며, `skills/`가 스킬의 유일한 원본이고 두
에이전트 폴더에는 링크만 둡니다. 개인 메모는 복제본 밖이나 무시되는 `private/`에 둡니다.
패키지에는 스킬, 템플릿, 더미 예시가 들어가고 캐시는 빠집니다.

공개하면 안 되는 낱말(자기 이름, 호스트, 이슈 키)은 `private/denylist.txt`에 한 줄에 하나씩 적습니다. git이
추적하거나 더할 파일의 글이나 경로에 그 낱말이 있으면 `node scripts/denylist.mjs`와 테스트,
`release:check`가 실패합니다. 목록이 없으면 비교하지 않고 통과합니다.

MIT 라이선스입니다.
