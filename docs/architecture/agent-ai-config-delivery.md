# Agent 租户 AI 配置下发（客户端实现）

> 来源：平台《Agent 获取 AI 配置接口说明》（钉钉文档 `nYMoO1rWxap27EMgTR2PkXzvV47Z3je9`，需登录访问）。
> 本文只记录客户端落地所需契约与本仓库实现方式，接口以平台文档为准。

## 1. 目标

Agent 的 `baseUrl`、`apiKey`、`model`、`timeoutSeconds`、`enabled` 不再由安装包或本机环境变量提供，
改由平台按 `App-Auth` Token 中的 `tenant_id` 下发，并以 RSA + AES 混合加密传输。

客户端约束：

- 供应商密钥只存在于 Electron 主进程内存；不进入 Renderer、日志、报错与磁盘。
- 环境变量只保留功能开关、并发度与缺省值，其中 `SMARTLINK_AGENT_MODEL_API_KEY` 已移除。
- 远端配置不可用时，Agent 功能显式降级，不使用任何本机密钥兜底。

## 2. 接口契约

网关前缀：`https://<gateway>/toolkit`；客户端以登录会话的 `platformBaseUrl` 为根拼接下列路径。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/toolkit/toolbox/ai/crypto/public-key` | 取当前生效 RSA 公钥与 `keyId` |
| POST | `/toolkit/toolbox/ai/config` | 提交 RSA 加密的 AES 密钥，换取加密的租户配置 |

公共请求头：

```text
App-Auth: bearer <accessToken>
Accept: */*
```

### 2.1 获取公钥响应

```json
{
  "code": 200,
  "success": true,
  "data": {
    "keyId": "default",
    "algorithm": "RSA-OAEP-256",
    "publicKey": "MIIBIjANBgkq...IDAQAB"
  },
  "msg": "操作成功"
}
```

`publicKey` 是 **X.509/SPKI DER 的 Base64（非 PEM）**。客户端用 Node `createPublicKey({ format: 'der', type: 'spki' })` 解析。

### 2.2 获取配置

请求体：

```json
{
  "keyId": "<public-key 接口 data.keyId>",
  "encryptedKey": "<RSA-OAEP(SHA-256) 加密后的 32 字节 AES 密钥 Base64>"
}
```

响应体：

```json
{
  "code": 200,
  "success": true,
  "data": {
    "keyId": "default",
    "alg": "RSA-OAEP-256+A256GCM",
    "iv": "Base64(12 字节 IV)",
    "ciphertext": "Base64(密文 || 16 字节 GCM tag)"
  },
  "msg": "操作成功"
}
```

### 2.3 加解密参数（必须与服务端完全一致）

| 项 | 值 |
| --- | --- |
| RSA | `RSA/ECB/OAEPPadding` |
| OAEP / MGF1 摘要 | `SHA-256`（Node `oaepHash: 'sha256'` 同时用于 OAEP 与 MGF1） |
| AES 密钥 | 32 字节随机生成，每次请求重新生成 |
| AES | `AES-256-GCM`，`iv` 12 字节，tag 128 位并附在密文末尾 |
| 编码 | 标准 Base64，非 URL-safe |

## 3. 解密后的配置载荷

```json
{
  "baseUrl": "https://datapulse.example.com",
  "apiKey": "sk-...",
  "model": "qwen-vl-max",
  "timeoutSeconds": 30,
  "enabled": true,
  "extras": {}
}
```

客户端归一化规则：

- `timeoutSeconds` 非正数或缺省 → 30；
- `enabled` 缺省 → `true`；
- `extras` 缺省 → `{}`；
- `baseUrl` 或 `apiKey` 为空 → `AI_CONFIG_NOT_FOUND`。

## 4. 本仓库实现

| 文件 | 职责 |
| --- | --- |
| `src/services/agentAiConfigApi.ts` | 取公钥、RSA-OAEP 加密、POST 换取配置、AES-256-GCM 解密、载荷校验；一次 `AI_CONFIG_DECRYPT_FAILED` 重取公钥重试 |
| `src/config/remoteAgentModelConfig.ts` | 主进程内存缓存（TTL 15 分钟）、单飞加载、失败摘要、登出清理 |
| `src/config/agentModelConfig.ts` | 远端配置与本地非敏感缺省值合并、功能开关、Fail-Fast |
| `electron/main.ts` | 启动/Token 同步后拉取、产品映射启动前强制就绪、异常诊断按快照降级、登出清理 |

### 4.1 生命周期

1. **应用启动**：`initNodePlatformTokens()` 恢复登录态；有可用 Token 时后台拉取配置，不阻塞窗口创建。
2. **Token 同步**：渲染进程 `syncDutyTokens` → `duty:sync-tokens`，可能来自首次登录、切换租户或自动续期。主进程按需加载（15 分钟内命中缓存不重复请求），避免把 60 秒级的 Token 续期放大成配置接口压力。
3. **Token 续期策略**：主进程不主动续期 Token（避免与渲染进程单飞刷新竞态）。Access Token 实际有效期仅 60 秒，持久化 Token 在启动时通常已过期，此时主进程不发请求，等渲染进程自动续期并同步后拉取；无需用户重新登录。
4. **使用前**：产品映射启动时 `ensureLoaded()`；缓存未过期直接返回，过期则等待重新拉取。
5. **异常诊断**：读取当前快照立即降级/调用；缓存过期或为空时后台刷新，不阻塞告警链路。
6. **登出**：`duty:clear-tokens` 清空缓存，防止上一租户密钥残留。

### 4.2 合并规则

| 字段 | 来源优先级 |
| --- | --- |
| 功能开关 | 本地环境变量开关 **AND** 远端 `enabled` |
| `baseUrl` | 只取远端（载荷解析已保证非空） |
| `apiKey` | **只取远端**，环境变量不参与 |
| `mappingModel` | `extras.mappingModel` > 远端 `model` > 环境变量缺省值 |
| `diagnosisModel` | `extras.diagnosisModel` > 远端 `model` > 环境变量缺省值 |
| `timeoutMs` | 只取远端 `timeoutSeconds × 1000`（载荷解析已保证缺省 30） |
| `maxConcurrency` | 环境变量（远端载荷不含该项） |

功能开启但合并后 `baseUrl` / `apiKey` / 对应任务模型缺失时立即报错，逐项列明缺失项，不回显密钥值。

### 4.3 错误处理

| 错误码 | 客户端行为 |
| --- | --- |
| `AI_CONFIG_DECRYPT_FAILED` | 按文档重取一次公钥后重试；仍失败则向上抛出 |
| `AI_CONFIG_NOT_FOUND` | 视为租户未配置；产品映射启动失败并返回可读原因；诊断退回确定性模板告警 |
| `AI_CONFIG_TENANT_REQUIRED` / 401 | Token 无效或缺少租户；等待重新登录后由 Token 变更触发刷新 |
| `AI_CONFIG_UNAVAILABLE` / 503 | 服务端配置未就绪；保留旧快照用于诊断，产品映射启动失败 |
| `TIMEOUT` / `NETWORK` | 与上同类；不自动重试，避免放大故障 |
| `PROTOCOL` | 响应结构、算法或 GCM 校验不匹配；记录安全摘要并降级 |

### 4.4 安全不变量

- AES 密钥每次请求生成，作用域限于单次调用栈。
- 日志只允许出现 `keyId`、`enabled`、错误码与安全摘要。
- 错误信息不回显响应体原文、`apiKey`、密文或 IV。
- 解密后的配置仅保存在主进程模块内存，登出即清空。
- Renderer 只通过既有 Agent IPC 使用能力，永远拿不到 `apiKey`。

## 5. 测试

- `tests/services/agentAiConfigApi.test.ts`：真实 RSA/AES 往返、公钥轮换重试、错误码、IV 校验、载荷归一化。
- `tests/config/agentModelConfig.test.ts`：extras 覆盖、严格远程密钥、远端禁用、Fail-Fast 与密钥不回显。
- `tests/config/remoteAgentModelConfig.test.ts`：TTL、单飞并发、强制刷新、失败摘要与登出清理。

## 6. 待确认（服务端联调时）

- 错误响应中业务错误码的确切字段名（客户端目前扫描 `error` / `errorCode` / `errCode` / `code` / `data.*`）。
- 网关地址是否需要在 `SMARTLINK_PLATFORM_BASE_URL` 中自带 `/toolkit`（当前按网关根地址 + 文档路径拼接）。
- 租户配置热更新频率与客户端 15 分钟 TTL 是否匹配。