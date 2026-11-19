/**
 * 一键部署到生产服务器（1Panel 容器 nooj）。
 *
 * 用法：
 *   node scripts/deploy.cjs                 # 构建 + 上传默认文件 + 重启容器 + 验证 + 推送 GitHub
 *   node scripts/deploy.cjs --no-build      # 跳过 npm run build
 *   node scripts/deploy.cjs --no-push       # 部署后不提交/推送 GitHub
 *   node scripts/deploy.cjs file1 file2 ... # 额外上传指定文件（相对项目根目录，目标保持相同相对路径）
 *
 * 默认上传：dist/server.mjs、public/app.js、public/i18n.js
 * 流程：本地构建 → sftp 上传到 /tmp/nooj-deploy → sudo cp 覆盖站点目录 → docker restart nooj → 健康检查 → git 提交并推送。
 * 服务器连接信息从项目根 .env 读取（NOOJ_SSH_HOST / NOOJ_SSH_PORT / NOOJ_SSH_USER / NOOJ_SSH_PASSWORD），不入库。
 * 注意：若改了前端资源，部署后还需到 EdgeOne 控制台刷新 https://nooj.cn/ 与 /index.html 缓存
 *      （app.js 等带 ?v=版本号 的资源无需刷新，版本号变更会自动回源）。
 */
const { Client } = require('ssh2');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

/** 读取项目根 .env（不覆盖已存在的环境变量），避免把服务器凭据写进仓库 */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const SSH = {
  host: process.env.NOOJ_SSH_HOST || '',
  port: Number(process.env.NOOJ_SSH_PORT || 22),
  username: process.env.NOOJ_SSH_USER || 'ubuntu',
  password: process.env.NOOJ_SSH_PASSWORD || '',
  readyTimeout: 20000,
};
const SITE_DIR = '/opt/1panel/www/sites/nooj';
const TMP_DIR = '/tmp/nooj-deploy';

const DEFAULT_FILES = ['dist/server.mjs', 'public/app.js', 'public/i18n.js'];

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const noPush = args.includes('--no-push');
const extraFiles = args.filter(a => a !== '--no-build' && a !== '--no-push');
const files = [...DEFAULT_FILES, ...extraFiles];

if (!SSH.host || !SSH.password) {
  console.error('缺少服务器连接配置：请在项目根 .env 中设置 NOOJ_SSH_HOST / NOOJ_SSH_PASSWORD（参考 .env.example）');
  process.exit(1);
}

if (!noBuild) {
  console.log('>>> npm run build');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
}

for (const f of files) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.error('文件不存在: ' + f);
    process.exit(1);
  }
}

const c = new Client();
function exec(cmd) {
  return new Promise(resolve => {
    console.log('$ ' + cmd);
    c.exec(cmd, (e, stream) => {
      if (e) { console.error('EXEC ERR', e.message); resolve(''); return; }
      let out = '';
      stream.on('data', d => out += d.toString()).stderr.on('data', d => out += d.toString());
      stream.on('close', () => { process.stdout.write(out); resolve(out); });
    });
  });
}

/** 部署成功后把当前源码提交并推送到 GitHub（无 remote 或无改动时静默跳过） */
function pushToGitHub() {
  if (noPush) { console.log('\n>>> 已指定 --no-push，跳过 GitHub 推送'); return; }
  try {
    const remotes = execSync('git remote', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!remotes) { console.log('\n>>> 未配置 git remote，跳过 GitHub 推送'); return; }
    execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
    const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!dirty) { console.log('\n>>> 工作区无改动，无需提交'); return; }
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    execSync(`git commit -m "deploy: ${stamp}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    console.log('>>> 已提交并推送到 GitHub');
  } catch (e) {
    console.error('>>> GitHub 推送失败（部署本身不受影响）：' + (e.message || e));
  }
}

c.on('ready', async () => {
  try {
    await exec(`mkdir -p ${TMP_DIR}`);
    await new Promise((res, rej) => c.sftp(async (err, sftp) => {
      if (err) return rej(err);
      for (const f of files) {
        // 用完整相对路径做远程临时名，避免同名文件（如两个主题的 theme.js）互相覆盖
        const rel = f.replace(/[\\/]/g, "__");
        await new Promise((r2, rj2) => sftp.fastPut(path.join(ROOT, f), `${TMP_DIR}/${rel}`, e2 => e2 ? rj2(e2) : r2()));
        console.log('uploaded:', f);
      }
      res();
    }));
    for (const f of files) {
      const rel = f.replace(/[\\/]/g, "__");
      await exec(`sudo cp ${TMP_DIR}/${rel} ${SITE_DIR}/${f}`);
    }
    await exec('sudo docker restart nooj && sleep 5');
    await exec('sudo docker logs --tail 5 nooj 2>&1');
    const health = await exec('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health');
    if (health.trim() === '200') {
      console.log('\n✅ 部署完成，健康检查 200。若改了前端，请到 EdgeOne 刷新 https://nooj.cn/ 缓存。');
      pushToGitHub();
    } else {
      console.log('\n❌ 健康检查异常：' + health);
    }
  } catch (e2) { console.error('FAIL:', e2.message); }
  c.end();
}).on('error', e => { console.error('SSH 连接失败:', e.message); process.exit(1); })
  .connect(SSH);
