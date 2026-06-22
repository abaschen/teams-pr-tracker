import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface PrTrackerStackProps extends StackProps {
  environment: string;
  teamsBotId: string;
  teamsBotPassword: string;
  teamsTenantId: string;
}

export class PrTrackerStack extends Stack {
  constructor(scope: Construct, id: string, props: PrTrackerStackProps) {
    super(scope, id, props);

    const { environment, teamsBotId, teamsBotPassword, teamsTenantId } = props;
    const namePrefix = `pr-tracker-${environment}`;

    // ─── KMS Key ──────────────────────────────────────────────────────────────
    const credentialKey = new kms.Key(this, 'CredentialKey', {
      description: 'KMS key for PR Tracker credential encryption',
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      alias: `alias/${namePrefix}-credentials`,
    });

    // ─── DynamoDB Table ───────────────────────────────────────────────────────
    const stateTable = new dynamodb.Table(this, 'StateTable', {
      tableName: `${namePrefix}-state`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    stateTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─── SSM Parameters ───────────────────────────────────────────────────────
    const channelMappings = new ssm.StringParameter(this, 'ChannelMappings', {
      parameterName: `/${namePrefix}/config/channel-mappings`,
      description: 'Teams channel mapping configuration',
      stringValue: JSON.stringify({ mappings: [], defaultChannelId: '' }),
    });

    const featureFlags = new ssm.StringParameter(this, 'FeatureFlags', {
      parameterName: `/${namePrefix}/config/feature-flags`,
      description: 'Feature flags for PR Tracker runtime behavior',
      stringValue: JSON.stringify({
        approvalChainsEnabled: true,
        mentionCleanupEnabled: true,
        circuitBreakerEnabled: true,
        rateLimitWarnings: true,
      }),
    });

    // Webhook secrets (SecureString via KMS)
    const webhookSecretGithub = new ssm.StringParameter(this, 'WebhookSecretGithub', {
      parameterName: `/${namePrefix}/secrets/webhook-secret-github`,
      description: 'GitHub webhook signature verification secret',
      stringValue: 'placeholder-replace-after-deploy',
      type: ssm.ParameterType.SECURE_STRING,
    });

    const webhookSecretBitbucket = new ssm.StringParameter(this, 'WebhookSecretBitbucket', {
      parameterName: `/${namePrefix}/secrets/webhook-secret-bitbucket`,
      description: 'Bitbucket webhook signature verification secret',
      stringValue: 'placeholder-replace-after-deploy',
      type: ssm.ParameterType.SECURE_STRING,
    });

    const webhookSecretGitlab = new ssm.StringParameter(this, 'WebhookSecretGitlab', {
      parameterName: `/${namePrefix}/secrets/webhook-secret-gitlab`,
      description: 'GitLab webhook token verification secret',
      stringValue: 'placeholder-replace-after-deploy',
      type: ssm.ParameterType.SECURE_STRING,
    });

    // ─── Secrets Manager ──────────────────────────────────────────────────────
    const githubCredentials = new secretsmanager.Secret(this, 'GitHubCredentials', {
      secretName: `${namePrefix}/github/credentials`,
      description: 'GitHub API credentials for PR Tracker',
      encryptionKey: credentialKey,
    });

    const bitbucketCredentials = new secretsmanager.Secret(this, 'BitbucketCredentials', {
      secretName: `${namePrefix}/bitbucket/credentials`,
      description: 'Bitbucket API credentials for PR Tracker',
      encryptionKey: credentialKey,
    });

    const gitlabCredentials = new secretsmanager.Secret(this, 'GitLabCredentials', {
      secretName: `${namePrefix}/gitlab/credentials`,
      description: 'GitLab API credentials for PR Tracker',
      encryptionKey: credentialKey,
    });

    const teamsBotCredentials = new secretsmanager.Secret(this, 'TeamsBotCredentials', {
      secretName: `${namePrefix}/teams/bot-credentials`,
      description: 'Microsoft Teams Bot Framework credentials',
      encryptionKey: credentialKey,
    });

    // ─── Lambda Function ──────────────────────────────────────────────────────
    const webhookHandler = new lambda.Function(this, 'WebhookHandler', {
      functionName: `${namePrefix}-webhook`,
      description: 'PR Tracker webhook processor for GitHub, Bitbucket, and GitLab events',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'dist/handlers/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../dist/lambda-bundle')),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: stateTable.tableName,
        CHANNEL_MAPPING_PARAM: channelMappings.parameterName,
        TEAMS_BOT_ID: teamsBotId,
        TEAMS_BOT_PASSWORD: teamsBotPassword,
        TEAMS_TENANT_ID: teamsTenantId,
        GITHUB_WEBHOOK_SECRET: webhookSecretGithub.parameterName,
        BITBUCKET_WEBHOOK_SECRET: webhookSecretBitbucket.parameterName,
        GITLAB_WEBHOOK_SECRET: webhookSecretGitlab.parameterName,
        NODE_ENV: environment,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant permissions
    stateTable.grantReadWriteData(webhookHandler);
    credentialKey.grantDecrypt(webhookHandler);
    channelMappings.grantRead(webhookHandler);
    featureFlags.grantRead(webhookHandler);
    webhookSecretGithub.grantRead(webhookHandler);
    webhookSecretBitbucket.grantRead(webhookHandler);
    webhookSecretGitlab.grantRead(webhookHandler);
    githubCredentials.grantRead(webhookHandler);
    bitbucketCredentials.grantRead(webhookHandler);
    gitlabCredentials.grantRead(webhookHandler);
    teamsBotCredentials.grantRead(webhookHandler);

    // Also grant access to pr-tracker/* secrets (per-repo credential pattern)
    webhookHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:pr-tracker/*`],
      }),
    );

    // ─── API Gateway ──────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: `${namePrefix}-api`,
      description: 'PR Tracker webhook API for receiving provider events',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: environment,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        dataTraceEnabled: false,
      },
    });

    // POST /webhook/{provider}
    const webhook = api.root.addResource('webhook');
    const provider = webhook.addResource('{provider}');
    provider.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler));

    // GET /health (mock)
    const health = api.root.addResource('health');
    health.addMethod(
      'GET',
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                status: 'healthy',
                timestamp: '$context.requestTime',
              }),
            },
          },
        ],
        requestTemplates: {
          'application/json': JSON.stringify({ statusCode: 200 }),
        },
      }),
      {
        methodResponses: [
          {
            statusCode: '200',
            responseModels: { 'application/json': apigateway.Model.EMPTY_MODEL },
          },
        ],
      },
    );

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new CfnOutput(this, 'ApiGatewayUrl', {
      value: `${api.url}webhook`,
      description: 'API Gateway webhook endpoint URL',
    });

    new CfnOutput(this, 'ApiGatewayHealthUrl', {
      value: `${api.url}health`,
      description: 'API Gateway health-check endpoint URL',
    });

    new CfnOutput(this, 'LambdaFunctionArn', {
      value: webhookHandler.functionArn,
      description: 'ARN of the PR Tracker Lambda function',
    });

    new CfnOutput(this, 'DynamoDBTableName', {
      value: stateTable.tableName,
      description: 'DynamoDB table for PR state',
    });

    new CfnOutput(this, 'KmsKeyArn', {
      value: credentialKey.keyArn,
      description: 'KMS key for credential encryption',
    });
  }
}
