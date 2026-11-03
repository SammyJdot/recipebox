import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
async function register(page, baseURL) {
  const config = await page.request.get("/auth/config");
  const response = await page.request.post("/auth/register", {
    headers: {
      Origin: baseURL,
      "X-CSRF-Token": (await config.json()).csrf_token,
    },
    data: {
      username: "test-" + randomBytes(6).toString("hex"),
      display_name: "Test Member",
      password: randomBytes(20).toString("hex"),
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).csrf_token;
}

test("servings spinner regression: 4 -> 5 -> 6 -> 5 -> 4 and exact quantity ratios", async ({
  page,
  baseURL,
}, testInfo) => {
  const token = await register(page, baseURL);
  const response = await page.request.post("/api/recipes", {
    headers: { Origin: baseURL, "X-CSRF-Token": token },
    data: {
      title: "Scaler regression",
      servings: 4,
      ingredients: [
        { quantity: "1", unit: "cup", item: "flour" },
        { quantity: "1 1/2", unit: "cups", item: "water" },
      ],
      steps: [{ text: "Mix." }],
    },
  });
  expect(response.status()).toBe(201);
  const recipe = await response.json();
  await page.goto(`/recipes/${recipe.id}`);
  const input = page.getByLabel("Servings", { exact: true });
  await expect(input).toHaveValue("4");
  await expect(input).toHaveAttribute("min", "1");
  await expect(input).toHaveAttribute("step", "1");
  const steps = [
    ["ArrowUp", "5", "1 1/4 cup", "1 7/8 cups"],
    ["ArrowUp", "6", "1 1/2 cup", "2 1/4 cups"],
    ["ArrowDown", "5", "1 1/4 cup", "1 7/8 cups"],
    ["ArrowDown", "4", "1 cup", "1 1/2 cups"],
  ];
  for (const [key, value, first, second] of steps) {
    if (testInfo.project.name === "firefox-scaler") {
      const bounds = await input.boundingBox();
      await input.click({
        position: {
          x: bounds.width - 20,
          y: bounds.height / 2 + (key === "ArrowUp" ? -5 : 5),
        },
      });
    } else await input.press(key);
    await expect(input).toHaveValue(value);
    await expect(page.locator(".ingredient-quantity").nth(0)).toHaveText(first);
    await expect(page.locator(".ingredient-quantity").nth(1)).toHaveText(
      second,
    );
  }
  for (let i = 0; i < 25; i++) {
    await input.press("ArrowUp");
    await input.press("ArrowDown");
  }
  await expect(input).toHaveValue("4");
  await input.fill("1");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("1");
  expect((await page.request.get(`/api/recipes/${recipe.id}`)).status()).toBe(
    200,
  );
  expect(
    (await (await page.request.get(`/api/recipes/${recipe.id}`)).json())
      .servings,
  ).toBe(4);
  expect(
    (
      await page.request.delete(`/api/recipes/${recipe.id}`, {
        headers: { Origin: baseURL, "X-CSRF-Token": token },
      })
    ).status(),
  ).toBe(204);
});

test("new recipe servings are blank and optional; no-base quantities stay verbatim until servings are supplied", async ({
  page,
  baseURL,
}) => {
  await register(page, baseURL);
  await page.goto("/recipes/new");
  await expect(page.getByLabel("Servings", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Servings", { exact: true }),
  ).not.toHaveAttribute("required");
  await expect(
    page.getByLabel("Tags (optional, comma-separated)", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Recipe title", { exact: true })
    .fill("Optional servings");
  await page.getByLabel("Ingredient 1 quantity", { exact: true }).fill("1.50");
  await page.getByLabel("Ingredient 1 unit", { exact: true }).fill("cups");
  await page.getByLabel("Ingredient 1 item", { exact: true }).fill("flour");
  await page.getByLabel("Step 1", { exact: true }).fill("Mix.");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Optional servings", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Servings", { exact: true })).toHaveCount(0);
  await expect(page.locator(".ingredient-quantity")).toHaveText("1.50 cups");
  await page.getByRole("link", { name: "Edit recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edit recipe", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Servings", { exact: true })).toHaveValue("");
  await page.getByLabel("Servings", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Optional servings", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Servings", { exact: true })).toHaveValue("4");
  await page.getByLabel("Servings", { exact: true }).press("ArrowUp");
  await expect(page.getByLabel("Servings", { exact: true })).toHaveValue("5");
  await expect(page.locator(".ingredient-quantity")).toHaveText("1 7/8 cups");
  await page.getByRole("link", { name: "Edit recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edit recipe", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Servings", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByLabel("Servings", { exact: true })).toHaveCount(0);
  await expect(page.locator(".ingredient-quantity")).toHaveText("1.50 cups");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete recipe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recipes", exact: true }),
  ).toBeVisible();
});
