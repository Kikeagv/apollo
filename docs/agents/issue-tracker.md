# Issue Tracker

## Linear

Issues for this repository are tracked in Linear.

- Workspace/team: `APO`
- Team overview: https://linear.app/k31-software/team/APO/overview
- Repository: `Kikeagv/apollo`

When engineering skills need to read, create, or update work items, use Linear issues in team `APO`. Do not create GitHub Issues unless the workflow changes.

Use the Linear issue identifier in branch names, pull-request titles, or commit messages to link implementation work to its issue.

## Wayfinding operations

A Wayfinder map is a Linear issue in team `APO` labeled `wayfinder:map`. Its decision tickets are child issues (`parentId` is the map identifier) with exactly one of: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.

Express blocking through Linear's native `blockedBy` / `blocks` relationships. A decision session claims an unblocked child by assigning it to the person driving the map before beginning work. Query the map's open children to find the frontier; do not duplicate them in the map body.
