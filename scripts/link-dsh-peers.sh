#!/usr/bin/env bash

set -euo pipefail

plugin_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
harness_root=${1:-${DSH_REPO:-"$(dirname "$plugin_root")/deepseek-harness"}}

if [[ ! -f "$harness_root/pnpm-workspace.yaml" || ! -d "$harness_root/packages" ]]; then
  echo "DeepSeek Harness checkout not found: $harness_root" >&2
  echo "Pass its path as the first argument or set DSH_REPO." >&2
  exit 1
fi

# Runtime peers plus packages imported only by the integration tests. Generic
# build dependencies stay in devDependencies so clean installs and CI remain
# reproducible; this list is only for local DeepSeek Harness workspace packages.
required_packages=(
  @deepseek-ai/cordis
  @deepseek-ai/dsh-agent
  @deepseek-ai/dsh-agent-default-model
  @deepseek-ai/dsh-agent-loop
  @deepseek-ai/dsh-agent-loop-testkit
  @deepseek-ai/dsh-api-remotes
  @deepseek-ai/dsh-api-session-controller
  @deepseek-ai/dsh-client-connection
  @deepseek-ai/dsh-client-locale
  @deepseek-ai/dsh-client-store
  @deepseek-ai/dsh-client-ui-conversation
  @deepseek-ai/dsh-client-ui-model-selection
  @deepseek-ai/dsh-client-ui-plugin-manager
  @deepseek-ai/dsh-client-ui-renderer
  @deepseek-ai/dsh-client-ui-settings
  @deepseek-ai/dsh-client-ui-slots
  @deepseek-ai/dsh-llm
  @deepseek-ai/dsh-plan-mode
  @deepseek-ai/dsh-session
  @deepseek-ai/dsh-session-projection
  @deepseek-ai/dsh-settings
  @deepseek-ai/dsh-system-prompt
  @deepseek-ai/dsh-tools
  @deepseek-ai/dsh-user-questions
  @deepseek-ai/schemastery
)

declare -A package_paths=()
while IFS=$'\t' read -r package_name package_path; do
  package_paths["$package_name"]=$package_path
done < <(node --input-type=module - "$harness_root" <<'NODE'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const root = process.argv[2]

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(path)
      continue
    }
    if (entry.name !== 'package.json') continue
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    if (typeof manifest.name === 'string') {
      process.stdout.write(`${manifest.name}\t${dirname(path)}\n`)
    }
  }
}

await visit(join(root, 'packages'))
await visit(join(root, 'vendor'))
NODE
)

linked=0
unchanged=0
for package_name in "${required_packages[@]}"; do
  target=${package_paths[$package_name]:-}
  if [[ -z "$target" ]]; then
    echo "Harness package not found: $package_name" >&2
    exit 1
  fi

  destination="$plugin_root/node_modules/$package_name"
  mkdir -p "$(dirname "$destination")"
  if [[ -L "$destination" ]]; then
    if [[ "$(readlink -f "$destination")" == "$(readlink -f "$target")" ]]; then
      unchanged=$((unchanged + 1))
      continue
    fi
    unlink "$destination"
  elif [[ -e "$destination" ]]; then
    echo "Refusing to replace non-symlink dependency: $destination" >&2
    exit 1
  fi

  ln -s "$target" "$destination"
  echo "linked $package_name -> $target"
  linked=$((linked + 1))
done

echo "DSH links ready: $linked updated, $unchanged already correct."
