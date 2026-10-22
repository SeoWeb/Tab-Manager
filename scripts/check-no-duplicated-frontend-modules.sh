#!/usr/bin/env bash
#
# Guardrail for the `packages/shared` extraction (OpenSpec change
# `cleanup-and-regression-tests`, task 3.5): fails when a module file exists at
# the same relative path under BOTH the extension source (`src/`) and the web
# frontend (`frontend/src/`).
#
# Same-path duplication is what made the old tsconfig `@/*` shadowing work (a
# frontend/src file silently won over its src/ counterpart). Since task 3.2 the
# frontend tsconfig maps `@/*` to `../src/*` only, so a reintroduced same-path
# file would either break the web build or silently change which copy the web
# app compiles. Code needed by both consumers belongs in `packages/shared`,
# imported as `@tabspace/shared/*`.
#
# Exemption: `app/**` is allowed to exist in both trees. Those are Next.js App
# Router entry files (layout/page/assets) that each app MUST provide at that
# path; they are never imported via `@/` (verified: no `@/app/...` imports
# exist), so they cannot shadow a module.
#
# Usage: bash scripts/check-no-duplicated-frontend-modules.sh

set -euo pipefail
cd "$(dirname "$0")/.."

status=0
while IFS= read -r file; do
  rel="${file#frontend/src/}"
  case "$rel" in
    app/*) continue ;; # Next App Router entry files — see exemption above.
  esac
  if [ -e "src/$rel" ]; then
    echo "DUPLICATED: frontend/src/$rel also exists at src/$rel" >&2
    echo "  -> move the shared code to packages/shared and import it as @tabspace/shared/*" >&2
    status=1
  fi
done < <(find frontend/src -type f | sort)

if [ "$status" -ne 0 ]; then
  echo "check-no-duplicated-frontend-modules: FAILED" >&2
  exit 1
fi

echo "check-no-duplicated-frontend-modules: OK (no module duplicated between frontend/src and src/)"
