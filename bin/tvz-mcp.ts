#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TvzMcpStack } from '../lib/tvz-mcp-stack';

const app = new cdk.App();

new TvzMcpStack(app, 'TvzMcpStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-central-1',
  },
});
