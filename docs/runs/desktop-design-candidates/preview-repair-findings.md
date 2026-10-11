# Independent Astra/high review findings

Source: `/root/compact_preview_final_review`, bounded independent actual Chrome review. Preview design and code verdicts: changes_requested. No product or parent repair approval.

- D1: C textarea is focus-visible after Tab, but textarea outline:none!important and C composer outline:0 remove every visible focus indicator. Add token-based 2px focus on the actual input region; preserve borderless resting shelf.
- D2: Composer state specimens do not apply meaning to their own children. Sending/unknown/stale Send remains active. Stopping Stop remains active. Running/stopping agent/model selectors remain active. Archived textarea is editable. Error borderColor is applied to an element without a border, while the actual ::before edge remains default gray. Apply state to textarea, Send/Stop, context controls, actual border and associated reason/message. Preserve draft/no replay. Separate sendStop/input specimens do not satisfy compositor states.

Actual evidence: `/tmp/omoc-final-C-focus.png`, `/tmp/omoc-final-composer-states.png`. Reviewer checked source hashes, 38 PNG dimensions, 13 existing captures and two independent actual browser reproductions. Other arrangement/density/permission-scope cases were acceptable for this bounded synthetic comparison. Physical IME/native 200%/forced colors/reduced motion remain unverified, explicitly not a reason to certify production.
