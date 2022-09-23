const { spawn } = require('child_process')

spawn('npm', ['run', 'generator', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
})
