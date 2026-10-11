8개 파일을 **최종 freeze**했습니다. Main 실행 결과 전까지 수정하지 않겠습니다.

검사: Node **91/91 PASS**, ESLint·Prettier·TypeScript·boundaries·Node syntax·Python AST **PASS**. Native/UI/runtime은 실행하지 않았습니다.

실행 명령:

```sh
node apps/desktop-app/scripts/configuration-mcp-probe.mjs --out docs/runs/configuration-mcp/evidence/native-r1
```

경로 기준: `/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/scripts/`

| 파일 | SHA-256 |
|---|---|
| `configuration-mcp-probe.mjs` | `fd878773f92e59a64760d2c9d93c1aefbb4b12e23a58fcc34234b76d18b866c7` |
| `configuration-mcp-probe.test.mjs` | `1d269c988b31378d389419dee9d946aa213419c3075fd07aee069b90dff9a6fc` |
| `fixtures/synthetic-mcp-server.mjs` | `2de36d2c89d2d72cd3eada842f53d347831408de15b7124a0ff3c5c7327b4508` |
| `fixtures/mcp-exit-observer.py` | `4bc2a5876a88bdbf3796ab93de8adad6999365970ebeb38b74d2774d75bca19f` |
| `fixtures/p7-storage-owner-host.mjs` | `62228718345ac1e33f8d6b0bbbf42ca498e96c241e00586afe067f7e28d45739` |
| `fixtures/workbench-host.mjs` | `cadaa6be61458afe7bf3099238c9f6fbe8573cf7184c82bab130d7348ea1fcad` |
| `fixtures/workbench-host.test.mjs` | `2b9716a032a954760a711620755fdfda4a56f89e81e400b6ba423c3f72451909` |
| `e2e-workbench-states.mjs` | `6b3da53f7ab74aa9b44e34fe554af4ed3a4132027b7065507a77f1323b35c980` |

reopen assertion은 explicit `list` 1회 증가를 허용하도록 수정했습니다. 독립 CODE/RENDER 승인과 실제 Native/UI 검증은 Main에 남아 있습니다.
