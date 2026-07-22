import { join } from 'node:path';
import {
  type IResource,
  LambdaIntegration,
  MockIntegration,
  PassthroughBehavior,
  Period,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { BlockPublicAccess, Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { CfnIndex, CfnVectorBucket } from 'aws-cdk-lib/aws-s3vectors';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cdk from 'aws-cdk-lib/core';
import { Duration, RemovalPolicy } from 'aws-cdk-lib/core';
import type { Construct } from 'constructs';

export interface TvzMcpStackProps extends cdk.StackProps {
  // e-mail adresa na koju stizu obavijesti o troskovima i alarmima
  readonly alertEmail: string;
}

export class TvzMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TvzMcpStackProps) {
    super(scope, id, props);

    // definiranje konstanta potrebne za stvaranje baza znanja i vektorskih indeksa
    const s3BucketName = `tvz-data-bucket-${this.account}`;
    const s3VectorIndexName = 'vector-index';

    // definiramo koji model koristimo za procesiranje teksta
    const embeddingModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;

    // stvaramo S3 bucket za pohranu vektorskih indeksa
    const dataBucket = new Bucket(this, s3BucketName, {
      bucketName: s3BucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      // TODO: Remove auto-delete before production so stack deletion cannot delete source documents.
      autoDeleteObjects: true,
      versioned: true,
    });

    // stvaramo S3 Vectors bucket i indeks za pohranu embeddinga
    const vectorBucket = new CfnVectorBucket(this, 'VectorEmbeddingsBucket');
    vectorBucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

    const vectorIndex = new CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: s3VectorIndexName,
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
    });
    vectorIndex.applyRemovalPolicy(RemovalPolicy.DESTROY);
    vectorIndex.addDependency(vectorBucket);

    // stvaramo IAM ulogu koja će biti korištena za pristup S3 bucketima i Bedrock modelima
    const kbRole = new Role(this, 'KbRole', {
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          },
        },
      }),
      inlinePolicies: {
        S3DataSourceAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: 'S3ListBucket',
              effect: Effect.ALLOW,
              actions: ['s3:ListBucket'],
              resources: [dataBucket.bucketArn],
              conditions: {
                StringEquals: { 'aws:ResourceAccount': this.account },
              },
            }),
            new PolicyStatement({
              sid: 'S3GetObject',
              effect: Effect.ALLOW,
              actions: ['s3:GetObject'],
              resources: [`${dataBucket.bucketArn}/*`],
              conditions: {
                StringEquals: { 'aws:ResourceAccount': this.account },
              },
            }),
          ],
        }),
        S3VectorsAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: 'S3VectorsPermissions',
              effect: Effect.ALLOW,
              actions: [
                's3vectors:GetIndex',
                's3vectors:QueryVectors',
                's3vectors:PutVectors',
                's3vectors:GetVectors',
                's3vectors:DeleteVectors',
              ],
              resources: [vectorIndex.attrIndexArn],
              conditions: {
                StringEquals: { 'aws:ResourceAccount': this.account },
              },
            }),
          ],
        }),
        BedrockFoundationModel: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: 'BedrockInvokeModel',
              effect: Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [embeddingModelArn],
            }),
          ],
        }),
      },
    });

    // stvaramo Bedrock Knowledge Base koristeći S3 bucket i IAM ulogu
    const knowledgeBase = new CfnKnowledgeBase(this, 'knowledgeBase', {
      name: 'tvz-knowledge-base',
      description: 'TVZ documentation knowledge base',
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              embeddingDataType: 'FLOAT32',
            },
          },
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          indexArn: vectorIndex.attrIndexArn,
        },
      },
    });

    // stvori vezu izmedu S3 bucket i Bedrock knowledge base
    const s3DataSource = new CfnDataSource(this, 'KBS3DataSource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'tvz-s3-data-source',
      description: 'S3 bucket containing TVZ documentation',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: dataBucket.bucketArn,
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'SEMANTIC',
          semanticChunkingConfiguration: {
            maxTokens: 300,
            bufferSize: 1,
            breakpointPercentileThreshold: 95,
          },
        },
      },
      dataDeletionPolicy: 'DELETE',
    });

    // Lambda funkcija koja izvodi semanticku pretragu baze znanja
    const fetchEmbeddingsFunction = new NodejsFunction(
      this,
      'FetchEmbeddingsFunction',
      {
        functionName: 'tvz-mcp-fetch-embeddings',
        entry: join(__dirname, '../lambdas/fetchEmbeddings.ts'),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        bundling: {
          forceDockerBundling: false,
          externalModules: [],
        },
        reservedConcurrentExecutions: 5,
        environment: {
          KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
          REGION: this.region,
        },
      }
    );

    // dozvola Lambda funkciji za dohvat iz baze znanja
    fetchEmbeddingsFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      })
    );

    // Lambda funkcija koja pokrece sinkronizaciju baze znanja nakon S3 promjene.
    // reservedConcurrentExecutions: 1 serijalizira navale uploada u jedan po jedan
    // poziv, cime se izbjegava lavina paralelnih ingestion pokusaja
    const startIngestionFunction = new NodejsFunction(
      this,
      'StartIngestionFunction',
      {
        functionName: 'tvz-mcp-start-ingestion',
        entry: join(__dirname, '../lambdas/startIngestion.ts'),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        bundling: {
          forceDockerBundling: false,
          externalModules: [],
        },
        reservedConcurrentExecutions: 1,
        environment: {
          KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
          DATA_SOURCE_ID: s3DataSource.attrDataSourceId,
          REGION: this.region,
        },
      }
    );

    // dozvola za pokretanje i pracenje ingestion jobova;
    // resurs za ove akcije je ARN baze znanja
    startIngestionFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:StartIngestionJob',
          'bedrock:GetIngestionJob',
          'bedrock:ListIngestionJobs',
        ],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      })
    );

    // svaka promjena u data bucketu automatski pokrece sinkronizaciju;
    // dataDeletionPolicy DELETE znaci da brisanje objekta uklanja i njegove
    // vektore pri sljedecoj sinkronizaciji
    dataBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(startIngestionFunction)
    );
    dataBucket.addEventNotification(
      EventType.OBJECT_REMOVED,
      new LambdaDestination(startIngestionFunction)
    );

    // REST API kao javno sucelje za pretragu baze znanja
    const api = new RestApi(this, 'TvzMcpApi', {
      restApiName: 'tvz-mcp-api',
      description: 'TVZ MCP API for querying the knowledge base',
      deployOptions: {
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
    });

    const queryResource = api.root.addResource('query');
    queryResource.addMethod(
      'POST',
      new LambdaIntegration(fetchEmbeddingsFunction),
      {
        // API kljuc je obavezan za POST; OPTIONS preflight ostaje bez kljuca
        apiKeyRequired: true,
      }
    );
    addCorsOptions(queryResource);

    // API kljuc i plan koristenja ogranicavaju potrosnju (produkcijski uzorak)
    const apiKey = api.addApiKey('TvzMcpApiKey', {
      apiKeyName: 'tvz-mcp-api-key',
    });
    const usagePlan = api.addUsagePlan('TvzMcpUsagePlan', {
      name: 'tvz-mcp-usage-plan',
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 1000,
        period: Period.MONTH,
      },
    });
    usagePlan.addApiStage({ stage: api.deploymentStage });
    usagePlan.addApiKey(apiKey);

    // mjesecni budzet s obavijestima na 50% i 90% stvarne potrosnje
    new CfnBudget(this, 'TvzMcpBudget', {
      budget: {
        budgetName: 'tvz-mcp-monthly-budget',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 100, unit: 'USD' },
      },
      notificationsWithSubscribers: [50, 90].map((threshold) => ({
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [
          {
            subscriptionType: 'EMAIL',
            address: props.alertEmail,
          },
        ],
      })),
    });

    // SNS tema i alarm za neocekivano velik broj poziva Lambda funkcije
    const alertTopic = new Topic(this, 'TvzMcpAlertTopic');
    alertTopic.addSubscription(new EmailSubscription(props.alertEmail));

    const invocationThreshold = 200;
    const invocationAlarm = new Alarm(this, 'TvzMcpInvocationAlarm', {
      alarmName: 'tvz-mcp-high-invocations',
      metric: fetchEmbeddingsFunction.metricInvocations({
        period: Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: invocationThreshold,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: `Lambda invocations exceeding ${invocationThreshold} calls/hour`,
    });
    invocationAlarm.addAlarmAction(new SnsAction(alertTopic));

    // izlazne vrijednosti stacka
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.attrKnowledgeBaseId,
    });
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'DataSourceId', {
      value: s3DataSource.attrDataSourceId,
    });
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
    // vrijednost kljuca se dohvaca nakon deploya:
    // aws apigateway get-api-key --api-key <id> --include-value
    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
    });
  }
}

// dodaje OPTIONS metodu s CORS zaglavljima na resurs (mock integracija)
function addCorsOptions(apiResource: IResource) {
  apiResource.addMethod(
    'OPTIONS',
    new MockIntegration({
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers':
              "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Credentials':
              "'false'",
            'method.response.header.Access-Control-Allow-Methods':
              "'OPTIONS,GET,PUT,POST,DELETE'",
          },
        },
      ],
      passthroughBehavior: PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }),
    {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    }
  );
}
