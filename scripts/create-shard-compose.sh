#!/bin/bash
# Helper script to create a shard-specific compose file

SHARD_NUM=$1
COMPOSE_FILE=$2
TEMP_COMPOSE=$3

# Read the original compose file and modify it
awk -v shard_num="$SHARD_NUM" '
BEGIN { in_build = 0; build_indent = "" }
/matchzy-postgres-dev/ {
  gsub(/matchzy-postgres-dev/, "matchzy-postgres-dev-shard-" shard_num)
}
/matchzy-tournament-api-dev/ {
  gsub(/matchzy-tournament-api-dev/, "matchzy-tournament-api-dev-shard-" shard_num)
}
/^[[:space:]]*build:/ {
  print "    image: matchzy-test:sharded"
  in_build = 1
  build_indent = ""
  next
}
in_build && /^[[:space:]]*context:/ { next }
in_build && /^[[:space:]]*dockerfile:/ { next }
in_build && /^[[:space:]]*args:/ { 
  in_build = 2
  next
}
in_build == 2 && /^[[:space:]]*VITE_ENABLE_DEV_PAGE:/ { next }
in_build == 2 && /^[[:space:]]*# PostgreSQL/ {
  in_build = 0
}
!in_build || (in_build && !/^[[:space:]]/ && /^[[:space:]]*[^[:space:]]/) {
  if (in_build == 2) in_build = 0
}
{ print }
' "$COMPOSE_FILE" > "$TEMP_COMPOSE"

