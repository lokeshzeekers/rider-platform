module.exports = {
  apps: [
    {
      name: 'ridemesh-api',
      script: './server.js',
      cwd: __dirname,
      instances: 1, // Socket.IO with in-memory adapter needs sticky sessions to scale beyond 1;
                    // add the socket.io-redis adapter before raising this past 1.
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '400M',
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true
    }
  ]
};
