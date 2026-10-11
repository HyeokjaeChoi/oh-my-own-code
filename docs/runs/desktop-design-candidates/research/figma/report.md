# Figma reference evidence

Observed 2026-10-03 through the actual Figma MCP connector, read-only. Existing project reference: https://www.figma.com/design/e6QYqEsmA3FHB6A2ohNr2o . This is our existing foundation, not an independently observed ChatGPT or Claude kit.

The initial metadata call without a node reported only Cover; a read-only Plugin API inventory recovered the actual 12 pages. Three collections contain 61 primitive, 65 semantic and 37 component variables. Input page 5:6 and NavigationItem page 5:8 were independently read. Actual get_design_context renders for Input 7:2 and NavigationItem 7:106 were inspected.

Input: default 280×70 total labelled field group; 40px shell, 12px horizontal inset, 8px label gap; 16px Noto Sans KR text, 24px body line-height. Navigation: 220×40 row, 12px inset, 16/22 label, 12px corner radius. These are measured Figma reference values, not browser hit-test results. Current application values separately include 256px sidebar, 44px rows and 128px initial composer. The new user feedback rejects retaining these as aesthetic defaults.

Published-library Input search returned no components; the server clamped a three-item batch to one query. Navigation and font searches in that batch were not processed. On-canvas Plugin API inspection succeeded; empty published search is not evidence that local components are absent.

The official shadcn Figma catalogue was visited with agent-browser in an isolated session and captured in shadcn-figma-catalogue.png: https://ui.shadcn.com/docs/figma . Its public community kits are links, not MCP-inspected kits or approved dependencies. No community file was imported, no existing Figma file edited, and no library was published.

For synthesis: preserve existing neutral palette and font identity by default; separate smaller navigation/metadata typography from readable conversation text. Composer tokens must distinguish empty height, input growth, toolbar, focus and attached-content states. Desktop pointer geometry must not blindly inherit generic mobile 44px visual boxes. This is a hypothesis for the three candidate systems, not a production decision.
