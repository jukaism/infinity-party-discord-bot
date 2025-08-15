import type { AWS } from '@serverless/typescript'

import interaction from '@functions/interaction'
import registration from '@functions/registration'

const serverlessConfiguration: AWS = {
  service: 'discord-interaction',
  frameworkVersion: '3',
  plugins: ['serverless-esbuild', 'serverless-plugin-warmup'],
  provider: {
    name: 'aws',
    runtime: 'nodejs20.x',
    region: 'ap-northeast-1',
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS:
        '--enable-source-maps --stack-trace-limit=1000 --no-warnings',
    },
    iamRoleStatements: [
      {
        Effect: 'Allow',
        Action: ['lambda:InvokeFunction'],
        Resource: '*',
      },
    ],
  },
  // import the function via paths
  functions: { interaction, registration },
  package: { individually: true },
  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ['aws-sdk', '@aws-sdk/client-lambda'],
      target: 'node20',
      define: { 'require.resolve': undefined },
      config: './esbuild.config.js',
      platform: 'node',
      concurrency: 10,
    },
    warmup: {
      default: {
        enabled: true,
        role: 'IamRoleLambdaExecution',
        prewarm: true,
        package: {
          individually: true,
          patterns: ['!node_modules/**', 'src/**'],
        },
      },
    },
  },
}

module.exports = serverlessConfiguration
