# CaptRAW Governance

> 中文版本见 [这里](docs/GOVERNANCE_ZH.md)。

## Maintainers

The current maintainer is `@He0xD4C0`, who is responsible for merging,
releases, security response, licensing, and repository settings.

New maintainers are nominated by existing maintainers in a public issue,
documenting sustained contributions, review quality, and community
collaboration. A nomination requires explicit approval from the existing
maintainers and updates to both `.github/CODEOWNERS` and this document.

If a maintainer remains inactive for an extended period, voluntarily steps
down, or seriously violates the Code of Conduct, other maintainers may discuss
permission changes publicly. During the single-maintainer phase, the maintainer
must confirm the change personally or the GitHub account-ownership process must
be used.

## Decisions

Routine technical decisions are discussed in an issue or pull request. The
maintainer reaches a conclusion based on tests, compatibility, maintenance
cost, and community feedback. If consensus cannot be reached, the maintainer
must publish the decision and reasoning and allow the topic to be revisited
with new evidence.

The following changes require a separate pull request, advance notice, and
explicit review:

- changing the license or adding a relicensing arrangement;
- changing this document or maintainer permissions;
- changing DCO, CLA, or another contribution-certification mechanism;
- introducing a dependency that cannot be reconstructed from public sources.

GPL-derived code already merged into the project cannot be relicensed as
closed source by a maintainer's decision alone. Any future dual-licensing or
commercial-licensing arrangement requires valid authorization from the relevant
copyright holders and a separate public announcement.

## Releases

The release owner must verify that the version, test conclusions, complete
corresponding source, third-party licenses, and checksum files are consistent.
GitHub tags, application packages, and source archives form one release record;
publishing only a binary is not sufficient.
