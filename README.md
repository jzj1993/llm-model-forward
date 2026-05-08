# llm-model-forward

本地大模型 API 转发器。客户端连本机，真实请求按网页配置转发到远程模型服务。当前暂时只支持 Anthropic 接口。

```text
Anthropic/Claude 客户端 -> http://127.0.0.1:18787/anthropic -> 远程模型服务
```

## 临时运行

```bash
npm install
npm start
```

临时运行适合临时使用或测试。关闭终端后服务会停止。

## PM2 持续运行

安装 PM2：

```bash
npm install -g pm2
```

安装依赖并后台启动：

```bash
npm install
pm2 start ecosystem.config.cjs
```

常用命令：

```bash
pm2 status llm-model-forward
pm2 logs llm-model-forward
pm2 restart llm-model-forward
pm2 stop llm-model-forward
pm2 delete llm-model-forward
```

开机自启：

```bash
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要复制执行的命令，照着执行一次即可。

修改后端代码后，需要执行：

```bash
pm2 restart llm-model-forward
```

## 客户端配置

Base URL：

```text
http://127.0.0.1:18787/anthropic
```

客户端密钥（API Key）可以随便填，例如：

```text
local-anything
```

真正发给远程模型的密钥（API Key）来自网页配置；网页里没填时，不会向远程模型发送密钥。

## 配置文件

配置文件：项目目录下的 `config.json`，不存在会自动创建。

普通用户建议只用网页改配置。

格式：

```json
{
  "listen": {
    "host": "127.0.0.1",
    "port": 18787
  },
  "debug": false,
  "models": [
    {
      "localModel": "claude-sonnet",
      "remoteModelId": "provider-sonnet",
      "remoteBaseUrl": "https://provider-a.example.com",
      "remoteApiKey": "provider-a-api-key",
      "enabled": true
    }
  ]
}
```

## 开发相关

### 实现思路

- Node.js + Express 提供本地服务，EJS + Tailwind 提供配置页面。
- `/anthropic/*` 会去掉 `/anthropic` 前缀，再转发到对应模型的 `remoteBaseUrl`。
- 请求体里的 `model` 会按配置改成 `remoteModelId`；匹配不到时使用第一条启用的模型配置。
- 如果客户端带了 `x-api-key` 或 `Authorization`，转发时会替换成 `remoteApiKey`；客户端没带鉴权头时不会主动添加。

### 测试

```bash
npm test
```

### 健康检查

```bash
curl http://127.0.0.1:18787/health
```

返回 `{"ok":true,...}` 表示服务在运行。

### 调试日志

默认不写调试日志。需要排查转发失败时，修改 `config.json`：

```json
{
  "debug": true
}
```

重启服务：

```bash
pm2 restart llm-model-forward
```

查看日志：

```bash
tail -f data/llm-model-forward.log
```

日志会记录转发方法、远程模型 URL、远程模型状态码和错误信息；密钥会被隐藏。`data/` 已被 Git 忽略。
