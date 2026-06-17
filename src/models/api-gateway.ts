/**
 * Minimal AWS API Gateway types for Lambda proxy integration.
 * Avoids dependency on @types/aws-lambda for the core model definitions.
 */

/** API Gateway proxy event passed to Lambda handler */
export interface APIGatewayProxyEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  pathParameters: Record<string, string | undefined> | null;
  queryStringParameters: Record<string, string | undefined> | null;
  requestContext: {
    requestId: string;
    stage: string;
  };
}

/** API Gateway proxy result returned from Lambda handler */
export interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}
