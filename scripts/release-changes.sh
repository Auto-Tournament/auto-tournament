#!/bin/bash
# Sourced by release.sh (GitHub release body) and discord-webhook.sh (Discord post),
# so both list the same changes. Needs NEW_VERSION set.

# Collect the changes in this release, newest last.
#
# PRs are squash-merged here, so each one lands as a single commit whose subject
# ends in "(#123)" — there is no merge commit to read. This used to look only at
# `git log --merges`, which in a squash-merge repository finds nothing except
# the release PR itself. That is why past releases were published with a
# changelog reading, in full, "- chore: bump version to X.Y.Z".
#
# Merge commits are still read, so this keeps working if a PR is ever merged
# rather than squashed. The release's own version-bump commit is dropped: it is
# noise in every changelog it has ever appeared in.
collect_changes() {
    local current_tag="v${NEW_VERSION}"
    local prev_tag
    local range

    # The tag immediately *preceding* this version, not merely the newest other
    # tag. Those are the same thing while releasing the newest version, which is
    # why the old form worked in practice — but it silently produced an inverted,
    # empty range for anything else, so the function could never be tested.
    # `current_tag` is added to the list in case the tag does not exist yet.
    # A stable release counts from the previous stable one: its betas often sit
    # on the same commit, which would leave the range empty.
    prev_tag=$(
        { git tag --sort=v:refname 2>/dev/null | { [[ "$NEW_VERSION" == *-* ]] && cat || grep -v -- '-'; }; echo "${current_tag}"; } \
            | sort -V -u \
            | grep -B1 -x -- "${current_tag}" \
            | head -1
    )
    [ "$prev_tag" = "${current_tag}" ] && prev_tag=""

    if [ -n "$prev_tag" ]; then
        range="${prev_tag}..${current_tag}"
    elif git rev-parse "${current_tag}" >/dev/null 2>&1; then
        range="${current_tag}"
    else
        range=""
    fi

    local changes
    changes=$(
        {
            # Squash-merged PRs: subject ends in (#123).
            git log ${range} --no-merges --format="%s" 2>/dev/null | grep -E '\(#[0-9]+\)$' || true
            # Genuine merge commits: the PR title is the first non-empty body line.
            git log ${range} --merges --format="%B" 2>/dev/null | awk '
                /^Merge pull request/ { getline; getline; if (NF > 0) print }
            ' || true
        } | grep -vE '^chore: bump version to ' || true
    )

    # Nothing looked like a PR, so fall back to plain commit subjects. A release
    # made from direct pushes should still say what is in it rather than fall
    # through to the "- Release vX.Y.Z" placeholder.
    if [ -z "$changes" ]; then
        changes=$(
            git log ${range} --no-merges --format="%s" 2>/dev/null \
                | grep -vE '^chore: bump version to ' || true
        )
    fi

    printf '%s\n' "$changes" \
        | grep -v '^$' \
        | head -30 \
        | sed 's/^/- /' \
        | { if [[ "$OSTYPE" == "darwin"* ]]; then tail -r; else tac; fi; }
}

