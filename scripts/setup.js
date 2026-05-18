import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider'

import {
  DynamoDBClient,
  CreateTableCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb'

import {
  IAMClient,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
} from '@aws-sdk/client-iam'

import {
  LambdaClient,
  CreateFunctionCommand,
  AddPermissionCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda'

import {
  APIGatewayClient,
  CreateRestApiCommand,
  GetResourcesCommand,
  CreateResourceCommand,
  PutMethodCommand,
  PutIntegrationCommand,
  CreateDeploymentCommand,
  CreateAuthorizerCommand,
  PutMethodResponseCommand,
  PutIntegrationResponseCommand,
} from '@aws-sdk/client-api-gateway'

import {
  S3Client,
  CreateBucketCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
} from '@aws-sdk/client-s3'

import {
  readFileSync,
  writeFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
} from 'fs'
import archiver from 'archiver'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REGION = process.env.AWS_REGION || 'us-east-2'

const cognito = new CognitoIdentityProviderClient({ region: REGION })
const dynamo = new DynamoDBClient({ region: REGION })
const iam = new IAMClient({ region: REGION })
const lambda = new LambdaClient({ region: REGION })
const apigw = new APIGatewayClient({ region: REGION })
const s3 = new S3Client({ region: REGION })

//Helper fuctions
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function zipLambda(funcName) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(os.tmpdir(), `${funcName}.zip`)
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    const pkgPath = path.join(ROOT, 'lambda', funcName, 'package.json')

    output.on('close', () => {
      try {
        const buffer = readFileSync(zipPath)
        resolve(buffer)
      } catch (err) {
        reject(err)
      }
    })
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        reject(err)
      }
    })

    archive.pipe(output)
    archive.file(path.join(ROOT, 'lambda', funcName, 'index.js'), {
      name: 'index.js',
    })
    archive.file(pkgPath, { name: 'package.json' })
    archive.finalize()
  })
}

//Create DynamoDB table with DynamoDB
async function createDynamoDBTable() {
  console.log('Creating DynamoDB Table...')

  const params = {
    TableName: 'js-expenses-tracker-db-table',
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'expenseId', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'expenseId', AttributeType: 'S' },
    ],
  }
  try {
    const data = await dynamo.send(new CreateTableCommand(params))
    console.log('DynamoDB Table created: ', data)
    console.log('Waiting for DynamoDB Table to become active...')
    await waitUntilTableExists(
      { client: dynamo, maxWaitTime: 60 },
      { TableName: 'js-expenses-tracker-db-table' },
    )
    console.log('DynamoDB Table is now active')
  } catch (err) {
    if (err.name === 'ResourceInUseException') {
      console.log('DynamoDB Table already exists, continuing...')
    } else {
      console.error('Error creating DynamoDB Table ', err)
    }
  }
  return 'js-expenses-tracker-db-table'
}

//Create User Pool with Cognito
async function createUserPool() {
  console.log('Creating Cognito User Pool...')

  const pool = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: 'js-expenses-tracker-user-pool',
      AutoVerifiedAttributes: ['email'],
      UsernameAttributes: ['email'],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: false,
          RequireLowercase: false,
          RequireNumbers: false,
          RequireSymbols: false,
        },
      },
      Schema: [
        {
          Name: 'name',
          AttributeDataType: 'String',
          Required: true,
          Mutable: true,
        },
        {
          Name: 'email',
          AttributeDataType: 'String',
          Required: true,
          Mutable: true,
        },
      ],
    }),
  )

  const userPoolId = pool.UserPool.Id
  console.log(`User Pool created: ${userPoolId}`)

  const client = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: 'js-expenses-tracker-client',
      GenerateSecret: false,
      ExplicitAuthFlows: [
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH',
        'ALLOW_USER_SRP_AUTH',
      ],
      PreventUserExistenceErrors: 'ENABLED',
      SupportedIdentityProviders: ['COGNITO'],
    }),
  )
  const clientId = client.UserPoolClient.ClientId

  console.log(`User Pool Client created: ${clientId}`)

  return { userPoolId, clientId }
}

// IAM Role for Lambda
async function createLambdaRole() {
  console.log('Creating IAM Role for Lambda...')

  const roleName = 'js-expenses-tracker-lambda-role'

  try {
    const existingRole = await iam.send(
      new GetRoleCommand({ RoleName: roleName }),
    )
    console.log(`IAM Role already exists: ${existingRole.Role.Arn}`)
    return existingRole.Role.Arn
  } catch {}

  const role = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
    }),
  )
  // Attach DynamoDB and CloudWatch permissions to the Lambda role
  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess',
    }),
  )
  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn:
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    }),
  )
  console.log(`IAM Role created: ${role.Role.Arn}`)
  console.log('Waiting for IAM Role to propagate...')
  await sleep(10000) // Wait for 10 seconds to ensure the role is fully propagated
  return role.Role.Arn
}

// Create Lambda function
async function lambdaFunctions(roleArn) {
  console.log('Creating Lambda functions...')

  const functions = [
    'createExpense',
    'getExpenses',
    'updateExpense',
    'deleteExpense',
  ]
  const arns = {}

  for (const funcName of functions) {
    console.log(`Zipping ${funcName}...`)
    const zipBuffer = await zipLambda(funcName)
    console.log(`Zip created for ${funcName}, size: ${zipBuffer.length} bytes`)

    const functionName = `js-expenses-tracker-${funcName}`
    console.log(`Deploying Lambda function: ${functionName}...`)

    try {
      const func = await lambda.send(
        new CreateFunctionCommand({
          FunctionName: functionName,
          Runtime: 'nodejs20.x',
          Role: roleArn,
          Handler: 'index.handler',
          Code: {
            ZipFile: zipBuffer,
          },
          Environment: {
            Variables: {
              TABLE_NAME: 'js-expenses-tracker-db-table',
              REGION: REGION,
            },
          },
          Timeout: 10,
          MemorySize: 256,
        }),
      )
      arns[funcName] = func.FunctionArn
      console.log(`Lambda function created: ${functionName}`)
    } catch (err) {
      if (err.name === 'ResourceConflictException') {
        console.log(
          `Lambda function ${functionName} already exists, updating code...`,
        )
        const func = await lambda.send(
          new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBuffer,
          }),
        )
        arns[funcName] = func.FunctionArn
        console.log(`Lambda function updated: ${functionName}`)
      } else throw err
    }
  }
  return arns
}

