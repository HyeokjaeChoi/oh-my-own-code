# Computer use in this environment

Checked 2026-09-13 on standalone ARM64 macOS Codex CLI 0.154.0. The current conversation exposes no callable desktop-control or browser-control tool. `computer_use`, `browser_use`, and `in_app_browser` already report enabled; these flags alone do not install a backend or grant OS permissions.

CLI plugin discovery found no Computer Use plugin. No ChatGPT/Codex desktop application was found in the standard system or user Applications directories. This is a local capability observation, not a claim about every future CLI version or installation location. No supported activation path for whole-desktop control in this running CLI session was established, and no redundant flags or substitute service were installed.

The official setup uses the ChatGPT desktop app: select Codex, open Plugins → Computer Use, install/enable its server and skill, grant macOS Screen Recording and Accessibility access, then approve the target app and verify a small real task. Availability depends on account, region, app version, and policy. OS consent must come from the user. [Official Computer Use setup](https://learn.chatgpt.com/docs/computer-use)

Browser automation through a browser-specific tool can support web UI verification, but does not provide whole-desktop control. The API computer-use route requires its own implemented runtime and API execution. Neither is a configuration-only activation of the native feature in this CLI session. [API computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)

The design QA and mobile roles must state missing browser/device access and never claim screenshots, interactions, or store flows were verified merely from source review. Reassess capabilities in the actual session used for product work.
