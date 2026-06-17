/**
 * Event types and normalized PR event interfaces.
 * Provides a provider-agnostic format for webhook events from GitHub, Bitbucket, and GitLab.
 */

/** Supported source control providers */
export type Provider = 'github' | 'bitbucket' | 'gitlab';

/** Recognized PR event types */
export type PREventType =
  | 'pr_opened'
  | 'pr_updated'
  | 'pr_closed'
  | 'pr_merged'
  | 'review_submitted'
  | 'review_dismissed'
  | 'comment_added'
  | 'ci_status_changed';

/** Reviewer action details included with review events */
export interface ReviewerAction {
  reviewer: string;
  action: 'approved' | 'changes_requested' | 'dismissed';
}

/**
 * Provider-agnostic normalized PR event.
 * All webhook payloads are transformed into this format before processing.
 */
export interface NormalizedPREvent {
  provider: Provider;
  eventType: PREventType;
  prId: string;
  prTitle: string;
  prUrl: string;
  repositoryName: string;
  repositoryFullName: string;
  author: string;
  branch: string;
  baseBranch: string;
  changedFiles?: string[];
  labels?: string[];
  reviewerAction?: ReviewerAction;
  timestamp: string;
}

/** Raw GitHub webhook event payload (subset of relevant fields) */
export interface GitHubRawEvent {
  action: string;
  pull_request?: {
    number: number;
    title: string;
    html_url: string;
    user: { login: string };
    head: { ref: string };
    base: { ref: string };
    labels?: Array<{ name: string }>;
  };
  repository: {
    name: string;
    full_name: string;
  };
  review?: {
    user: { login: string };
    state: string;
  };
  comment?: {
    user: { login: string };
    body: string;
  };
}

/** Raw Bitbucket webhook event payload (subset of relevant fields) */
export interface BitbucketRawEvent {
  pullrequest?: {
    id: number;
    title: string;
    links: { html: { href: string } };
    author: { display_name: string; nickname: string };
    source: { branch: { name: string } };
    destination: { branch: { name: string } };
  };
  repository: {
    name: string;
    full_name: string;
  };
  approval?: {
    user: { display_name: string; nickname: string };
  };
  comment?: {
    user: { display_name: string; nickname: string };
    content: { raw: string };
  };
}

/** Raw GitLab webhook event payload (subset of relevant fields) */
export interface GitLabRawEvent {
  object_kind: string;
  event_type?: string;
  object_attributes?: {
    iid: number;
    title: string;
    url: string;
    action?: string;
    source_branch: string;
    target_branch: string;
    labels?: Array<{ title: string }>;
  };
  user?: {
    username: string;
    name: string;
  };
  project?: {
    name: string;
    path_with_namespace: string;
  };
  merge_request?: {
    iid: number;
    title: string;
    url: string;
    source_branch: string;
    target_branch: string;
  };
}
