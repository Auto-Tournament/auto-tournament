#!/bin/bash
set -e

# MatchZy Auto Tournament - Discord Webhook Script
# Sends a Discord webhook notification for a release

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Source .env file if it exists (from project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${PROJECT_ROOT}/.env" ]; then
    echo -e "${BLUE}Sourcing .env file...${NC}"
    # Export variables from .env, handling comments and empty lines
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
fi

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-sivertio}"
IMAGE_NAME="matchzy-auto-tournament"
DOCKER_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"
REPO_OWNER="sivert-io"
REPO_NAME="matchzy-auto-tournament"

echo -e "${GREEN}MatchZy Auto Tournament - Discord Webhook${NC}"
echo "========================================="
echo ""

# Get version from argument or package.json
if [ -n "$1" ]; then
    NEW_VERSION="$1"
    # Remove 'v' prefix if present
    NEW_VERSION="${NEW_VERSION#v}"
else
    # Get current version from package.json
    if [ -f "package.json" ]; then
        NEW_VERSION=$(grep '"version"' package.json | head -1 | awk -F '"' '{print $4}')
        echo -e "${BLUE}Using version from package.json: ${GREEN}${NEW_VERSION}${NC}"
    else
        echo -e "${RED}Error: package.json not found and no version provided${NC}"
        echo ""
        echo "Usage:"
        echo "  ./scripts/discord-webhook.sh [VERSION]"
        echo ""
        echo "Or set DISCORD_WEBHOOK_URL environment variable:"
        echo "  export DISCORD_WEBHOOK_URL=\"https://discord.com/api/webhooks/...\""
        echo "  ./scripts/discord-webhook.sh [VERSION]"
        exit 1
    fi
fi

# Validate version format (semver)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}Invalid version format. Use semantic versioning (e.g., 1.0.0)${NC}"
    exit 1
fi

# Check if Discord webhook URL is set
if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo -e "${RED}Error: DISCORD_WEBHOOK_URL environment variable is required but not set.${NC}"
    echo -e "${YELLOW}Please set DISCORD_WEBHOOK_URL before running the script.${NC}"
    echo ""
    echo "Example:"
    echo "  export DISCORD_WEBHOOK_URL=\"https://discord.com/api/webhooks/...\""
    echo "  ./scripts/discord-webhook.sh ${NEW_VERSION}"
    exit 1
fi

echo -e "${BLUE}Version: ${GREEN}${NEW_VERSION}${NC}"
echo -e "${BLUE}Webhook URL: ${YELLOW}${DISCORD_WEBHOOK_URL:0:50}...${NC}"
echo ""

