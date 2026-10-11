# Runtime-info boundary

**Design contract v0.1 · 2026-09-27 · build-delivery AC-8.** This contract applies to one bridge-owned read of the pinned `@opencode/client@2.0.18` `server.info()` response through an injected, synthetic fetch. It is a backend observation boundary, not a browser API or host-lifecycle decision. The current [task plan](../runs/build-delivery/plan.md) is revision 7 (`7bcacee7766d65c157a9b1e8b402f9a77e792f6907c89a045b084a62546999d3`); the [next-runtime proposal](../runs/build-delivery/next-runtime-proposal-r1.md) informed the scope but does not itself amend that plan. Independent `design_spec` and plan review are required before dependent implementation.

## Admission and returned value

The validator takes `unknown`, irrespective of the client's static `ServerInfo` type. It accepts only a non-null, non-array object with **own data properties** for the four required public fields below. Missing fields, accessors, wrong nested shapes, and limit violations produce `invalid_response`. Extra fields are permitted but ignored; no source object is spread, serialized, or retained. These are **application admission limits**, not claimed SDK limits.

| Required field | Admission rule | Retention |
| --- | --- | --- |
| `version` | String of 1–128 UTF-8 bytes, matching `^[A-Za-z0-9][A-Za-z0-9._+-]*$`. Preserve the accepted bytes; do not trim or infer semantic-version compatibility. | Copy into a fresh `{version}` value only. |
| `pid` | Finite, positive safe integer. | Validate, then discard. Never use for process identity, ownership, or termination. |
| `urls` | Array of at most 16 strings; each is 1–2,048 UTF-8 bytes. An empty array is valid. | Validate, then discard. Never parse for connection, request, discovery, or logging. |
| `paths.tmp` | `paths` is a non-null, non-array object with an own data property `tmp`; `tmp` is a string of 1–4,096 UTF-8 bytes. | Validate, then discard. Never use as a filesystem or cleanup target. |

The validator does not interpret URL schemes or filesystem path semantics because neither value is consumed. If future code needs either, it requires a separate reviewed authority and validation contract. Type admission alone does not show that a server is compatible, reachable, authenticated, owned by this bridge, or safe to mutate. A version that passes this shape check remains **compatibility unverified** until a separate pinned-version capability check exists.

## One-read observation and fixed outcomes

The wrapper receives only an explicitly supplied `() => Promise<unknown>` read function. It calls that function at most once per invocation and validates its resolved value. It creates no client, default fetch, service discovery, host startup, subscription, retry, persistence, logging, or browser request. A rejected read becomes `read_failed`; the wrapper neither inspects nor returns the rejection reason. A resolved but invalid value becomes `invalid_response`. A valid value becomes `info_validated`.

| Outcome | Exact public result | Meaning |
| --- | --- | --- |
| Valid response | `{kind: "info_validated", info: {version}}` | One response passed local shape admission only. |
| Invalid resolved response | `{kind: "invalid_response", code: "INVALID_SCHEMA"}` | No validated info. |
| Rejected read, including transport, HTTP, or JSON failure | `{kind: "read_failed", code: "RUNTIME_UNAVAILABLE"}` | No validated info and no proven cause classification. |

Results have no raw response, `cause`, message, stack, request URL, PID, path, or extra native field. `read_failed` is not `AUTH_REQUIRED`; arbitrary transport and HTTP failures cannot prove an authentication state. None of these outcomes is `host_running`, process health, `sourceHealth=available`, mutation readiness, or an authorization to act. A later authenticated adapter may introduce evidence-backed states under a separate reviewed contract.

## Diagnostic and provenance boundary

General diagnostics project only `{kind, code?, provenance}` from the result, where `provenance` is the fixed literal `synthetic-injected-client` supplied by the synthetic probe. The success version is deliberately omitted from this diagnostic projection. Raw errors and responses must never be interpolated into test reports, logs, browser payloads, incident records, or thrown diagnostic messages. PID, URLs, paths, unknown fields, response text, and stack traces are excluded even if the SDK calls them public metadata. The synthetic tag must remain visible in every probe report; a later real observation must use its own reviewed provenance contract and cannot inherit this label.

The bridge's existing snapshot/event `source: "synthetic-fixture"` stays unchanged. Native info must not be merged into that fixture or exposed through `/health`, `/api/snapshot`, `/api/events`, or a new browser route. The existing monitoring design still requires local redacted incidents, real source health, recovery evidence, and version compatibility handling; this read establishes none of those operational claims.

## Testable acceptance and limits

- Pure validation covers null and arrays, each missing required field, wrong primitives and nested shapes, accessors, PID zero/negative/fractional/non-finite/unsafe values, byte and array boundaries, blank or unsafe version, and extra fields. It proves a fresh `{version}` copy and no leaked native metadata.
- The actual pinned client with injected fetch feeds the same bridge validator/wrapper. A complete response yields `info_validated`; an incomplete but client-resolved response yields `invalid_response`; malformed JSON, transport rejection, and non-2xx response yield `read_failed`. Each case makes exactly one injected `GET /api/info` with no body and zero ambient-fetch calls. The wrapper never retries.
- Secret, path, HTML, and prompt canaries placed in unknown fields, URL/path fields, and thrown errors are absent from every result and diagnostic/report projection. Probe output states its synthetic provenance and does not claim live runtime or compatibility.
- Importing the validator has no activation side effects. A hostile JavaScript Proxy can execute its own traps during inspection; the validator must reject thrown inspection failures as `INVALID_SCHEMA`, and this contract makes no guarantee about side effects inside caller-supplied objects. The intended SDK JSON response is inert data.

This increment does not choose an embedded host versus service client, start or attach to a host, change packages, install dependencies, read user projects, pick persistent data paths, add network/process authority, or satisfy S-01 host lifecycle, S-08 control-channel security, S-09 recovery, AC-2 runtime completion, AC-6 monitoring completion, or PRD AC-01–18. Its tradeoff is deliberate: validating discarded PID/URL/path fields catches malformed native responses while retaining only the version needed for a future compatibility decision. The fixed failure codes protect diagnostics but provide no root-cause classification; that requires separately bounded evidence.
