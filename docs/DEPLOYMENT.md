# Traceback 部署指南

目标：在一台公网可访问的云服务器上跑起本产品，提交「公网 IP + 端口」形式的 URL，并让评委能用他们的 SSH key 登录服务器查看运行环境。

## 1. 服务器要求

- 任意云平台（阿里云 / 腾讯云 / 火山云均可），按小时或按天租用即可。
- 建议 2 vCPU / 4G 内存（构建 Next.js 需要内存；2G 也可以，但建议本地构建镜像后推上去，或加 swap）。
- 安全组开放端口：`22`（SSH）、`3000`（应用）。

## 2. 添加评委 SSH 公钥（必做，否则视为产品无法访问）

登录服务器后执行：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDuSpd2QiAYU0Er1upObsQitqG5JQ3senYa2imOvcDQl lbh@MacBookPro.local
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICsR0FbL2EzGpR8FytEKni4UFIznz8XiT+xHnX2puF/M di@Dis-MacBook-Air.local
EOF
chmod 600 ~/.ssh/authorized_keys
```

公钥来源：`2026-05-24_项目挑战说明_.pdf` 脚注。粘贴后核对每行以 `ssh-ed25519` 开头、没有被换行截断。

## 3. 部署方式 A：Docker（推荐）

服务器安装 Docker 后：

```bash
git clone https://github.com/MistySun19/PKU-AI-Interviewer.git
cd PKU-AI-Interviewer

# 配置环境变量（参考 .env.example，至少配置 LLM key；强烈建议配 GITHUB_TOKEN）
cp .env.example .env.local
vim .env.local

docker build -t traceback .
docker run -d --name traceback --restart unless-stopped \
  -p 3000:3000 --env-file .env.local traceback
```

注意：完整分析一个仓库仍可能较慢，演示建议使用固定 demo 结果或 `deepseek-v4-flash` + non-thinking。SSE 已内置心跳避免公网链路空闲断连；如果前面挂 nginx 等反向代理，仍建议把 `proxy_read_timeout` 调到 1200s 以上并关闭 `proxy_buffering`；直接用「公网 IP:3000」则无此问题。

## 4. 部署方式 B：pm2（不装 Docker）

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm i -g pm2

git clone https://github.com/MistySun19/PKU-AI-Interviewer.git
cd PKU-AI-Interviewer
cp .env.example .env.local && vim .env.local
npm ci
npm run build
pm2 start npm --name traceback -- start
pm2 save && pm2 startup
```

## 5. 部署后验证（逐条确认）

```bash
# 服务器本机
curl -sf http://localhost:3000 > /dev/null && echo OK

# 本地电脑
curl -sf http://<公网IP>:3000 > /dev/null && echo OK
```

- [ ] 浏览器打开 `http://<公网IP>:3000`，输入一个公开仓库链接，完整跑通一次生成
- [ ] 用一台未登录过的机器验证评委公钥流程没破坏自己的 SSH 登录
- [ ] `.env.local` 没有被 commit（已在 `.gitignore` / `.dockerignore` 中排除）

## 6. 重要提醒

- 截止时间之后服务器上的任何构建和部署都会被认定为超时完成——部署务必留足缓冲，截止后不要再 `docker build` / `npm run build` / 重启部署。
- 提交时若受 API key 额度或部署限制影响，需在邮件中明确说明。
- 分析 run 和面试 session 保存在单进程内存中（前端有本地快照兜底）：重启或重新部署服务会丢失进行中的后台任务，部署后不要随意重启容器。
- 上服务器前先在本地跑一次 `docker build` 验证镜像构建通过。
