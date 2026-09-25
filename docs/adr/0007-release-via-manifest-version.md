# Releases are triggered by version bumps in the manifest

A change to the version field in the plugin manifest (or package.json) is the single source of truth that triggers the GitHub Action to build, sign and publish a release. There is no separate Lunedusk-controlled website; the official Obsidian Community Plugins store is the primary distribution channel. A small local `sync-workflows.sh` script (gitignored) is provided so developers can pull the latest workflow definitions without committing them.