// Create API Gateway REST API
async function createApiGateway(lambdaArns, userPoolId, clientId) {
  console.log('Creating API Gateway REST API...')

  console.log('lambdaArns:', JSON.stringify(lambdaArns, null, 2))

  const accountId = Object.values(lambdaArns)[0].split(':')[4]
  console.log('accountId:', accountId)
  console.log('userPoolId:', userPoolId)
  console.log('clientId:', clientId)

  const api = await apigw.send(
    new CreateRestApiCommand({
      name: 'js-expenses-tracker-api',
      description: 'API for managing expenses',
    }),
  )
  const apiId = api.id
  console.log(`API Gateway created: ${apiId}`)

  const authorizer = await apigw.send(
    new CreateAuthorizerCommand({
      restApiId: apiId,
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      providerARNs: [
        `arn:aws:cognito-idp:${REGION}:${accountId}:userpool/${userPoolId}`,
      ],
      identitySource: 'method.request.header.Authorization',
    }),
  )
  const authorizerId = authorizer.id
  console.log(`Authorizer created: ${authorizerId}`)

  const resources = await apigw.send(
    new GetResourcesCommand({ restApiId: apiId }),
  )
  const rootResourceId = resources.items.find((r) => r.path === '/').id

  const expensesResource = await apigw.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'expenses',
    }),
  )
  const expensesId = expensesResource.id

  const expenseIdResource = await apigw.send(
    new CreateResourceCommand({
      restApiId: apiId,
      parentId: expensesId,
      pathPart: '{expenseId}',
    }),
  )
  const expenseIdResourceId = expenseIdResource.id

  async function addMethod(resourceId, httpMethod, funcName) {
    const lambdaUri = `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${lambdaArns[funcName]}/invocations`

    await apigw.send(
      new PutMethodCommand({
        restApiId: apiId,
        resourceId,
        httpMethod,
        authorizationType: 'COGNITO_USER_POOLS',
        authorizerId,
      }),
    )

    await apigw.send(
      new PutIntegrationCommand({
        restApiId: apiId,
        resourceId,
        httpMethod,
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaUri,
      }),
    )

    try {
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: `js-expenses-tracker-${funcName}`,
          StatementId: `apigateway-${apiId}-${httpMethod}-${resourceId}`,
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: `arn:aws:execute-api:${REGION}:${accountId}:${apiId}/*/${httpMethod}/*`,
        }),
      )
    } catch (err) {
      if (!err.message?.includes('already exists')) throw err
    }

    console.log(
      `${httpMethod} /expenses${resourceId === expensesId ? 'expenses' : 'expenses/{id}'} > ${funcName}`,
    )
  }
  await addMethod(expensesId, 'POST', 'createExpense')
  await addMethod(expensesId, 'GET', 'getExpenses')
  await addMethod(expenseIdResourceId, 'PUT', 'updateExpense')
  await addMethod(expenseIdResourceId, 'DELETE', 'deleteExpense')

  await apigw.send(
    new CreateDeploymentCommand({
      restApiId: apiId,
      stageName: 'prod',
    }),
  )

  const apiUrl = `https://${apiId}.execute-api.${REGION}.amazonaws.com/prod`
  console.log('API Gateway deployed: ', apiUrl)
  return { apiId, apiUrl }
}

// Create S3 static site bucket
async function createS3Bucket() {
  console.log('Creating S3 Bucket for static site hosting...')

  const bucketName = 'js-expenses-tracker-bucket'

  if (REGION === 'us-east-1') {
    await s3.send(new CreateBucketCommand({ Bucket: bucketName }))
  } else {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: REGION,
        },
      }),
    )
  }

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  )

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
        ],
      }),
    }),
  )

  await s3.send(
    new PutBucketWebsiteCommand({
      Bucket: bucketName,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'index.html' },
      },
    }),
  )

  const siteUrl = `http://${bucketName}.s3-website.${REGION}.amazonaws.com`
  console.log('S3 Bucket created: ', siteUrl)
  return { bucketName, siteUrl }
}

//Main function to orchestrate the setup
async function main() {
  console.log(
    'Setting up AWS resources for JS Expenses Tracker...\n' +
      '-'.repeat(50) +
      '\n',
  )

  const tableName = await createDynamoDBTable()
  const { userPoolId, clientId } = await createUserPool()
  const roleArn = await createLambdaRole()
  const lambdaArns = await lambdaFunctions(roleArn)
  const { apiId, apiUrl } = await createApiGateway(
    lambdaArns,
    userPoolId,
    clientId,
  )
  const { bucketName, siteUrl } = await createS3Bucket()

  const config = {
    region: REGION,
    userPoolId,
    clientId,
    apiUrl,
    bucketName,
    siteUrl,
    tableName,
  }

  writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(config, null, 2))
  console.log('Setup complete! Configuration saved to config.json')
  console.log('Site URL: ', siteUrl)
}

main().catch((err) => {
  console.error('Setup Failed: ', err)
  process.exit(1)
})
