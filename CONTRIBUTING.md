# Contributing to CaptRAW

[简体中文](docs/CONTRIBUTING_ZH.md) · English

Thank you for contributing to CaptRAW. Please read this guide before submitting
code, documentation, tests, translations, designs, or other work intended for
the repository.

## Licensing and contributor certification

CaptRAW is released under `GPL-3.0-or-later`. By default, your contributions
are provided under the same license. The project uses the
[Developer Certificate of Origin 1.1](DCO) and does not require a copyright
assignment.

Every regular commit must be certified by its author with a sign-off using a
real, identifiable author identity:

```sh
git commit -s -m "feat: describe the change"
```

The sign-off must match the commit author:

```text
Signed-off-by: Your Name <your-email@example.com>
```

To add a missing sign-off to the current commit:

```sh
git commit --amend -s --no-edit
```

For multiple commits, use an interactive rebase to add a sign-off to each
commit. Do not sign on behalf of another contributor. Do not submit code,
media, models, fonts, or data whose origin or licensing cannot be verified.

## Third-party material

When introducing third-party code or assets, the pull request must include:

- the upstream project, pinned version or commit, and a direct link;
- the exact license and any required copyright, patent, or NOTICE material;
- checksums and the source of tests or sample data;
- if an upstream file is modified, a clear description of the changes and
  preservation of existing notices.

Update `THIRD_PARTY.md` and the packaging inventory at the same time. Material
with an unknown source or an incompatible license must not be merged.

New CaptRAW source files must include:

```text
SPDX-License-Identifier: GPL-3.0-or-later
```

Do not bulk-rewrite historical copyright headers in existing files.

## Development and verification

See [README.md](README.md) for environment setup, native dependencies, and
full build instructions. Common checks:

```sh
pnpm install --frozen-lockfile
pnpm ci:check
```

When changing the native core, display pipeline, export path, or user
interaction, also run the relevant integration, native, or E2E checks. Tests
must use temporary directories and clean up intermediate files. Commits should
retain only reproducible fixtures and explicit deliverables.

Pull requests should stay focused and explain the problem, behavioral changes,
test results, licensing impact, and anything that still requires human
confirmation. Interface changes must be opened and exercised through the
affected controls; proving that an internal function can be called is not
enough.

## Branches and merging

1. Create a branch from the latest `main`; do not develop directly on the main branch.
2. Keep commits independently reviewable and add a DCO sign-off to every regular commit.
3. Open a pull request and resolve CI, type-check, test, and review findings.
4. Maintainers use **Rebase and merge** to preserve a linear history and commit sign-offs.

The main branch requires a pull request, CI, DCO, and code-owner review. Force
pushing or deleting `main` is prohibited. Any emergency exception must be
explicitly justified by a maintainer.

## Conduct and security

All communication follows the [Code of Conduct](CODE_OF_CONDUCT.md). Do not
disclose security vulnerabilities publicly; report them privately as described
in the [security policy](SECURITY.md).
