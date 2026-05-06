import { expect, test } from '@playwright/test';

test('启动后直接进入工作台，不再经过旧启动过渡层', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('workbench-root')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('startup-veil')).toHaveCount(0);
});
