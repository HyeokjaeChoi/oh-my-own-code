# Owner compatibility research
Date: 2026-10-04
Actual command: node work/p7-lock-probe.mjs from the continuation task workspace. Files here preserve the exact research source/observer and outputs; compiled observer originally ran from that work directory. This is macOS Electron44.4.4 compatibility research, not registered P7 acceptance or a portable product script.

A canonical temporary userData owner acquired the singleton before changing userData to a disposable profile. A second process targeting the original canonical owner path was rejected. An independent canonical path acquired a distinct owner. After confirmed SIGKILL/exit of the first process, the canonical path could acquire ownership again. No BrowserWindow, sidecar or provider was created. All owned processes exited and only the verified owned temporary probe root was removed. AppKit sampled OS frontmost state14 times;0 changed samples. Application names/IDs were not recorded. This sampling is a bounded observation, not a universal focus guarantee.

Initial observer compilation failed because the CommandLineTools compiler could not load the macOS26 standard library. No Electron process launched on that failed attempt. The configured Xcode compiler and macOS27 SDK compiled the observer; the later attempt passed. Preserve both attempts.

Remaining independent contract tests must cover real host integration, durable owner records, unknown or live sidecar children, corrupt state and Windows. Kernel acquisition alone does not prove child shutdown or safe receipt recovery. Resolve/store canonical owner path before ephemeral overrides; acquire against that path before any native launch. Actual P7 source integration must reuse and reverify this order with its durable record, not infer it from a fake owner API.
