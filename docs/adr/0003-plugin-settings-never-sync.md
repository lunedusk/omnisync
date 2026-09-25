# Plugin Settings are never synchronised

OmniSync’s own configuration (chosen Remote, Direction, Conflict Policy, exclusions, triggers, etc.) is deliberately excluded from every sync operation. This allows one device to be configured for Incremental Push while another is configured for Incremental Pull, and prevents settings from one machine overwriting another.
