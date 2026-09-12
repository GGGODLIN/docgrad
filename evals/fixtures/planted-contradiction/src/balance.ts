// 結算：回傳正數代表 memberB 欠 memberA（與 docs/balance-design.md 的敘述相反）。
export function settle(paidByA: number, paidByB: number): number {
  return paidByA - paidByB;
}
