/**
 * Lambda: deleteExpense
 * DELETE /expenses/{id}
 *
 * Validates the expense belongs to the authenticated user before deleting
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb'

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

    const expenseId = event.pathParameters?.expenseId
    if (!expenseId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing expense ID' }),
      }
    }

    // Verify the expense exists and belongs to this user before deleting
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId, expenseId },
      }),
    )

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Expense not found' }),
      }
    }

    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId, expenseId },
      }),
    )

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Expense deleted successfully',
        expenseId,
      }),
    }
  } catch (error) {
    console.error('deleteExpense error:', error)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
