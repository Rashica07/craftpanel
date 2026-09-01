# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in CraftPanel, please **do not** open a public issue.

Instead, use GitHub's private vulnerability reporting feature:

1. Go to the [Security tab](https://github.com/Rashica07/craftpanel/security)
2. Click **"Report a vulnerability"**
3. Describe the issue, steps to reproduce, and any suggested fix

Alternatively, you can email details to: **kristiangjergji20@icloud.com**

Please include:
- A description of the vulnerability
- Steps to reproduce it
- Your suggested fix (if any)

We'll acknowledge your report within 48 hours and work on a fix. Once a patch is released, you'll be credited in the release notes (unless you prefer to remain anonymous).

## Supported Versions

- **Latest release** — receives all security patches
- **Older versions** — see the [Releases](../../releases) page

## Security Best Practices for CraftPanel Users

- Keep CraftPanel updated to the latest version
- If you enable Remote API access, use a strong token and never share it
- Cloudflare R2 credentials should be treated as sensitive secrets — never commit them to version control
- Only download CraftPanel from the official [GitHub Releases](../../releases) page
