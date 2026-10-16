# API credential exposure review — 17 October 2026

## Result

No API credential exposure was found in the inspected Git history, current source, built files, previous deployment archive, or fetched public web assets. This is a scoped review, not proof that a credential has never been disclosed elsewhere.

The public GitHub repository's `main` matched local commit `1c43858c1cfab4139a959b18069c68bcd6dac52c` before this change. All nine reachable commits and 98 unique Git blobs were scanned, including deleted historical file versions. There were no tracked environment-secret files, exact matches for the local credential, or matches for the credential patterns checked. GitHub's secret-scanning alerts endpoint returned an empty list at review time.

## Checks

- Compared the local credential in memory against source and artifacts without printing it or copying it into this report.
- Scanned 77 existing build files and the preceding deployment archive; no credential matches or packaged `.env` files were found.
- Fetched the live homepage and six linked/code-split public JS/CSS resources. No credential matches were found.
- Confirmed the live paths `/.env`, `/.env.local`, `/.git/config`, `/worker/bailian.ts`, `/dist/server/index.js`, and `/.openai/hosting.json` returned 404.
- Checked the available production error-log sample for the preceding seven days: three events, no common credential-pattern matches. This was a limited sample, not a complete historical log export.
- Confirmed the Bailian credential is read from the Worker runtime binding and used in server-to-provider Authorization headers. Browser requests use the application's own endpoints.

## Changes from this review

Upstream error bodies were previously incorporated into exception messages and could reach server logs. No actual credential exposure was observed, but an upstream response could potentially echo sensitive request details. Error handling now retains only an internally generated operation/status message and a billing-failure classification. Unclassified network exception messages are not logged.

Regression tests simulate a credential and private conversation text in upstream errors and network exceptions across conversation, transcription, speech and dream endpoints. They verify neither value appears in application logs or HTTP error responses, while billing failures retain the existing 402 response.

TypeScript's generated incremental cache was removed from tracking and ignored. This cache was not found to contain an API credential.

## Limits and remaining considerations

The audit did not read Alibaba Cloud billing/access records, recover complete historical provider/platform logs, or retrieve the production secret value. Exact-value comparisons used the current local credential; pattern scans cannot identify every possible credential format or transformation.

The public voice endpoints deliberately allow visitors to invoke paid provider operations. Their origin check and per-process rate limits are not authentication or a global spending ceiling. Credential confidentiality and prevention of service-cost abuse are separate concerns. This review did not change the public audience or add login requirements.

No credential was rotated, and no Git history was rewritten because this inspection found no exposed credential requiring removal.
