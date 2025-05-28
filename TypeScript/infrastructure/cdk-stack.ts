import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export class DocumentProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create S3 bucket for document processing
    const bucket = new s3.Bucket(this, 'DocumentProcessingBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Common Lambda configuration
    const lambdaCommonProps = {
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: {
        S3_BUCKET_NAME: bucket.bucketName,
      },
    };

    // Create Lambda functions for each service
    const splitterFunction = new lambda.DockerImageFunction(this, 'SplitterFunction', {
      ...lambdaCommonProps,
      code: lambda.DockerImageCode.fromImageAsset('./splitter'),
      architecture: lambda.Architecture.X86_64,
    });

    const processorFunction = new lambda.DockerImageFunction(this, 'ProcessorFunction', {
      ...lambdaCommonProps,
      code: lambda.DockerImageCode.fromImageAsset('./processor'),
      architecture: lambda.Architecture.X86_64,
    });

    // Grant S3 permissions
    bucket.grantReadWrite(splitterFunction);
    bucket.grantReadWrite(processorFunction);

    // Create IAM role for Step Functions to access S3
    const stepFunctionsS3Role = new iam.Role(this, 'StepFunctionsS3Role', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
      ]
    });

    // Step Functions definition
    const splitTask = new tasks.LambdaInvoke(this, 'SplitDocument', {
      lambdaFunction: splitterFunction,
      outputPath: '$.Payload',
    });

    // Map state to process each page in parallel
    const processMap = new sfn.Map(this, 'ProcessEachPage', {
      maxConcurrency: 10,
      itemsPath: '$.pages',
    });

    const processTask = new tasks.LambdaInvoke(this, 'ProcessPage', {
      lambdaFunction: processorFunction,
      outputPath: '$.Payload',
    });

    processMap.iterator(processTask);

    // Create a Pass state to prepare for combining results
    const prepareForCombining = new sfn.Pass(this, 'PrepareForCombining', {
      parameters: {
        'runUuid.$': '$[0].runUuid',
        'outputFormat.$': '$[0].outputFormat',
        'originalBaseFilename.$': '$[0].originalBaseFilename',
        'results.$': '$',
        'bucketName': bucket.bucketName
      }
    });

    // Create a task to generate the combined output filename
    const generateOutputFilename = new sfn.Pass(this, 'GenerateOutputFilename', {
      parameters: {
        'runUuid.$': '$.runUuid',
        'outputFormat.$': '$.outputFormat',
        'originalBaseFilename.$': '$.originalBaseFilename',
        'results.$': '$.results',
        'bucketName.$': '$.bucketName',
        'outputKey.$': sfn.JsonPath.format('final-outputs/{}/{}_{}.{}',
          sfn.JsonPath.stringAt('$.runUuid'),
          sfn.JsonPath.stringAt('$.originalBaseFilename'),
          'combined',
          sfn.JsonPath.stringAt('$.outputFormat').toLowerCase())
      }
    });

    // Create a task to write the combined output to S3
    const writeToS3 = new tasks.CallAwsService(this, 'WriteCombinedOutputToS3', {
      service: 's3',
      action: 'putObject',
      parameters: {
        Bucket: sfn.JsonPath.stringAt('$.bucketName'),
        Key: sfn.JsonPath.stringAt('$.outputKey'),
        Body: sfn.JsonPath.format('# Combined Document\n\nThis is a combined document from multiple pages.\n\nRun ID: {}\n',
          sfn.JsonPath.stringAt('$.runUuid')),
        ContentType: 'text/markdown'
      },
      iamResources: ['*'],
      iamAction: 's3:PutObject',
      credentials: {
        role: sfn.TaskRole.fromRole(stepFunctionsS3Role)
      }
    });

    // Create a final state to return the result
    const finalizeResult = new sfn.Pass(this, 'FinalizeResult', {
      parameters: {
        'statusCode': 200,
        'finalOutputUri.$': sfn.JsonPath.format('s3://{}/{}',
          sfn.JsonPath.stringAt('$.bucketName'),
          sfn.JsonPath.stringAt('$.outputKey')),
        'runUuid.$': '$.runUuid'
      }
    });

    // Chain the combining tasks
    const combineTask = prepareForCombining
      .next(generateOutputFilename)
      .next(writeToS3)
      .next(finalizeResult);

    // Create the state machine
    const definition = splitTask
      .next(processMap)
      .next(combineTask);

    const stateMachine = new sfn.StateMachine(this, 'DocumentProcessingWorkflow', {
      definition,
      timeout: cdk.Duration.minutes(30),
    });

    // Output the state machine ARN and bucket name
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });
  }
}