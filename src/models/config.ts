/**
 * Configuration types for channel mappings and runtime settings.
 * Channel mappings are stored in SSM Parameter Store as JSON.
 */

/** Maps a repository pattern to a Microsoft Teams channel */
export interface ChannelMapping {
  repositoryPattern: string; // glob pattern matching repositoryFullName
  channelId: string;
  serviceUrl: string;
  /** Team tag ID to @mention when PR is ready to merge (optional) */
  maintainersTagId?: string;
  /** Display name for the maintainers tag (e.g., "Maintainers") */
  maintainersTagName?: string;
}

/** Top-level channel mapping configuration */
export interface ChannelMappingConfig {
  mappings: ChannelMapping[];
  defaultChannelId: string;
  /** Default maintainers tag ID used when no mapping-specific one is set */
  defaultMaintainersTagId?: string;
  /** Default maintainers tag display name */
  defaultMaintainersTagName?: string;
  /** Custom message templates (overrides defaults) */
  templates?: MessageTemplates;
}

/** Retry configuration for external API calls */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Message Templates
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Available template variables for message composition.
 *
 * Variables are injected using {{variableName}} syntax in templates.
 *
 * | Variable | Description | Example |
 * |----------|-------------|---------|
 * | `{{title}}` | PR title | "feat: add auth module" |
 * | `{{author}}` | PR author username | "abaschen" |
 * | `{{repo}}` | Full repository name | "aws-abaschen/my-repo" |
 * | `{{org}}` | Organization/owner name | "aws-abaschen" |
 * | `{{repoName}}` | Short repository name | "my-repo" |
 * | `{{branch}}` | Source branch | "feature/auth" |
 * | `{{baseBranch}}` | Target branch | "main" |
 * | `{{url}}` | PR URL | "https://github.com/.../pull/1" |
 * | `{{provider}}` | Source provider | "github" |
 * | `{{prNumber}}` | PR number | "42" |
 * | `{{teams}}` | Formatted team status list | "✅ CyberSec\n⏳ InfoSec" |
 * | `{{approvedCount}}` | Number of approved teams | "2" |
 * | `{{totalCount}}` | Total required teams | "4" |
 * | `{{reviewers}}` | Comma-separated reviewer list | "cyber-lead, infosec-lead" |
 * | `{{status}}` | Current PR status | "open" |
 * | `{{outcome}}` | Final outcome (merged/closed) | "MERGED" |
 * | `{{outcomeIcon}}` | Outcome emoji | "✅" or "❌" |
 */
export interface MessageTemplates {
  /** Template for initial PR opened message */
  opened?: string;
  /** Template for updated status (after reviews) */
  updated?: string;
  /** Template for review reply messages */
  reviewReply?: string;
  /** Template for ready-to-merge state */
  readyToMerge?: string;
  /** Template for merged/closed final state */
  closed?: string;
}

/** Default message templates */
export const DEFAULT_TEMPLATES: Required<MessageTemplates> = {
  opened: [
    '📋 **{{title}}**',
    '',
    'Author: {{author}}  ',
    'Repo: {{repo}}  ',
    'Branch: `{{branch}}` → `{{baseBranch}}`  ',
    'Link: {{url}}',
    '',
    '**Required approvals (0/{{totalCount}}):**',
    '',
    '{{teams}}',
  ].join('\n'),

  updated: [
    '📋 **{{title}}**',
    '',
    'Author: {{author}}  ',
    'Repo: {{repo}}  ',
    'Branch: `{{branch}}`  ',
    'Link: {{url}}',
    '',
    '**Required approvals ({{approvedCount}}/{{totalCount}}):**',
    '',
    '{{teams}}',
  ].join('\n'),

  reviewReply: '{{icon}} **{{actor}}** — {{action}}',

  readyToMerge: [
    '📋 **{{title}}**',
    '',
    'Author: {{author}}  ',
    'Repo: {{repo}}  ',
    'Branch: `{{branch}}`  ',
    'Link: {{url}}',
    '',
    '🟢 **Ready to merge** ({{approvedCount}}/{{totalCount}})',
    '',
    '{{teams}}',
  ].join('\n'),

  closed: [
    '{{outcomeIcon}} **[{{outcome}}]** {{title}}',
    '',
    'Author: {{author}}  ',
    'Repo: {{repo}}  ',
    'Link: {{url}}',
    '',
    '**Final approvals ({{approvedCount}}/{{totalCount}}):**',
    '',
    '{{teams}}',
  ].join('\n'),
};

/**
 * Renders a template string by replacing {{variable}} placeholders with values.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}
