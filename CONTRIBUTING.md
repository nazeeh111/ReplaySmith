# Contributing

Start with a small, reproducible browser task. A useful change should improve a supported workflow or make a failure safer and easier to understand.

```sh
npm ci
npx playwright install chromium
npm test
npm run bench -- --repetitions 1
```

Use Node.js 22 or later. On Linux, `npx playwright install --with-deps chromium` installs the browser's required system libraries.

For recovery changes, add a fixture that measures the actual side effect. A `passed` report alone is not evidence of correct task completion. Include decoys and ambiguity cases; preserve abstention when the evidence does not distinguish targets. Document new evidence fields, import assumptions, and export compatibility.

Keep changes focused. Include what changed, the trigger it addresses, and the checks you ran. Report measured results with their denominator, supported mutations, and limitations. Do not add benchmark-only production shortcuts or generalize synthetic results to arbitrary websites.

Never include cookies, tokens, passwords, customer data, private URLs, or recordings from accounts you cannot share. Ask questions and report reproducible issues through this repository's issue tracker.
