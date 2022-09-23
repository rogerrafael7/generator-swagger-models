const { spawn } = require('child_process')
const path = require('path')

spawn('npx', ['ts-node', `${path.resolve(__dirname, '../src/index.ts')}`, ...process.argv.slice(2)], {
  cwd: process.cwd(),
})