# Function to get changelog from merged PR titles
get_changelog() {
    local prev_tag
    local current_tag="v${NEW_VERSION}"
    
    # Get the previous tag (second most recent, excluding the current one)
    prev_tag=$(git tag --sort=-v:refname | grep -v "^${current_tag}$" | sed -n '1p' 2>/dev/null || echo "")
    
    # Extract PR titles from merge commits
    # Format: "Merge pull request #XX..." followed by blank line, then PR title
    # Reverse order so oldest PRs are first (git log shows newest first by default)
    extract_pr_titles() {
        local log_range="$1"
        local temp_output
        temp_output=$(git log ${log_range} --merges --format="%B" | \
            awk '
                /^Merge pull request/ {
                    # Skip the merge line and blank line, get the next non-empty line (PR title)
                    getline
                    getline
                    if (NF > 0) {
                        print "- " $0
                    }
                }
            ' | head -20)
        
        # Reverse the order (oldest first) - use tail -r on macOS, tac on Linux
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "$temp_output" | tail -r
        else
            echo "$temp_output" | tac
        fi
    }
    
    if [ -z "$prev_tag" ]; then
        # No previous tag, get all merged PRs up to the current tag
        if git rev-parse "${current_tag}" >/dev/null 2>&1; then
            extract_pr_titles "${current_tag}"
        else
            # Tag doesn't exist, get recent merged PRs
            extract_pr_titles ""
        fi
    else
        # Get merged PRs between previous tag and current tag
        extract_pr_titles "${prev_tag}..${current_tag}"
    fi
}

# Get changelog
echo -e "${YELLOW}Generating changelog...${NC}"
CHANGELOG=$(get_changelog)

# If changelog is empty or too short, use a default message
if [ -z "$CHANGELOG" ] || [ ${#CHANGELOG} -lt 10 ]; then
    CHANGELOG="- Release v${NEW_VERSION}"
fi

# Truncate changelog if too long (Discord field value limit is 1024 characters)
# Reserve ~60 chars for the "...and more" message
MAX_CHANGELOG_LENGTH=960
TRUNCATE_MSG=$'\n'"- *...and more (see GitHub release for full changelog)*"

if [ ${#CHANGELOG} -gt "$MAX_CHANGELOG_LENGTH" ]; then
    # Truncate line by line until we're under the limit
    TEMP_FILE=$(mktemp)
    echo "$CHANGELOG" > "$TEMP_FILE"
    TEMP_CHANGELOG=""
    
    while IFS= read -r line || [ -n "$line" ]; do
        if [ -z "$TEMP_CHANGELOG" ]; then
            TEST_CHANGELOG="${line}"
        else
            TEST_CHANGELOG="${TEMP_CHANGELOG}"$'\n'"${line}"
        fi
        TEST_LENGTH=$((${#TEST_CHANGELOG} + ${#TRUNCATE_MSG}))
        
        if [ "$TEST_LENGTH" -le "$MAX_CHANGELOG_LENGTH" ]; then
            TEMP_CHANGELOG="$TEST_CHANGELOG"
        else
            break
        fi
    done < "$TEMP_FILE"
    
    rm -f "$TEMP_FILE"
    
    # Add truncation message
    CHANGELOG="${TEMP_CHANGELOG}${TRUNCATE_MSG}"
    echo -e "${BLUE}⚠️  Changelog truncated to ${#CHANGELOG} characters (Discord limit: 1024)${NC}"
fi

# Create Discord webhook payload using jq for proper JSON handling
TEMP_JSON=$(mktemp)
DEBUG_MODE="${DEBUG:-false}"

echo -e "${YELLOW}Creating webhook payload...${NC}"

if command -v jq &> /dev/null; then
    # Use jq to build the JSON payload properly
    echo "$CHANGELOG" > /tmp/changelog.txt
    
    jq -n \
        --arg content "🚀 **New Release: v${NEW_VERSION}**" \
        --arg title "MatchZy Auto Tournament v${NEW_VERSION}" \
        --arg description "A new version has been released!" \
        --arg changelog "$(cat /tmp/changelog.txt)" \
        --arg dockerhub "https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME}" \
        --arg github "https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION}" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{
          content: $content,
          embeds: [{
            title: $title,
            description: $description,
            color: 3066993,
            fields: [
              {
                name: "📦 Changelog",
                value: $changelog,
                inline: false
              },
              {
                name: "🐳 Docker Hub",
                value: ("[View on Docker Hub](" + $dockerhub + ")"),
                inline: true
              },
              {
                name: "🔗 GitHub Release",
                value: ("[View Release](" + $github + ")"),
                inline: true
              }
            ],
            footer: {
              text: "MatchZy Auto Tournament"
            },
            timestamp: $timestamp
          }]
        }' > "$TEMP_JSON"
    
    rm -f /tmp/changelog.txt
else
    # Fallback: manual JSON construction (less reliable but works without jq)
    ESCAPED_CHANGELOG=$(echo "$CHANGELOG" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk 'BEGIN{ORS="\\n"}{print}' | sed 's/\\n$//')
    
    cat > "$TEMP_JSON" <<EOF
{
  "content": "🚀 **New Release: v${NEW_VERSION}**",
  "embeds": [{
    "title": "MatchZy Auto Tournament v${NEW_VERSION}",
    "description": "A new version has been released!",
    "color": 3066993,
    "fields": [
      {
        "name": "📦 Changelog",
        "value": "${ESCAPED_CHANGELOG}",
        "inline": false
      },
      {
        "name": "🐳 Docker Hub",
        "value": "[View on Docker Hub](https://hub.docker.com/r/${DOCKER_USERNAME}/${IMAGE_NAME})",
        "inline": true
      },
      {
        "name": "🔗 GitHub Release",
        "value": "[View Release](https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${NEW_VERSION})",
        "inline": true
      }
    ],
    "footer": {
      "text": "MatchZy Auto Tournament"
    },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }]
}
EOF
fi

# Validate JSON before sending
if command -v jq &> /dev/null; then
    if ! jq empty "$TEMP_JSON" 2>/dev/null; then
        echo -e "${RED}❌ Invalid JSON payload generated${NC}"
        echo -e "${YELLOW}Payload content:${NC}"
        cat "$TEMP_JSON"
        rm -f "$TEMP_JSON"
        exit 1
    fi
    
    # Check field lengths (Discord limits)
    echo -e "${BLUE}Validating payload field lengths...${NC}"
    
    # Check content length (2000 chars max)
    CONTENT_LEN=$(jq -r '.content | length' "$TEMP_JSON")
    if [ "$CONTENT_LEN" -gt 2000 ]; then
        echo -e "${RED}❌ Content field too long: ${CONTENT_LEN} chars (max 2000)${NC}"
        rm -f "$TEMP_JSON"
        exit 1
    fi
    
    # Check embed title (256 chars max)
    TITLE_LEN=$(jq -r '.embeds[0].title | length' "$TEMP_JSON")
    if [ "$TITLE_LEN" -gt 256 ]; then
        echo -e "${RED}❌ Title too long: ${TITLE_LEN} chars (max 256)${NC}"
        rm -f "$TEMP_JSON"
        exit 1
    fi
    
    # Check embed description (4096 chars max)
    DESC_LEN=$(jq -r '.embeds[0].description | length' "$TEMP_JSON")
    if [ "$DESC_LEN" -gt 4096 ]; then
        echo -e "${RED}❌ Description too long: ${DESC_LEN} chars (max 4096)${NC}"
        rm -f "$TEMP_JSON"
        exit 1
    fi
    
    # Check each field value (1024 chars max per field)
    FIELD_COUNT=$(jq '.embeds[0].fields | length' "$TEMP_JSON")
    for i in $(seq 0 $((FIELD_COUNT - 1))); do
        FIELD_NAME=$(jq -r ".embeds[0].fields[$i].name" "$TEMP_JSON")
        FIELD_VALUE_LEN=$(jq -r ".embeds[0].fields[$i].value | length" "$TEMP_JSON")
        if [ "$FIELD_VALUE_LEN" -gt 1024 ]; then
            echo -e "${RED}❌ Field '${FIELD_NAME}' value too long: ${FIELD_VALUE_LEN} chars (max 1024)${NC}"
            rm -f "$TEMP_JSON"
            exit 1
        fi
    done
    
    # Check total embed length (6000 chars max for all embeds combined)
    TOTAL_EMBED_LEN=$(jq -r '[.embeds[] | tostring] | add | length' "$TEMP_JSON")
    if [ "$TOTAL_EMBED_LEN" -gt 6000 ]; then
        echo -e "${RED}❌ Total embed length too long: ${TOTAL_EMBED_LEN} chars (max 6000)${NC}"
        rm -f "$TEMP_JSON"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Payload validation passed${NC}"
    
    # Show payload summary in debug mode
    if [ "$DEBUG_MODE" = "true" ]; then
        echo -e "${BLUE}Payload summary:${NC}"
        echo -e "  Content: ${CONTENT_LEN} chars"
        echo -e "  Title: ${TITLE_LEN} chars"
        echo -e "  Description: ${DESC_LEN} chars"
        echo -e "  Total embed: ${TOTAL_EMBED_LEN} chars"
        echo ""
        echo -e "${BLUE}Full payload:${NC}"
        jq . "$TEMP_JSON"
        echo ""
    fi
fi

# Send webhook
echo -e "${YELLOW}Sending Discord webhook...${NC}"
WEBHOOK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d @"$TEMP_JSON" \
    "$DISCORD_WEBHOOK_URL" 2>&1)

HTTP_CODE=$(echo "$WEBHOOK_RESPONSE" | tail -n1)
HTTP_BODY=$(echo "$WEBHOOK_RESPONSE" | sed '$d')

# Clean up temp file (keep it if there's an error for debugging)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    rm -f "$TEMP_JSON"
else
    # Keep temp file for debugging on error
    TEMP_JSON_DEBUG="${TEMP_JSON}.debug"
    cp "$TEMP_JSON" "$TEMP_JSON_DEBUG"
    echo -e "${YELLOW}⚠️  Payload saved to: ${TEMP_JSON_DEBUG}${NC}"
fi

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    echo -e "${GREEN}✅ Discord notification sent successfully${NC}"
    
    # Extract message ID from response (for potential future auto-publishing)
    if [ -n "$HTTP_BODY" ] && command -v jq &> /dev/null; then
        MESSAGE_ID=$(echo "$HTTP_BODY" | jq -r '.id // empty' 2>/dev/null)
        if [ -n "$MESSAGE_ID" ]; then
            echo -e "${BLUE}Message ID: ${MESSAGE_ID}${NC}"
            echo -e "${BLUE}Note: For announcement channels, you may need to publish this message manually${NC}"
        fi
    fi
    exit 0
else
    echo -e "${RED}❌ Failed to send Discord notification (HTTP ${HTTP_CODE})${NC}"
    echo ""
    
    # Parse and display error details
    if [ -n "$HTTP_BODY" ]; then
        echo -e "${YELLOW}Discord Error Response:${NC}"
        if command -v jq &> /dev/null; then
            # Try to parse as JSON and show formatted error
            if echo "$HTTP_BODY" | jq . >/dev/null 2>&1; then
                echo "$HTTP_BODY" | jq .
                
                # Extract specific error messages
                ERROR_CODE=$(echo "$HTTP_BODY" | jq -r '.code // empty' 2>/dev/null)
                ERROR_MESSAGE=$(echo "$HTTP_BODY" | jq -r '.message // empty' 2>/dev/null)
                ERROR_EMBEDS=$(echo "$HTTP_BODY" | jq -r '.embeds // empty' 2>/dev/null)
                
                if [ -n "$ERROR_CODE" ]; then
                    echo ""
                    echo -e "${RED}Error Code: ${ERROR_CODE}${NC}"
                fi
                if [ -n "$ERROR_MESSAGE" ]; then
                    echo -e "${RED}Error Message: ${ERROR_MESSAGE}${NC}"
                fi
                if [ -n "$ERROR_EMBEDS" ] && [ "$ERROR_EMBEDS" != "null" ]; then
                    echo -e "${YELLOW}Embed Errors: ${ERROR_EMBEDS}${NC}"
                    # Try to get more details about embed errors
                    if echo "$HTTP_BODY" | jq -e '.embeds' >/dev/null 2>&1; then
                        EMBED_ERRORS=$(echo "$HTTP_BODY" | jq -r '.embeds | to_entries[] | "  Embed \(.key): \(.value)"' 2>/dev/null)
                        if [ -n "$EMBED_ERRORS" ]; then
                            echo -e "${YELLOW}Embed Error Details:${NC}"
                            echo "$EMBED_ERRORS"
                        fi
                    fi
                fi
            else
                echo "$HTTP_BODY"
            fi
        else
            echo "$HTTP_BODY"
        fi
    fi
    
    echo ""
    echo -e "${BLUE}Troubleshooting:${NC}"
    echo -e "  1. Check webhook URL: ${YELLOW}${DISCORD_WEBHOOK_URL:0:60}...${NC}"
    echo -e "  2. Verify webhook is still valid (not deleted/expired)"
    echo -e "  3. Check payload size and field lengths (see validation above)"
    echo -e "  4. Run with ${GREEN}DEBUG=true${NC} to see full payload:"
    echo -e "     ${GREEN}DEBUG=true ./scripts/discord-webhook.sh ${NEW_VERSION}${NC}"
    if [ -f "${TEMP_JSON_DEBUG:-}" ]; then
        echo -e "  5. Review saved payload: ${YELLOW}${TEMP_JSON_DEBUG}${NC}"
    fi
    exit 1
fi

