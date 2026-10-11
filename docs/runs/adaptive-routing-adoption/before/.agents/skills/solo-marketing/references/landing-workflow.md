# Landing page and campaign workflow

## Message contract

Write down:

- the audience and situation;
- the painful current state in the user's language;
- the product promise and time to first value;
- proof available now, with source;
- the primary action and what happens after it;
- the main objections and honest answers;
- claims that must not be made yet.

The hero should identify the user outcome and primary action without relying on later sections. Build the rest of the page around a coherent path: problem recognition, product mechanism, proof, objection handling, and action. Add sections only when they move that path forward.

## Implementation contract

Reuse the current application shell, tokens, primitives, image pipeline, and analytics definitions. Confirm metadata, canonical URL, sharing image, focus order, semantic headings, keyboard behavior, color contrast, responsive layout, reduced motion, image dimensions, and loading behavior as applicable.

The primary CTA must have a real destination and clear post-click state. Define a semantic analytics event with owner, trigger, allowed properties, and deduplication rule. Avoid counting render or scroll events as conversion without a product reason.

## Evidence

Inspect the rendered page at the smallest and largest relevant widths. Capture the hero, primary CTA destination, and any stateful form. Record route, revision, viewport, locale, screenshot path, runtime errors, and unverified external integrations. If deployed, verify the actual preview URL and distinguish deployment from publication to production.
