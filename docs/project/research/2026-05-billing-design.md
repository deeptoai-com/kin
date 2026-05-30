# 计费设计 + usage 验证存档

> 日期：2026-05-31 · 作者：agent · 状态：已验证，设计已定调

## 1. usage 数据验证（真实跑 Ark 得到，非推测）

对 `ark-code-latest` 跑了一次真实 `query()`，SDK 的 `result` 事件返回：

```json
{
  "type": "result", "subtype": "success",
  "num_turns": 1,
  "total_cost_usd": 0.044149,
  "usage": { "input_tokens": 14067, "output_tokens": 4,
             "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0 },
  "modelUsage": {
    "claude-haiku-4-5-20251001": { "inputTokens": 1378, "outputTokens": 102, "costUSD": 0.001888 },
    "ark-code-latest":           { "inputTokens": 14067, "outputTokens": 4, "costUSD": 0.042261 }
  }
}
```

**结论：token 计量数据齐全，方案 B（按 token 计费）可行。**

## 2. 关键辨析：cost 是谁算的？

- **token 数 = 字节 API 真实返回**，客观可信。
- **`total_cost_usd` / `costUSD` = Claude Code SDK 本地按内置 Anthropic 散单价估算**，不是字节返回，与真实支出无关（SDK 把成本算到 `claude-haiku-4-5` 等 Anthropic 模型名上，它不知道我们走字节包月）。
- **当前成本结构：字节 Code plan ¥200/月固定**（额度未知，目前用量很少，后续测出来再估）。真实边际成本 ≈ 0。**所以 SDK 的美元 cost 对我们是「假成本」，不能作计费依据，仅作内部参考。**

## 3. 计费策略定调

1. **计量基础 = token 数**（字节真实返回），不是 SDK 美元成本。
2. **credit 首要作用 = 公平使用配额**（防个别用户吃爆 ¥200 包月额度），而非精确成本转嫁。
3. **换算率 `1 credit = N tokens` 可配置、可按模型，现在不拍死**——先攒真实用量，反推 ¥200 ≈ 多少 token ≈ 多少次正常 run，再校准。
4. 换算率是配置（env/配置文件），改值即调价，不发版。
5. 升级路径：先「观测落库」（不收钱）→ 攒 1–2 周数据 → 定换算率 → 接配额/计费。

## 4. 与现有计费栈的关系（已核实）

starter 自带完整计费栈，无需重造：
- `src/server/credits.ts`：`spendOneCredit()` 完整可用，但**从未被调用**；同文件有 `ensureDailyRefill` / `addPurchasedCredits` / `resetMonthlyAllotment`。
- `src/db/schema/billing.schema.ts`：`plans / subscriptions / creditBalances / creditLedger(含 meta JSONB) / invoices` 全有。
- Polar webhooks、每日补额已就绪；D4 日志脱敏已完成。
- **缺口**：计量未接线、token/cost 未落库、无 audit 表。

## 5. 参考：Qoder 计费（2026-05 实测）

社区 $0(300 credits 试用) / Pro $20(2,000) / Pro+ $60(6,000) / Ultra $200(20,000)，线性 ≈ $0.01/credit。对用户暴露 credit、隐藏 token。我们采同样两层结构。
