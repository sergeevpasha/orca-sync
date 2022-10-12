import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { HttpApi, HttpMethod } from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

export class OrcaSyncStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const lambdaFunction: lambda.Function = new lambda.Function(this, 'OrcaSync', {
            functionName: 'OrcaSync',
            runtime: lambda.Runtime.NODEJS_16_X,
            retryAttempts: 0,
            memorySize: 256,
            timeout: Duration.seconds(10),
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '/../src')),
            environment: {
                REGION: Stack.of(this).region,
                AVAILABILITY_ZONES: JSON.stringify(Stack.of(this).availabilityZones)
            }
        });

        const api = new HttpApi(this, 'OrcaSyncHttpApi', {
            apiName: 'Orca Sync HTTP API'
        });

        const apiIntegration = new HttpLambdaIntegration('OrcaSyncIntegration', lambdaFunction);

        api.addRoutes({
            path: '/',
            methods: [HttpMethod.GET],
            integration: apiIntegration
        });
    }
}
