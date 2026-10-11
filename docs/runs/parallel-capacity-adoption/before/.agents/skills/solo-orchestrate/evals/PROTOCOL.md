# Routing evaluation protocol

The committed request set is a targeted rehearsal of the current routing instructions. Run each case with the current harness instructions and keep `rubric.json` hidden from the executor. Record request hashes, model/effort, route authority, captured responses, timestamps, and evaluator version. A separate grader judges anonymized captures with case-level evidence and uncertainty. This rehearsal can expose instruction omissions; by itself it does not measure comparative accuracy, token savings, runtime identity, or application behavior.

A full controlled A/B is a separate study: freeze requests and rubric, compare the instructions with an otherwise comparable control prompt, keep the execution model/effort and environment comparable, and capture both arms. Have a second independent grader compare accuracy, omissions, tokens, and time only where measured. Do not grade your own captures or fabricate missing execution.
