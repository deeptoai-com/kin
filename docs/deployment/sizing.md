# Kin 系统要求与云服务器选型（Sizing）

> 适用：自托管 Kin（单组织、多用户的 Claude-Agent 工作台）。
> 结论先行：**无需 GPU，8 GB 起步，16 GB 舒适；普通 Linux VM 即可，arm64 更省。**

---

## 1. 为什么要求不高（先打消两个误解）

1. **不在本地跑大模型。** Agent 的"思考"是调**远程 ARK 网关**（Anthropic 兼容）的 API，本机只做编排 + Web + 工具执行。**没有 GPU 需求，没有本地推理显存/内存**。Kin 是一个 Web 应用 + Docker 编排器，不是推理服务器。
2. **用户只拉镜像，不构建。** 多架构镜像发布后（`ghcr.io/deeptoai-com/kin/{app,parser}` 含 amd64+arm64），部署是 `docker compose pull`，**不在目标机构建**。所以历史上"SSR 构建峰值 >8 GB"的门槛**对终端用户不再适用**——配置只看**运行时**，不看构建。

---

## 2. 运行时内存账（实测依据）

| 部分 | 内存 | 说明 |
|---|---|---|
| Linux 宿主 OS | ~0.5–1 GB | 同样 RAM 的 Linux VM 比 Mac（OS 占 3–4 GB）更宽裕 |
| 空载栈 | ~2–3 GB | pg(pgvector)+redis+minio+meili+app+worker+preview-controller+traefik+cloudflared+parser |
| 每个活跃 Agent 会话 | ~0.3–0.5 GB | 每会话起 `ws-query-worker` 子进程 + SDK CLI + bubblewrap 代码沙盒 |
| 每个预览沙盒 | ≤768 MB | 硬上限 `PREVIEW_MEMORY=768m`、1 CPU、256 PID（`docker-compose.tunnel.yml`） |

> ⚠️ **核心服务目前没有内存上限**（`mem_limit` 未设；README「Scale & limits」：尚无并发上限，重负载下有 OOM 风险）。所以"最小"配置成立的前提是**轻并发**。

---

## 3. 配置档位

| | 最小（单人 / 2–3 轻度用户） | 推荐（小团队 + 若干预览） | 目标（~50 并发，README 在建） |
|---|---|---|---|
| **RAM** | **8 GB** | **16 GB** | 16 GB |
| **vCPU** | 2（4 更稳） | 4 | 8 |
| **磁盘** | 40 GB SSD/NVMe | 80 GB | 80–160 GB |
| **GPU** | 无需 | 无需 | 无需 |
| **网络** | 能出网到 ARK 网关 + GHCR + Cloudflare | 同 | 同 |

- **4 GB 跑不动默认全栈**：空载 2–3 GB + OS 后余量太薄，一个会话 + 一个预览就 OOM。要 4 GB 单人，必须走 §6 精简档。
- **8 GB 是默认全栈地板**：空载栈 + 1–2 活跃会话 + 1 预览。轻度自用/小团队够用。
- **CPU**：多为空闲；**代码执行 + 预览 Vite 构建是 CPU 爆发**，并发靠核数。SSR 运行期不构建（镜像预构建），不吃 CPU。
- **磁盘**：app 镜像 ~4 GB + parser ~0.5 GB + 第三方基础镜像 ~1.5 GB + 预览基础镜像 + 数据卷（Postgres / MinIO 文档 / Meili 索引 / 会话）随用量涨。要 SSD/NVMe（Postgres + Meili 吃随机 IO）。

---

## 4. 云服务器选型

**硬约束**（决定了不能用 serverless/托管容器）：挂 Docker socket（预览控制器起兄弟容器）+ 非特权用户命名空间/bubblewrap（代码沙盒）+ 6 个有状态卷。→ **必须是普通 Linux VM。** arm64 VM 能直接复用 arm64 镜像，且便宜 15–20%。

| 档位 | 自建/最省（首选） | AWS | GCP | 其它 |
|---|---|---|---|---|
| **最小 8 GB** | **Hetzner CAX21**（arm64 4c/8G/80G **≈€8/mo**） | EC2 **t4g.large**（arm64 2c/8G ≈$49/mo，1yr 承诺 ~$30）+EBS | GCE **t2a/e2-standard-2**（2c/8G，纯 Ubuntu） | DO 8G/2c ≈$48（仅 x86） |
| **推荐 16 GB** | **Hetzner CAX31**（arm64 8c/16G/160G **≈€16/mo**） | EC2 **t4g.xlarge**（4c/16G ≈$98，承诺 ~$70）+EBS | GCE **c4a/t2a-standard-4**（**别用 COS**） | DO 16G ≈$84 |

> 价格为 2026 年约数，按需价；承诺/预留可再省 30–40%。

**避开（架构上跑不起来，非价格问题）**：Cloud Run / Fargate / App Runner / Lightsail-container / GKE-Autopilot / Container-Optimized OS / Fly（作主机）——都禁 socket / 禁特权 / 无持久卷。
**GCP 专坑**：用 GCE **纯 Ubuntu**，**不要用 COS**（只读 rootfs，装不了 bubblewrap、改不了 userns sysctl）。

---

## 5. 三个实操注意

