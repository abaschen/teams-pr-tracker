# Teams Application Manifest

This directory contains the Microsoft Teams application manifest for the PR Tracker bot.

## Files

- `manifest.json` - Teams app manifest (v1.16 schema)
- `color.png` - Full color app icon (192x192 px, PNG) — **placeholder needed**
- `outline.png` - Outline/transparent app icon (32x32 px, PNG) — **placeholder needed**

## Placeholder Values

Before deploying, replace the following placeholder values in `manifest.json`:

| Field | Current Value | Replace With |
|-------|---------------|--------------|
| `id` | `00000000-0000-0000-0000-000000000000` | Your Azure AD app registration ID |
| `bots[0].botId` | `00000000-0000-0000-0000-000000000000` | Your Bot Framework registration ID |
| `developer.name` | `Your Organization` | Your organization name |
| `developer.websiteUrl` | `https://example.com` | Your organization website |
| `developer.privacyUrl` | `https://example.com/privacy` | Your privacy policy URL |
| `developer.termsOfUseUrl` | `https://example.com/terms` | Your terms of use URL |

## Icons

Before packaging for deployment, add the following icon files to this directory:

- **color.png**: 192x192 pixel full-color PNG icon for the app
- **outline.png**: 32x32 pixel transparent PNG outline icon (white with transparent background)

## Packaging

To create a deployable Teams app package, zip this directory's contents:

```bash
cd teams-manifest
zip -r ../pr-tracker-teams-app.zip manifest.json color.png outline.png
```

Then upload the `.zip` file via the Teams Admin Center or side-load for development.
