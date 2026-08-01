# Security Policy

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/Bimmiest/propslab/security/advisories/new) — the **Security** tab, then **Report a vulnerability**. Please do not open a public issue for a security problem.

Expect an acknowledgement within a week. If a report is valid, the fix and the advisory go out together.

## What this application is

Propslab is a static, client-side app. It has no backend, makes no network calls, and persists no user data anywhere but the browser's own `localStorage` (panel sizes and a handful of UI preferences). Config and log text typed into it stays in the tab; it is never transmitted.

That shape rules out most of what a security policy usually covers — there is no server to compromise, no session to steal, no database to exfiltrate — and it means the real attack surface is narrow and specific.

## In scope

- **Cross-site scripting**, particularly through the paths that render user-controlled text: event `_raw`, extracted field names and values, diagnostic messages, and Monaco hover/completion content.
- **Prototype pollution** through field names. Extracted names come from user data and are written into plain objects; `src/engine/utils/fieldBag.ts` exists specifically to make that safe, and a bypass of it is a real finding.
- **Content Security Policy weaknesses.** The policy is asserted by the e2e suite against the production build; a way to load or execute anything it is meant to forbid is in scope.
- **Dependency vulnerabilities** that are actually reachable from this application's code. CI runs `npm audit` on production dependencies for every PR.
- **Denial of service through pathological regular expressions**, where a config could hang the browser. Note the existing mitigations before reporting: user regexes run in terminatable Web Workers behind watchdogs, and `safeRegex` refuses structurally ReDoS-prone patterns. A pattern that defeats *both* is a finding; one that merely takes a while is expected — see the README's notes on the limits of the heuristic.

## Out of scope

- **Simulation fidelity bugs.** Output that disagrees with real Splunk is a correctness bug — please file it as a normal issue, ideally with a fixture. It is not a vulnerability.
- **Anything requiring the user to paste attacker-supplied config and then trust the result.** Reading untrusted config is the application's entire purpose; the guarantee is that doing so cannot execute code or leak data, not that the displayed output is trustworthy advice.
- **Findings against the deployed host's headers or TLS** that are configuration of Azure Static Web Apps rather than of this repository — though a report is still welcome if something looks wrong.
- **Self-XSS** requiring the user to paste content into their own devtools console.

## Supported versions

The deployed application is built from `main`, and fixes land there. There is no support branch for older releases.
