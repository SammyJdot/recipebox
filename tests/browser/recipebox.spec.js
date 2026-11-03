import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

test("register, create, organize, search, scale, print and manage photos", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = randomBytes(5).toString("hex");
  const title = `Test recipe ${suffix}`;
  const boxName = `Test box ${suffix}`;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Display name").fill("Test Member");
  await page.getByLabel("Username").fill(`test-${suffix}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(randomBytes(20).toString("hex"));
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good things live here." }),
  ).toBeVisible();
  if (testInfo.project.name === "desktop")
    await expect(
      page.getByRole("heading", {
        name: "Your collection starts with one recipe.",
      }),
    ).toBeVisible();
  await page
    .getByRole("button", { name: "Create a box", exact: true })
    .first()
    .click();
  await page.getByLabel("Name", { exact: true }).fill(boxName);
  await page.getByRole("button", { name: "Save box" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("link", { name: "+ New recipe" }).click();
  await page.getByLabel("Recipe title").fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A recipe saved by the browser test.");
  await page.getByLabel("Servings", { exact: true }).fill("4");
  await page.getByLabel("Prep time").fill("10");
  await page.getByLabel("Ingredient 1 quantity").fill("1 1/2");
  await page.getByLabel("Ingredient 1 unit").fill("cups");
  await page.getByLabel("Ingredient 1 item").fill(`flour-${suffix}`);
  await page.getByRole("button", { name: "+ Add ingredient" }).click();
  await page.getByLabel("Ingredient 2 item").fill("salt");
  await page.getByRole("button", { name: "Move ingredient 2 up" }).click();
  await expect(page.getByLabel("Ingredient 1 item")).toHaveValue("salt");
  await page.getByRole("button", { name: "Remove ingredient 1" }).click();
  await page.getByLabel("Step 1", { exact: true }).fill("Mix and cook.");
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Step 2", { exact: true }).fill("Serve.");
  await page.getByRole("button", { name: "Move step 2 up" }).click();
  await page.getByRole("button", { name: "Move step 1 down" }).click();
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await expect(page.locator(".ingredient-quantity")).toContainText("3/4 cups");
  await page.getByRole("checkbox", { name: boxName, exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: boxName, exact: true }),
  ).toBeEnabled();
  const image = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#a0b88b" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Upload photo")
    .setInputFiles({ name: "test.png", mimeType: "image/png", buffer: image });
  await expect(page.getByText("Cover photo", { exact: true })).toBeVisible();
  await page
    .getByLabel("Upload photo")
    .setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: image,
    });
  await page.getByRole("button", { name: "Make cover" }).click();
  await expect(
    page
      .locator(".photo-card")
      .nth(1)
      .getByText("Cover photo", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cover-photo")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".site-header")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ingredients", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit recipe" }),
  ).not.toBeVisible();
  await expect(page.locator(".ingredient-quantity")).toContainText("3/4 cups");
  await page.emulateMedia({ media: "screen" });
  if (testInfo.project.name === "desktop")
    await page.pdf({
      path: testInfo.outputPath("recipe-print.pdf"),
      format: "A4",
    });
  await page.screenshot({
    path: testInfo.outputPath("recipe-view.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete photo" }).nth(1).click();
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.getByRole("link", { name: "Edit recipe", exact: true }).click();
  await page.getByLabel("Recipe title").fill(`${title} edited`);
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `${title} edited`, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← All recipes" }).click();
  await page.getByRole("button", { name: new RegExp(boxName) }).click();
  await page
    .getByLabel("Search by title or ingredient")
    .fill(`flour-${suffix}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `${title} edited`, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("collection.png"),
    fullPage: true,
  });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
  await page.getByRole("link", { name: new RegExp(title) }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete recipe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good things live here." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
