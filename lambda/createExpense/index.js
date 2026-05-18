/**
 * Lambda: createExpense
 * POST /expenses
 *
 * Body: { description, amount, category, date }
 * JWT claims provide userId (sub)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

const client = new DynamoDBClient({ region: process.env.REGION })
const docClient = DynamoDBDocumentClient.from(client)
const TABLE_NAME = process.env.TABLE_NAME

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE',
  'Content-Type': 'application/json',
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  try {
    // Extract userId from Cognito JWT (API Gateway passes claims)
    const userId = event.requestContext?.authorizer?.claims?.sub
    if (!userId) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      }
    }

    const body = JSON.parse(event.body || '{}')
    const { description, amount, category, date } = body

    // Validate required fields
    if (!description || amount === undefined || !category || !date) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing required fields: description, amount, category, date',
        }),
      }
    }

    if (typeof amount !== 'number' || amount < 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'amount must be a non-negative number' }),
      }
    }

    const expenseId = randomUUID()
    const createdAt = new Date().toISOString()

    const item = {
      userId,
      expenseId,
      description: description.trim(),
      amount: parseFloat(amount.toFixed(2)),
      category,
      date,
      createdAt,
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    )

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify(item),
    }
  } catch (error) {
    console.error('createExpense error:', error)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
