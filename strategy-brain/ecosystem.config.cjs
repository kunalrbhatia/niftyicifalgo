module.exports = {
  apps: [
    {
      name: 'strategy-brain',
      script: './dist/orchestrator.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PAPER_MODE: 'true',
        LIVE_ENABLED: 'false'
      }
    }
  ]
};
