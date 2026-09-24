#!/bin/bash
# Helper script to create a shard-specific compose file

SHARD_NUM=$1
COMPOSE_FILE=$2
TEMP_COMPOSE=$3

# Read the original compose file and modify it
awk -v shard_num="$SHARD_NUM" '
BEGIN { in_build = 0; build_indent = "" }
/auto-tournament-postgres-dev/ {
  gsub(/auto-tournament-postgres-dev/, "auto-tournament-postgres-dev-shard-" shard_num)
}
/auto-tournament-dev/ {
  gsub(/auto-tournament-dev/, "auto-tournament-dev-shard-" shard_num)
}
/^[[:space:]]*build:/ {
  print "    image: auto-tournament-test:sharded"
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

