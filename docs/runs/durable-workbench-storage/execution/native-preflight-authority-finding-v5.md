# Native preflight cannot use app receipts as inbox proof

Main inspected early production Main preflight: registry ready and retainedOperations length0. The Native inbox is independent authority. A confirmed app send receipt can acknowledge queue delivery while Native execution remains nonterminal; after abrupt exit no retained app receipt necessarily exists. Empty retained keys cannot prove Native startup will not resume/replay persisted work.

Contract v5 section9 requires pinned Native/provider-compatible safe startup proof before launch against original state. Until that read-only startup/preflight capability is actually verified, a nonfresh durable Native namespace must retain native_startup_unverified metadata facade even with zero retained keys and must not spawn. Fresh empty initialization is separately allowed. Controlled synthetic injected preflight does not establish production provider safety.

Main assigned this production launch-gate correction to the existing Host integrator, with zero-retained/nonfresh/no-proof zero-spawn regression. No Native SQLite mutation, credential inspection, automatic replay, or alternate engine is authorized.
