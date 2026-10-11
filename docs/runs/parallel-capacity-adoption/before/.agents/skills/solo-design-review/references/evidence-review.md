# Implemented design evidence

## Establish the target

Record the run, revision or build, route or deep link, user state, locale, theme, viewport or device, and the user task being tested. Use demo data that exposes real layout conditions, including long text and empty/error states where relevant.

For every finding capture:

- exact screen and state;
- action sequence needed to reach it;
- expected and observed result;
- screenshot or recording path;
- console, runtime, or network evidence when it explains the defect;
- whether the observation came from the running implementation or an accessible implementation capture; label Figma and source inference as references only.

Screenshots should include enough surrounding UI to locate the problem. Avoid collecting unrelated tabs, credentials, tokens, personal data, or other private account content.

## Audit passes

Use only applicable passes:

1. Can the user identify and complete the primary task?
2. Are all reachable states intentional and recoverable?
3. Does the visual hierarchy match the product's priority?
4. Do semantic tokens and component states match the approved system?
5. Does the flow work at the smallest and largest relevant sizes?
6. Can keyboard, assistive technology, text scaling, and touch users operate it?
7. Does the result look deliberately designed rather than assembled from generic defaults?

## Fix verification by a fresh independent reviewer

After the implementer corrects an issue, independently reproduce the original state. Capture the same viewport/device and action path, compare before and after, and check for new runtime errors. Classify the result as verified, partly verified with the missing condition named, or unresolved. A changed source file is not a verified fix.
