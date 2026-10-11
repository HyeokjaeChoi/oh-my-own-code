# Static Node Runtime Dependency Audit

Date: 2026-09-28  
Method: read-only Mach-O inspection (`file`, `otool -L`, `otool -l`), symlink resolution, and SHA-256. No Node binary, library, canary, test, SDK, network, user configuration, or secret was executed or accessed.

## Entry executable

- Path: `/opt/homebrew/Cellar/node/26.8.2/bin/node`
- Architecture: arm64 Mach-O
- SHA-256: `902b6a6984d5d825829ea9064ab73b734548df37bc0683990dca31c8dc2a9253`
- RPATH: `@loader_path` and `@loader_path/../lib`; `@rpath/libnode.147.dylib` resolves to the versioned Node Cellar library.
- Minimum macOS version: 13.5; build SDK: 26.5.

## Inspected Homebrew Mach-O closure

Digests were calculated through Homebrew symlinks. The `opt` paths resolve into versioned Cellar paths, so a future runner must pin the resolved target identity and digest, not only the `opt` link.

| Runtime dependency | SHA-256 |
| --- | --- |
| `/opt/homebrew/Cellar/node/26.8.2/lib/libnode.147.dylib` | `88ff1063ca8ecdba021e48a56905d8b4c9af8874b654bafd164a562d2134b3d3` |
| `/opt/homebrew/opt/llhttp/lib/libllhttp.9.4.dylib` | `78cd1d7e5016246878a00dbaf76300628e5f48aa2174bf2e83fe1b31dc3e5691` |
| `/opt/homebrew/opt/libuv/lib/libuv.1.dylib` | `34d4e2cd30b56dca5bda539f4448667360f0994c6b337ffebc5d37d818bc15d5` |
| `/opt/homebrew/opt/ada-url/lib/libada.4.dylib` | `875a4ce73549e611b8183126248a2ba0f5837cae6460a612e0ea5de45b61d94c` |
| `/opt/homebrew/opt/simdjson/lib/libsimdjson.33.dylib` | `0030c2ad39507ca6224ae1713862667547ae1047538d46838e62e23c98203ea6` |
| `/opt/homebrew/opt/brotli/lib/libbrotlidec.1.dylib` | `d7ac1e69b6c443341fb4302de0169d187489d58d8a641c8eadd6db9ca2cd0cbf` |
| `/opt/homebrew/opt/brotli/lib/libbrotlienc.1.dylib` | `32e38a8ab06c8770ea4bfaf11ea324d7bcb6fe5f07eaff9d6260f93984ee6729` |
| `/opt/homebrew/opt/brotli/lib/libbrotlicommon.1.dylib` | `3426742c78df5c3b523071df603f07f2bb8dea6bd8e65c366a2c6adf2bf0a3ad` |
| `/opt/homebrew/opt/c-ares/lib/libcares.2.dylib` | `380a4b57ed007eecfd8b31d27feb3ea4749125e49780f8ca55dceb6112993c77` |
| `/opt/homebrew/opt/hdrhistogram_c/lib/libhdr_histogram.6.dylib` | `90286f692dd222d09642670523a5ef978f14b553614e6fa2d550dcb179e0d39c` |
| `/opt/homebrew/opt/merve/lib/libmerve.1.dylib` | `256e730f7ab9050b8606e5aee4948068177bcd9a99b5b7e9cae70ff069f98c10` |
| `/opt/homebrew/opt/nbytes/lib/libnbytes.dylib` | `b063a6b50d0982379e5a78fa22904e9299ac0048d82cae4f90bd4ad11fa40f65` |
| `/opt/homebrew/opt/simdutf/lib/libsimdutf.35.dylib` | `7eae911155bf830a47baebba551147f4d76d40dfcb6591f2624059c71f21b7c6` |
| `/opt/homebrew/opt/libnghttp2/lib/libnghttp2.14.dylib` | `530cc144437609d7345345d026edc992dcb878539c32e7f05cc76493819dd944` |
| `/opt/homebrew/opt/libnghttp3/lib/libnghttp3.9.dylib` | `67b632b1abcb414c15ace565a5cf37a44d1a46f87fa9d65d1346b70adc94a448` |
| `/opt/homebrew/opt/libngtcp2/lib/libngtcp2.16.dylib` | `2321f690a5ac5d3a859638ed28f58cf08fb3ce844ff9fa5fac7d2a0c2b9be0e7` |
| `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` | `6b8bb64feced74cd0766990ad5e089566be6fec655a6c96d4cc1358325afb35a` |
| `/opt/homebrew/opt/libffi/lib/libffi.8.dylib` | `e400b27537b9c7ff08e4e1d89fafc83e233020fcfb425a3ad25cb8c35029e1e1` |
| `/opt/homebrew/opt/uvwasi/lib/libuvwasi.dylib` | `c922288c5179279316b32b2c83d5c50d7b87216b442473ada8c99ef4a58ba312` |
| `/opt/homebrew/opt/zstd/lib/libzstd.1.dylib` | `e2847c4613b386683c234913ae3b7b04299254096caf7616e3b3cd9bb97a39ab` |
| `/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib` | `bae675614cd791d37ec35416ea9f87edcc85407d020810504cf458119b63522c` |
| `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib` | `c6ee373222087cf31bc2f3817537d268b3c23e56b7fadd44bbf5c2317caed349` |
| `/opt/homebrew/opt/icu4c@78/lib/libicui18n.78.dylib` | `f319e50c965a1a0065d2cc5595d8553ff60b0e78a2e76bc3173774fd112de9ed` |
| `/opt/homebrew/opt/icu4c@78/lib/libicuuc.78.dylib` | `177dab8ae0bf0b1357d7ec6404a1e145bcc3d927aa15c3064171d23b2a1fd263` |
| `/opt/homebrew/opt/icu4c@78/lib/libicudata.78.dylib` | `e7dafc3fe6613326daa30d1c930aa66219ab5524fe576b0e7b3039451652b6bf` |

Additional transitive edges found:

- Brotli decoder/encoder → `libbrotlicommon.1.dylib`.
- `libmerve.1.dylib` → `libsimdutf.35.dylib`.
- ICU `libicui18n` and `libicuuc` → `libicudata.78.dylib`.
- `libuvwasi` → `libuv.1.dylib`.
- OpenSSL `libssl.3.dylib` → the versioned Cellar `libcrypto.3.dylib`.

## Unresolved runtime inputs

The executable and dependency declarations also refer to `/usr/lib/libz.1.dylib`, `libresolv.9.dylib`, `libSystem.B.dylib`, `libc++.1.dylib`, and the CoreFoundation and Security frameworks. They were not ordinary files in this inspection environment; their dyld/shared-cache resolution and contents could not be hashed or recursively inspected. Static Mach-O dependencies also cannot establish dynamic reads selected by runtime arguments/environment, JavaScript modules, native addons, certificate overrides, ICU settings, or other optional inputs. Strings expose `NODE_ICU_DATA` and `NODE_EXTRA_CA_CERTS` as optional runtime inputs.

## Decision

The dependency closure is **not audited**. Static load-command enumeration and Homebrew file hashes do not prove the complete runtime read set, especially the dyld/shared cache and runtime-selected files. Keep the canary dependency gate closed and report all seven controls `unverified`; do not grant `/System`, `/usr/lib`, or Homebrew subtrees.
