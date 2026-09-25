# Losing conflict versions are always preserved locally

When a Conflict Policy (Newer Survives or Larger Survives) discards one side, the losing version is moved to a local `.omnisync-conflicts/` folder (timestamped) so the user can recover it later. On mobile the conflict is surfaced via a badge and a dedicated Conflicts view; on desktop the same view plus an optional toast is used. No blocking modal is shown.
