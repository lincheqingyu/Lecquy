import { getPostgresDevConfig, printLocalPostgresStatus, startLocalPostgres, stopLocalPostgres } from './lib/postgres-dev.mjs'

const command = process.argv[2]

function printUsage() {
  console.error('usage: node scripts/dev-pg.mjs <start|stop|status>')
}

if (!command) {
  printUsage()
  process.exit(1)
}

try {
  const config = getPostgresDevConfig()

  if (command === 'start') {
    startLocalPostgres(config)
    process.exit(0)
  }

  if (command === 'stop') {
    process.exit(stopLocalPostgres(config))
  }

  if (command === 'status') {
    process.exit(printLocalPostgresStatus(config))
  }

  printUsage()
  process.exit(1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
