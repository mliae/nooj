// PM2 进程配置（备用方案；生产优先用 1Panel Node 项目）
// 用法：pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// 更新代码后：npm ci && npm run build && pm2 reload nooj
module.exports = {
  apps: [
    {
      name: "nooj",
      script: "dist/server.mjs",
      cwd: "/opt/1panel/www/sites/nooj.cn/index",
      instances: 1, // 单实例：SQLite + 本地磁盘 + node-cron，多实例会重复跑定时任务
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        // 其余配置走项目根目录 .env（ADMIN_PASSWORD / SITE_NAME / DATA_DIR 等）
      },
      error_file: "/opt/1panel/www/sites/nooj.cn/index/data/logs/pm2-error.log",
      out_file: "/opt/1panel/www/sites/nooj.cn/index/data/logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