1. **加 swap**：因目前无并发上限，小内存机给 4 GB swap（`scripts/add-swap.sh` 已有）能扛爆发、避免直接 OOM —— 8 GB 机尤其建议。
2. **磁盘 SSD/NVMe**：别用机械盘 / 最低档块存储。
3. **arm64 优先**：Hetzner CAX / EC2 Graviton / GCE Axion 都是 arm64，复用同一镜像、更便宜，VPS 和 Mac 一鱼两吃。

---

## 6. 精简档（把单人地板压到 4–6 GB）：砍 MinIO / Meili 的优缺点

目标：单人/极轻量场景，去掉两个相对重的有状态服务。**两者代价差别很大**，分开说。

### 6.1 砍 Meili（搜索）—— **最便宜的一刀，可零代码**

- **Meili 在 Kin 里只有一个活跃用途**：RAG 混合检索的 **BM25 关键词腿**（`kb_search`）。语义腿在 **Postgres pgvector**，不依赖 Meili。其余 Meili 面（`documents` 索引、`/api/search`、`reindex-all`）都是**死代码/无前端调用**；`⌘K` 会话搜索是**纯前端**，也不用 Meili。
- **现状已优雅降级**：Meili 挂掉时检索自动回退到**纯向量**（`src/server/rag/search.ts` 有 `bm25Degraded` 兜底），入库也不会因 Meili 失败而失败。**RAG 默认是关的**（`RAG_ENABLED` 未设）。

| | 优点 | 缺点 |
|---|---|---|
| **直接不启动 Meili**（compose profile，**零代码**） | 省 ~100–300 MB RAM + 一个容器；RAG 关时**完全无影响**；RAG 开时自动降级不崩 | RAG 开启时**丢关键词召回腿** —— 对"精确词/条款号"类查询召回下降（团队实测 BM25 把条款号题 R@1 从 75%→100%，砍了就退回去） |
| **换成 Postgres FTS**（**要写代码**） | 省下 Meili 同时**保住关键词召回**，少一个服务 | 仓库**目前没有任何 FTS 脚手架**（无 tsvector/pg_trgm）。要加迁移（生成列 + GIN 索引）+ 重写 `searchChunks()`。**真正的难点是中文分词**（法律/财务中文文档；PG 默认配置切 CJK 很差，需 `pg_trgm` 或 `pg_jieba/zhparser`）。范围约 2 文件 + 1 迁移，但非琐碎 |

**建议**：精简档 / RAG 不开 → **直接不启动 Meili（零代码）**。若 RAG 是核心且要省 Meili → 排一个"BM25 腿换 PG FTS"的小任务（重点先定中文分词方案）。

### 6.2 砍 MinIO（对象存储）→ 本地 FS —— **要一点代码，但很小**

- **存了什么**：用户上传的文档 / RAG 入库源文件 / OCR 源 PDF（key 记在 Postgres，字节在桶里）。
- **已有干净抽象**：所有对象存储走单一接口 `IFileService`（`src/server/s3/`），唯一实现是 `S3StaticFileImpl`。换存储**不动任何调用点**，只需加一个本地 FS 实现 + 工厂开关。
- **生产本就代理字节**：隧道生产 `USE_PRESIGNED_UPLOAD` 是关的（MinIO 不对浏览器可达），上传/下载**已经走 Node 代理**。所以本地 FS 驱动（预签名返回 null、字节走 app 代理）对**生产路径零行为变化**。

| | 优点 | 缺点 |
|---|---|---|
| **MinIO → 本地 FS** | 省 ~100–200 MB RAM + 两个容器（minio + provision-minio）；少一套密钥/桶配置；本地 IO 更快；备份就是 tar 一个卷 | **要写代码**：加 `@flystorage/local-fs` 驱动（~1 文件）+ 工厂按 `STORAGE_DRIVER` 切换 + 把现在**硬必填**的 `S3_BUCKET` 放开（否则 `S3StaticFileImpl` 构造即抛、起不来）。失去 S3 兼容（以后想接云 S3/R2 要再加回）；预签名直传不可用（但生产本就不用）；字节代理走 Node = 大文件上传/下载多占一点 app 内存/CPU |

> **不能"只是不启动 MinIO"**：`S3_BUCKET` 必填且上传/RAG/OCR 都依赖存储——不接本地 FS 驱动就会崩。要么上本地 FS 驱动，要么指向外部 S3/R2。

### 6.3 精简档能省多少

| 砍法 | 省 RAM | 代价 | 工作量 |
|---|---|---|---|
| 不启动 Meili | ~100–300 MB | RAG 关键词召回腿（RAG 关时无感） | 零代码（compose profile） |
| MinIO → 本地 FS | ~100–200 MB | 失去 S3 兼容/预签名直传 | 小（1 驱动 + 工厂 + 放开 S3_BUCKET） |
| **合计** | **~0.3–0.5 GB + 2~3 个容器** | 单人/轻量可接受 | 一个小任务 |

配合 `mem_limit` 和不开预览，**单人精简档可压到 ~4–6 GB**。建议做成 `--profile minimal`（默认全栈不变，精简档可选）。

---

## 7. 一句话推荐

- **自建/省钱**：Hetzner **CAX21（最小）/ CAX31（推荐）**，arm64，€8/€16，性价比最高。
- **要 AWS**：EC2 Graviton **t4g.large / t4g.xlarge**。
- **要 GCP**：GCE 纯 Ubuntu arm（C4A/T2A），**不用 COS**。
- **底线**：8 GB / 2–4 vCPU / 40 GB SSD 普通 Linux VM，无需 GPU。单人极轻量可走 §6 精简档压到 4–6 GB。
