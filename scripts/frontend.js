import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function main() {
  console.log('Deploying frontend assets to S3...')

  let config
  try {
    config = JSON.parse(readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
  } catch (err) {
    console.error(
      'config.json not found or invalid. Please run node setup.js first to set up backend resources.',
    )
    process.exit(1)
  }

  const { region, bucketName, siteUrl } = config
  const s3 = new S3Client({ region })

  let html = readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8')

  const configScript = `<script>
  window.APP_CONFIG = ${JSON.stringify(
    {
      region: config.region,
      userPoolId: config.userPoolId,
      clientId: config.clientId,
      apiUrl: config.apiUrl,
    },
    null,
    4,
  )}
</script>
`
  html = html.replace('<!-- INJECT_CONFIG -->', configScript)

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: 'index.html',
      Body: html,
      ContentType: 'text/html',
    }),
  )

  console.log(`Frontend deployed successfully! Access it at: ${siteUrl}`)
}

main().catch((err) => {
  console.error('Error deploying frontend:', err)
  process.exit(1)
})
