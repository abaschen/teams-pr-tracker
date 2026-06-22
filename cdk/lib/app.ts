#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { PrTrackerStack } from './pr-tracker-stack.js';

const app = new App();

const environment = app.node.tryGetContext('environment') ?? 'dev';
const region = app.node.tryGetContext('region') ?? 'us-east-1';

new PrTrackerStack(app, `PrTracker-${environment}`, {
  env: { region, account: process.env.CDK_DEFAULT_ACCOUNT },
  environment,
  teamsBotId: app.node.tryGetContext('teamsBotId') ?? '',
  teamsBotPassword: app.node.tryGetContext('teamsBotPassword') ?? '',
  teamsTenantId: app.node.tryGetContext('teamsTenantId') ?? '',
});
