#!/usr/bin/env bash
#
# bootstrap-repo-labels.sh
#
# Reads the PR Tracker configuration (DynamoDB rules + SSM channel config) and creates
# all required GitHub labels on a target repository. This helps maintainers bootstrap
# repos that will be tracked by the PR Tracker bot.
#
# Labels created:
#   - One label per validation team (from annotation rules matching the repo)
#   - Urgent labels (from channel mapping config)
#
# Usage:
#   ./scripts/bootstrap-repo-labels.sh <owner/repo> [--environment dev] [--region us-east-1] [--profile admin]
#
# Prerequisites:
#   - gh cli authenticated
#   - aws cli authenticated with access to DynamoDB + SSM
#
# Examples:
#   ./scripts/bootstrap-repo-labels.sh aws-abaschen/my-repo
#   ./scripts/bootstrap-repo-labels.sh aws-abaschen/my-repo --environment prod --region eu-west-1

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
ENVIRONMENT="dev"
REGION="us-east-1"
AWS_PROFILE_ARG=""
PROJECT_NAME="pr-tracker"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Parse arguments ─────────────────────────────────────────────────────────
if [ $# -lt 1 ]; then
  echo -e "${RED}Usage: $0 <owner/repo> [--environment dev] [--region us-east-1] [--profile admin]${NC}"
  exit 1
fi

REPO="$1"
shift

while [[ $# -gt 0 ]]; do
  case $1 in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --profile) AWS_PROFILE_ARG="--profile $2"; shift 2 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

TABLE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-state"
SSM_PARAM="/${PROJECT_NAME}-${ENVIRONMENT}/config/channel-mappings"

echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PR Tracker — Bootstrap Repository Labels${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Repository:   ${GREEN}${REPO}${NC}"
echo -e "  Environment:  ${ENVIRONMENT}"
echo -e "  Region:       ${REGION}"
echo -e "  Table:        ${TABLE_NAME}"
echo ""

# ─── Step 1: Read annotation rules from DynamoDB ─────────────────────────────
echo -e "${YELLOW}→ Reading annotation rules from DynamoDB...${NC}"

RULES_JSON=$(aws dynamodb scan \
  --table-name "$TABLE_NAME" \
  --filter-expression "begins_with(PK, :prefix)" \
  --expression-attribute-values '{":prefix":{"S":"RULE#"}}' \
  --region "$REGION" \
  $AWS_PROFILE_ARG \
  --output json \
  --query "Items")

# Extract team names from all rules
TEAM_LABELS=$(echo "$RULES_JSON" | python3 -c "
import json, sys
items = json.loads(sys.stdin.read())
teams = set()
for item in items:
    if 'validationTeams' in item:
        for team in item['validationTeams'].get('L', []):
            m = team.get('M', {})
            name = m.get('teamName', {}).get('S', '')
            if name:
                teams.add(name)
for t in sorted(teams):
    print(t)
")

if [ -z "$TEAM_LABELS" ]; then
  echo -e "  ${YELLOW}No team labels found in rules.${NC}"
else
  echo -e "  Found team labels: ${GREEN}$(echo $TEAM_LABELS | tr '\n' ', ')${NC}"
fi

# ─── Step 2: Read urgent labels from SSM channel config ──────────────────────
echo -e "${YELLOW}→ Reading urgent labels from SSM...${NC}"

CHANNEL_CONFIG=$(aws ssm get-parameter \
  --name "$SSM_PARAM" \
  --with-decryption \
  --region "$REGION" \
  $AWS_PROFILE_ARG \
  --query "Parameter.Value" \
  --output text 2>/dev/null || echo "{}")

URGENT_LABELS=$(echo "$CHANNEL_CONFIG" | python3 -c "
import json, sys
try:
    config = json.loads(sys.stdin.read())
    labels = config.get('urgentLabels', ['urgent', 'hotfix', 'critical', 'emergency'])
    for l in labels:
        print(l)
except:
    for l in ['urgent', 'hotfix', 'critical', 'emergency']:
        print(l)
")

echo -e "  Urgent labels: ${GREEN}$(echo $URGENT_LABELS | tr '\n' ', ')${NC}"

# ─── Step 3: Create labels on GitHub ─────────────────────────────────────────
echo ""
echo -e "${YELLOW}→ Creating labels on ${REPO}...${NC}"

# Team labels (blue palette)
TEAM_COLORS=("0052CC" "1D76DB" "0075CA" "006B75" "0E8A16" "5319E7")
COLOR_IDX=0

while IFS= read -r label; do
  [ -z "$label" ] && continue
  COLOR="${TEAM_COLORS[$((COLOR_IDX % ${#TEAM_COLORS[@]}))]}"
  COLOR_IDX=$((COLOR_IDX + 1))

  if gh label create "$label" --repo "$REPO" --color "$COLOR" --description "PR Tracker: requires ${label} team review" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Created: ${label} (#${COLOR})"
  else
    # Label might already exist, try to update it
    gh label edit "$label" --repo "$REPO" --color "$COLOR" --description "PR Tracker: requires ${label} team review" 2>/dev/null && \
      echo -e "  ${BLUE}↻${NC} Updated: ${label} (#${COLOR})" || \
      echo -e "  ${YELLOW}⊘${NC} Skipped: ${label} (already exists)"
  fi
done <<< "$TEAM_LABELS"

# Urgent labels (red palette)
URGENT_COLORS=("D93F0B" "E11D48" "B60205" "FF0000")
COLOR_IDX=0

while IFS= read -r label; do
  [ -z "$label" ] && continue
  COLOR="${URGENT_COLORS[$((COLOR_IDX % ${#URGENT_COLORS[@]}))]}"
  COLOR_IDX=$((COLOR_IDX + 1))

  if gh label create "$label" --repo "$REPO" --color "$COLOR" --description "PR Tracker: marks PR as urgent priority" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Created: ${label} (#${COLOR})"
  else
    gh label edit "$label" --repo "$REPO" --color "$COLOR" --description "PR Tracker: marks PR as urgent priority" 2>/dev/null && \
      echo -e "  ${BLUE}↻${NC} Updated: ${label} (#${COLOR})" || \
      echo -e "  ${YELLOW}⊘${NC} Skipped: ${label} (already exists)"
  fi
done <<< "$URGENT_LABELS"

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Done! Labels created on ${REPO}${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
