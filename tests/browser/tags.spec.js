import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
test("optional comma-separated tags save, normalize, render, search, click-filter, edit and clear", async ({
  page,
  baseURL,
}) => {
  const tag = randomBytes(8).toString("hex"),
    other = randomBytes(8).toString("hex");
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
  const csrf = (await response.json()).csrf_token;
  await page.goto("/recipes/new");
  await page.getByLabel("Recipe title", { exact: true }).fill("Tagged recipe");
  await page
    .getByLabel("Tags (optional, comma-separated)", { exact: true })
    .fill(` ${tag.toUpperCase()}, ${tag}, , ${other}`);
  await page.getByLabel("Ingredient 1 item", { exact: true }).fill("flour");
  await page.getByLabel("Step 1", { exact: true }).fill("Mix.");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tagged recipe", exact: true }),
  ).toBeVisible();
  const recipePath = new URL(page.url()).pathname;
  await expect(
    page.getByRole("navigation", { name: "Recipe tags" }).getByRole("link"),
  ).toHaveCount(2);
  const titleOnly = await page.request.post("/api/recipes", {
    headers: { Origin: baseURL, "X-CSRF-Token": csrf },
    data: {
      title: tag,
      ingredients: [{ item: "water" }],
      steps: [{ text: "Mix." }],
    },
  });
  expect(titleOnly.status()).toBe(201);
  const extra = await titleOnly.json();
  await page
    .getByRole("navigation", { name: "Recipe tags" })
    .getByRole("link", { name: tag, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("tag=" + tag));
  await expect(page.locator(".recipe-card")).toHaveCount(1);
  await expect(page.locator(".recipe-card .tag")).toHaveText([tag, other]);
  await expect(
    page.getByRole("heading", { name: "Tagged recipe", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear tag filter", exact: true })
    .click();
  await page
    .getByLabel("Search by title, ingredient, or tag")
    .fill(other.toUpperCase());
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".recipe-card")).toHaveCount(1);
  await page.locator(".recipe-card").click();
  await page.getByRole("link", { name: "Edit recipe", exact: true }).click();
  await expect(
    page.getByLabel("Tags (optional, comma-separated)", { exact: true }),
  ).toHaveValue(`${tag}, ${other}`);
  await page
    .getByLabel("Tags (optional, comma-separated)", { exact: true })
    .fill("");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Recipe tags" }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.delete(
        recipePath.replace("/recipes/", "/api/recipes/"),
        { headers: { Origin: baseURL, "X-CSRF-Token": csrf } },
      )
    ).status(),
  ).toBe(204);
  expect(
    (
      await page.request.delete(`/api/recipes/${extra.id}`, {
        headers: { Origin: baseURL, "X-CSRF-Token": csrf },
      })
    ).status(),
  ).toBe(204);
});
