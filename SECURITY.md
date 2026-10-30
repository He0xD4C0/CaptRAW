# Security Policy

> 中文版本见 [这里](docs/SECURITY_ZH.md)。

## Reporting vulnerabilities

Do not disclose unfixed vulnerabilities, exploit code, user photos, paths,
credentials, or other sensitive information in public issues, discussions, or
pull requests.

Report vulnerabilities privately through the repository's
**Security → Advisories → Report a vulnerability** flow. Repository owners must
keep GitHub Private Vulnerability Reporting enabled.

Reports should include the affected version, platform, reproduction steps,
impact, and a minimal sample where possible. After receiving a report,
maintainers use a private advisory to acknowledge receipt, assess impact, and
coordinate remediation and disclosure. Response time depends on severity and
maintainer availability; no fixed SLA is promised.

## Supported scope

Security fixes are prioritized for `main` and the latest release. Users should
verify the `SHA256SUMS` file and obtain installation packages only from project
GitHub Releases or mirrors explicitly documented by the project.

## Out of scope

- upstream vulnerabilities already confirmed by a third party but not yet
  adopted or distributed by CaptRAW;
- scenarios requiring an attacker to already control the local account,
  modify system libraries, or replace application files;
- issues affecting only features explicitly marked experimental that have no
  declared security boundary.
