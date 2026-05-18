/**
 * Lambda: updateExpense
 * PUT /expenses/{id}
 *
 * Body: { description?, amount?, category?, date? }
 * Only updates fields that are provided
 * Validates the expense belongs to the authenticated user before updating
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  UpdateCommand,
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

    // Verify the expense exists and belongs to this user
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

    const body = JSON.parse(event.body || '{}')
    const { description, amount, category, date } = body

    // Build dynamic update expression for only provided fields
    const updateParts = []
    const expressionAttributeValues = {}
    const expressionAttributeNames = {}

    if (description !== undefined) {
      updateParts.push('#desc = :desc')
      expressionAttributeNames['#desc'] = 'description'
      expressionAttributeValues[':desc'] = description.trim()
    }
    if (amount !== undefined) {
      if (typeof amount !== 'number' || amount < 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'amount must be a non-negative number',
          }),
        }
      }
      updateParts.push('amount = :amount')
      expressionAttributeValues[':amount'] = parseFloat(amount.toFixed(2))
    }
    if (category !== undefined) {
      updateParts.push('#cat = :cat')
      expressionAttributeNames['#cat'] = 'category'
      expressionAttributeValues[':cat'] = category
    }
    if (date !== undefined) {
      updateParts.push('#dt = :dt')
      expressionAttributeNames['#dt'] = 'date'
      expressionAttributeValues[':dt'] = date
    }

    if (updateParts.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No fields to update' }),
      }
    }

    // Always update updatedAt
    updateParts.push('updatedAt = :updatedAt')
    expressionAttributeValues[':updatedAt'] = new Date().toISOString()

    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId, expenseId },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(Object.keys(expressionAttributeNames).length > 0 && {
          ExpressionAttributeNames: expressionAttributeNames,
        }),
        ReturnValues: 'ALL_NEW',
      }),
    )

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.Attributes),
    }
  } catch (error) {
    console.error('updateExpense error:', error)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
