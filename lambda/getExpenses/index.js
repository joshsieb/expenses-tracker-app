/**
 * Lambda: getExpenses
 * GET /expenses
 *
 * Returns all expenses for the authenticated user, sorted by date desc
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

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
    const userId = event.requestContext?.authorizer?.claims?.sub
    if (!userId) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      }
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: false,
      }),
    )

    // Sort by date descending (secondary sort within DynamoDB's expenseId sort)
    const items = (result.Items || []).sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date)
      return b.createdAt.localeCompare(a.createdAt)
    })

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        expenses: items,
        count: items.length,
      }),
    }
  } catch (error) {
    console.error('getExpenses error:', error)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
