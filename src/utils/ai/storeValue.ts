/**
 * 解包「裸值」或「带 .value 的 store 字段」。
 *
 * agentPlan / agentNetwork 的 store 字段可能是普通值，也可能是 ref，
 * 这里统一读出底层值，避免在各处重复判断。
 */
export const readStoreValue = <T>(value: T | { value: T }): T => {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return value.value;
  }

  return value;
};
