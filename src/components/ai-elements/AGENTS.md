# ai-elements 约束

- ai-elements 文件 MUST NOT import `@/store/*`、`@/services/*`、`@/composables/*`。
- ai-elements 文件 MUST NOT 包含任何 provider 特定逻辑，包括定价、tokenizer、SDK 名。
