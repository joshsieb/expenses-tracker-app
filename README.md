# Personal Expenses tracker

Full-stack AWS: Cognito - DynamoDB - API Gateway - Lambda - S3

## Architecture

```
S3 Static Site (frontend)
└─► Cognito User Pool (authentication)
└─► API Gateway (REST API, authorization)
    └─► Lambda Functions
        └─►DynamoDB (expenses data)
```

## Prerequisites

- Node.js 18+
- AWS CLI configured (`aws configure`) with a user that has permissions for:
  Cognito, DynamoDB, Lambda, API Gateway, S3, IAM
- npm packages: `npm install` in the root

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run setup (creates all AWS resources)

```bash
node scripts/setup.js
```

This will:

- Create the DynamoDB table
- Create Cognito User Pool + App Client
- Create the Lambda IAM role
- Zip & deploy all 4 Lambda functions
- Create API Gateway with JWT authorizer
- Create the S3 bucket for static hosting
- Output a `config.json` with all resource IDs

### 3. Deploy the frontend

```bash
node scripts/frontend.js
```

This injects the `config.json` values into the frontend and uploads to S3.

### 4. Open the site

The deploy script prints the S3 website URL. Open it in your browser.

## DynamoDB Schema

Table: `js-expenses-tracker-db-table`

- Partition key: `userId` (String) — from Cognito JWT sub claim
- Sort key: `expenseId` (String) — UUID
  Attributes: amount (N), category (S), description (S), date (S), createdAt (S)

## API Endpoints

All routes require `Authorization: Bearer <IdToken>` header.

| Method | Path           | Lambda        | Description        |
| ------ | -------------- | ------------- | ------------------ |
| POST   | /expenses      | createExpense | Create new expense |
| GET    | /expenses      | getExpenses   | List all for user  |
| PUT    | /expenses/{id} | updateExpense | Update by ID       |
| DELETE | /expenses/{id} | deleteExpense | Delete by ID       |

## Issues I Had

I had a lot of problems with CORS and getting the requests to the API to work. At first it was issues just sending the GET request
to get the expenses in the users account. I fixed this by going in an enabling the CORS on the AWS dashboard on the API Gateway for the `/expenses` and `/expenses/{expenseId}`, then after I fixed that I had issues getting the page to actually render and show on the screen. This ended up being that I had the HTML div display set to `''` instead of `'block'`. After that it was more issues with CORS and accessing the expenses so I could update them or delete them, and I think this ended up being that I had the Lambda permissions assigned to the wrong API because I had to keep re-deploying so every time I updated something in my code. If I had more time with this, I would've added capability in the `setup.js` file to check if there was already an API and Cognito User Pool present with the same name.
