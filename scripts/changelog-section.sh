#!/usr/bin/env bash
# Print one version's section of CHANGELOG.md, for `gh release create --notes-file`.
# The changelog stays the single source of release notes, so a GitHub release
# body cannot drift from it. Defaults to the version in package.json.
#
#   scripts/changelog-section.sh          # current version
#   scripts/changelog-section.sh 0.1.0    # a specific one
set -euo pipefail

cd "$(dirname "$0")/.."
version="${1:-$(node -p 'require("./package.json").version')}"

section="$(awk -v v="$version" '
  # Heading lines look like: ## [0.1.1] — 2026-07-30
  index($0, "## [" v "]") == 1 { inside = 1; next }
  inside && /^## / { exit }
  inside { print }
' CHANGELOG.md)"

# Strip leading and trailing blank lines so the release body starts on content.
section="$(printf '%s\n' "$section" | sed -e '/./,$!d' | tac | sed -e '/./,$!d' | tac)"

if [ -z "$section" ]; then
  echo "error: CHANGELOG.md has no section for version $version" >&2
  exit 1
fi

if [[ "$version" == *-* ]]; then
  release_label="Prerelease"
  dist_tag="next"
else
  release_label="Stable release"
  dist_tag="latest"
fi

printf '> **%s** · npm `%s`\n\n' "$release_label" "$dist_tag"
printf '```bash\nnpm install -g titen-memory@%s\n```\n\n' "$version"
printf '[Install guide](https://titen.dev/docs/install) · '
printf '[Release page](https://titen.dev/releases/%s) · ' "$version"
printf '[npm package](https://www.npmjs.com/package/titen-memory/v/%s)\n\n' "$version"
printf '%s\n\n' '---'
printf '%s\n' "$section"
