# Actual supervisor API checkpoint

Source implemented by Host worker; tests and final source hashes pending. This is not Native acceptance or final source freeze.

Exports: executableForResources, endpointFrom, childEnvironment(root, platform, systemRoot?, namespace?), startSidecar({...existing options, namespace?, owner?, processIdentity?, preflight?}), OPEN_CODE_VERSION='2.0.18', openDurableManifest(namespace, owner), createOSProcessIdentityAdapter({platform?, probe?}).

namespace={root, documents, fresh, metadata, config, data, state}. prepareDurableNamespace(app) is synchronous in ephemeral-profile.mjs. configureEphemeralProfile(app,parent?,durableRoots?:string[]) checks overlap.

Durable start asserts ownership before setup, requires preflight to return true before spawn, flushes markSpawnIntent, captures exact child identity, records it before server info/read, and observes actual child exit. False/throw preflight causes zero spawn. Native startup creates no session.

Environment uses ephemeral HOME/cache/tmp/profile and durable XDG config/data/state. OPENCODE_CONFIG_DIR is namespace.config/opencode.

Runtime provides snapshot(), workbenchContext() => {client, session:undefined}, stop(), processId, workspace (ephemeral server cwd). stop returns {exited, forced, cleanup, recoveryPath?}; cleanup is complete/already_stopped/failed/incomplete. Errors preserve cleanupComplete and stopOwnedSidecar.

Darwin identity uses libproc and boot UUID; Linux uses /proc start ticks and boot ID; Windows is conservative unavailable. Same-boot historical PID absence is unverified. Controlled actual child exit and changed boot are stronger evidence. Preserve this limitation in probe output.

## Added actual production preflight checkpoint

freshNativePreflight(namespace, registry) is exported by sidecar-supervisor.mjs. It returns true only for namespace.fresh===true, ready registry, and no retained operations. Main checks it before startup owner intent and supplies the same decision to startSidecar. Nonfresh/no-retained is blocked because app receipts do not prove safe Native inbox startup. Actual source exists, but final source hashes/tests still pending.
