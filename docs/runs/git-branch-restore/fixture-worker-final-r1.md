지정한 **3개 파일의 구현을 완료하고 쓰기를 중단했습니다.** self-approval은 하지 않았습니다.

- 초기 RED: 3개 실패 → 최종 fixture 전체 **503/503 PASS**
- 검사: `node --test --test-concurrency=1 --test-reporter=spec apps/desktop-app/scripts/fixtures/workbench-host.test.mjs`
- 3개 파일 모두 `node --check`, ESLint, Prettier PASS
- frozen source **25/25 해시·크기 일치**

최종 SHA-256:

```text
workbench-host.mjs
571ffc6ffbd43f211807a058f580071344f519e5f79d63336bf12e65bf74e000

workbench-host.test.mjs
7dad32ca0081e9aa18382e92774a3f18e995ae25be46e4031a8f7f3dc00e8d0c

e2e-git-branch-restore.mjs
2683c4281448b87f4a4eab1018ac066ebcf1bea7b53d4297fd4f8b4a18309458
```

앞의 두 파일은 `apps/desktop-app/scripts/fixtures/`, 새 runner는 `apps/desktop-app/scripts/`에 있습니다.

UI/build/Native는 실행하지 않았습니다. synthetic map 검사는 실제 Git/kernel/journal IO 증거가 아닙니다. Main의 runner·provenance 등록, 실제 실행, 독립 CODE/RENDER 검토가 남아 있습니다.
