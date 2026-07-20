import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The UI copy is Turkish; these selectors track the live pages under
// apps/web/app. Public tests need only the web server. The authenticated
// critical-path suite additionally needs the API + Postgres reachable and
// self-skips when the API health check fails (see the beforeAll below).

const API_URL = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3001";

// -------------------------------------------------------------------------
// Public pages — no backend auth required.
// -------------------------------------------------------------------------
test.describe("public pages", () => {
  test("landing page renders with auth entry points", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Piyasayı Tara/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Giriş" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Kayıt Ol" }).first()).toBeVisible();
  });

  test("pricing page renders the three plans", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Basic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Premium" })).toBeVisible();
  });

  test("login page renders the Turkish form", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Tekrar hoş geldin" }),
    ).toBeVisible();
    await expect(page.getByLabel("E-posta")).toBeVisible();
    await expect(page.getByLabel("Şifre")).toBeVisible();
    await expect(page.getByRole("button", { name: "Giriş Yap" })).toBeVisible();
  });

  test("register page renders the Turkish form", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: "Hesabını oluştur" }),
    ).toBeVisible();
    await expect(page.getByLabel("E-posta")).toBeVisible();
    await expect(page.getByLabel("Şifre")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ücretsiz Başla" }),
    ).toBeVisible();
  });

  test("unauthenticated dashboard redirects to login", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await context.close();
  });
});

// -------------------------------------------------------------------------
// Authenticated critical paths — need the full stack (web + API + Postgres).
// The suite registers a throwaway user each run so it does not depend on any
// pre-seeded account. It self-skips when the API is unreachable.
// -------------------------------------------------------------------------
async function apiReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${API_URL}/health`, { timeout: 3000 });
    return res.ok();
  } catch {
    return false;
  }
}

async function registerFreshUser(page: Page): Promise<void> {
  const email = `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}@apexscan.dev`;
  await page.goto("/register");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2ePassw0rd!");
  await page.getByRole("button", { name: "Ücretsiz Başla" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test.describe("authenticated critical paths", () => {
  // beforeEach (not beforeAll) is what Playwright honours for conditional skips.
  test.beforeEach(async ({ request }) => {
    test.skip(
      !(await apiReachable(request)),
      `API not reachable at ${API_URL}; skipping full-stack flows`,
    );
  });

  test("invalid login surfaces the Turkish error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-posta").fill(`nobody+${Date.now()}@example.com`);
    await page.getByLabel("Şifre").fill("wrong-password");
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(
      page.getByText("Giriş başarısız. Bilgilerinizi kontrol edin."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("register then land on the dashboard", async ({ page }) => {
    await registerFreshUser(page);
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("scanner page renders after auth", async ({ page }) => {
    await registerFreshUser(page);
    await page.goto("/scanner");
    await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible();
  });

  test("models page renders after auth", async ({ page }) => {
    await registerFreshUser(page);
    await page.goto("/models");
    await expect(page.getByRole("heading", { name: "Modeller" })).toBeVisible();
  });

  test("signals page renders after auth", async ({ page }) => {
    await registerFreshUser(page);
    await page.goto("/signals");
    await expect(
      page.getByRole("heading", { name: "AI Signals" }),
    ).toBeVisible();
  });

  test("simulation page is reachable after auth", async ({ page }) => {
    await registerFreshUser(page);
    await page.goto("/simulation");
    await expect(page).toHaveURL(/\/simulation$/);
  });
});
