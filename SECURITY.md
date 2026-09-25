# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately using one of:

1. **GitHub Security Advisories** — *Security* tab → *Report a vulnerability*
   on this repository (preferred).
2. Contact the maintainers via the email or channels listed on the
   [Lunedusk](https://github.com/lunedusk) organization profile, if available.

Include:

- Description of the issue
- Steps to reproduce
- Affected versions
- Impact assessment (if known)

We will acknowledge receipt as soon as practical and work with you on a fix
and coordinated disclosure.

## Scope notes for OmniSync

- OmniSync encrypts vault payloads end-to-end before upload. Report issues in
  key derivation, AEAD usage, or credential handling.
- Remote credentials and the recovery key never leave the device in plaintext
  by design; please flag any path that would change that.
- OAuth tokens and S3 keys stored in plugin data are device-local; treat leaks
  of those stores as sensitive.
