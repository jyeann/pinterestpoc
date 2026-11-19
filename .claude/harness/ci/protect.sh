#!/usr/bin/env bash
# Required checks are pinned to the GitHub Actions app (integration_id 15368), so a commit status posted
# by some other token under the same name does not satisfy them.
# Create or update a branch ruleset that makes CI the only way into the default branch.
# Dry run by default: prints the payload and sends nothing. Needs `gh` logged in with repo admin rights.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GH_BIN=${GH:-gh}
repo="" checks="" approvals="" apply=0 nobypass=0

usage() {
  cat <<'USAGE'
usage: protect.sh [--repo owner/name] [--checks a,b] [--approvals N] [--no-bypass] [--apply]
  --repo       default: parsed from `git remote get-url origin`
  --checks     required status check names (default: those in ruleset.json)
  --approvals  required approving reviews (default 0, i.e. a PR is required but a solo owner can merge)
  --no-bypass  remove the admin bypass, so nobody (an admin token included) can merge past the required checks.
               Use it when an agent works with an admin token. The human override is then to switch the ruleset off in Settings.
  --apply      actually create/update the ruleset (default: dry run)
Push the CI workflow and let it run once first: a required check that never reports blocks every merge.
USAGE
}
die() { echo "protect.sh: $*" >&2; exit 2; }

while (($#)); do
  case $1 in
    --repo) repo=${2:?missing value for --repo}; shift 2 ;;
    --checks) checks=${2:?missing value for --checks}; shift 2 ;;
    --approvals) approvals=${2:?missing value for --approvals}; shift 2 ;;
    --no-bypass) nobypass=1; shift ;;
    --apply) apply=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

if [[ -z $repo ]]; then
  url=$(git remote get-url origin 2>/dev/null || true)
  repo=$(sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##' <<<"$url")
fi
[[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && $repo != ./* && $repo != *//.* && $repo != */. && $repo != */.. && $repo != ../* ]] || die "cannot determine owner/name (got '$repo'); pass --repo"
[[ -z $approvals || $approvals =~ ^[0-9]+$ ]] || die "--approvals must be a non-negative integer"

payload=$(jq --arg checks "$checks" --arg approvals "$approvals" --arg nobypass "$nobypass" '
  (if $checks != "" then
     (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) = ($checks | split(",") | map({context: ., integration_id: 15368}))
   else . end)
  | (if $approvals != "" then
     (.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count) = ($approvals | tonumber)
   else . end)
  | (if $nobypass == "1" then .bypass_actors = [] else . end)' "$here/ruleset.json")
name=$(jq -r '.name' <<<"$payload")

if ((apply == 0)); then
  echo "DRY RUN: nothing sent. Re-run with --apply to create or update ruleset '$name' on $repo:"
  echo "$payload"
  exit 0
fi

existing=$("$GH_BIN" api --paginate "repos/$repo/rulesets")
id=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' <<<"$existing" | head -n 1)
if [[ -n $id ]]; then
  "$GH_BIN" api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$payload" >/dev/null
  echo "Updated ruleset '$name' (id $id) on $repo."
else
  "$GH_BIN" api -X POST "repos/$repo/rulesets" --input - <<<"$payload" >/dev/null
  echo "Created ruleset '$name' on $repo."
fi
