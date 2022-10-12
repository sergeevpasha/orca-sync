#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OrcaSyncStack } from '../lib/orca-sync-stack';

const app = new cdk.App();
new OrcaSyncStack(app, 'OrcaSyncStack', {
    stackName: 'OrcaSyncStack',
    description: 'Retrieve account pools data from orca.so',
    env: {
        account: '847977720166', // Test account, so I don't care it's not in env
        region: 'eu-west-2'
    }
});
