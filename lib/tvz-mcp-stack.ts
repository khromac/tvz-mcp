import * as cdk from 'aws-cdk-lib/core';
import {RemovalPolicy} from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {CfnKnowledgeBase, CfnDataSource} from "aws-cdk-lib/aws-bedrock";
import {CfnIndex, CfnVectorBucket} from "aws-cdk-lib/aws-s3vectors";

export class TvzMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // definiranje konstanta potrebne za stvaranje baza znanja i vektorskih indeksa
    const s3BucketName = `tvz-data-bucket-${this.account}`;
    const s3VectorIndexName = "vector-index";

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
      }
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
            }
          }
        },

      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          indexArn: vectorIndex.attrIndexArn,
        }
      }
    });


    // stvori vezu izmedu S3 bucket i Bedrock knowledge base
    new CfnDataSource(this, 'KBS3DataSource', {
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
  }
}
