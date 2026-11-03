import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  validate,
  recipeSchema,
  boxSchema,
  coverSchema,
  linkSchema,
  id,
  HttpError,
} from "./validation.js";

export function apiRouter(config, data, audit, log) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (req, file, cb) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
        ? cb(null, true)
        : cb(new HttpError(400, "Use a JPEG, PNG, or WebP photo")),
  });
  const recipe = (value) => {
    const r = data.recipe(id(value));
    if (!r) throw new HttpError(404, "Recipe not found");
    return r;
  };
  const box = (value) => {
    const b = data.box(id(value));
    if (!b) throw new HttpError(404, "Box not found");
    return b;
  };
  const author = (req, r) => {
    if (r.author_id !== req.user.id)
      throw new HttpError(403, "Only the recipe author can change this recipe");
  };
  const creator = (req, b) => {
    if (b.creator_id !== req.user.id)
      throw new HttpError(403, "Only the box creator can change this box");
  };
  const deleteFiles = async (filenames, req) => {
    const results = await Promise.allSettled(
      filenames.flatMap((name) => [
        rm(join(config.dataDir, "uploads", name), { force: true }),
        rm(join(config.dataDir, "uploads", `${name}.thumb.webp`), {
          force: true,
        }),
      ]),
    );
    if (results.some((r) => r.status === "rejected"))
      log("error", "photo.cleanup_failed", {
        request_id: req.requestId,
        user_id: req.user.id,
      });
  };
  router.get("/me", (req, res) => res.json(req.user));
  router.get("/recipes", (req, res) => {
    if (
      req.query.q !== undefined &&
      (typeof req.query.q !== "string" || req.query.q.length > 200)
    )
      throw new HttpError(400, "Search must be at most 200 characters");
    const boxId = req.query.box_id ? id(req.query.box_id) : null;
    res.json(data.recipes(req.query.q || "", boxId));
  });
  router.post("/recipes", (req, res) => {
    const input = validate(recipeSchema, req.body);
    const recipeId = audit(
      req,
      "recipe.created",
      "recipe",
      (value) => value,
      "Recipe created",
      () => data.createRecipe(input, req.user.id),
    );
    res.status(201).json(data.recipe(recipeId));
  });
  router.get("/recipes/:id", (req, res) => res.json(recipe(req.params.id)));
  router.put("/recipes/:id", (req, res) => {
    const r = recipe(req.params.id);
    author(req, r);
    if (Object.hasOwn(req.body || {}, "cover_photo_id")) {
      const input = validate(coverSchema, req.body);
      if (!r.photos.some((p) => p.id === input.cover_photo_id))
        throw new HttpError(400, "Cover photo must belong to this recipe");
      audit(req, "recipe.updated", "recipe", r.id, "Cover photo selected", () =>
        data.cover(r.id, input.cover_photo_id),
      );
    } else {
      const input = validate(recipeSchema, req.body);
      audit(req, "recipe.updated", "recipe", r.id, "Recipe updated", () =>
        data.updateRecipe(r.id, input),
      );
    }
    res.json(data.recipe(r.id));
  });
  router.delete("/recipes/:id", async (req, res) => {
    const r = recipe(req.params.id);
    author(req, r);
    // Cascaded photo deletions receive their own audit events in the same transaction.
    audit(req, "recipe.deleted", "recipe", r.id, "Recipe deleted", (record) => {
      r.photos.forEach((p) =>
        record("photo.deleted", "photo", p.id, "Deleted with recipe"),
      );
      data.deleteRecipe(r.id);
    });
    await deleteFiles(
      r.photos.map((p) => p.stored_filename),
      req,
    );
    res.status(204).end();
  });
  router.get("/boxes", (req, res) => res.json(data.boxes()));
  router.post("/boxes", (req, res) => {
    const input = validate(boxSchema, req.body);
    const boxId = audit(
      req,
      "box.created",
      "box",
      (value) => value,
      "Box created",
      () => data.createBox(input, req.user.id),
    );
    res.status(201).json(data.box(boxId));
  });
  router.put("/boxes/:id", (req, res) => {
    const b = box(req.params.id);
    creator(req, b);
    const input = validate(boxSchema, req.body);
    audit(
      req,
      "box.renamed",
      "box",
      b.id,
      "Box name or description updated",
      () => data.updateBox(b.id, input),
    );
    res.json(data.box(b.id));
  });
  router.delete("/boxes/:id", (req, res) => {
    const b = box(req.params.id);
    creator(req, b);
    audit(
      req,
      "box.deleted",
      "box",
      b.id,
      "Box deleted; recipes retained",
      () => data.deleteBox(b.id),
    );
    res.status(204).end();
  });
  router.post("/boxes/:id/recipes", (req, res) => {
    const b = box(req.params.id);
    const input = validate(linkSchema, req.body);
    const r = recipe(input.recipe_id);
    if (!data.hasRecipeBox(b.id, r.id))
      audit(
        req,
        "recipe.box_added",
        "recipe",
        r.id,
        `Added to box ${b.id}`,
        () => data.addRecipeBox(b.id, r.id),
      );
    res.status(204).end();
  });
  router.delete("/boxes/:id/recipes/:recipeId", (req, res) => {
    const b = box(req.params.id);
    const r = recipe(req.params.recipeId);
    if (data.hasRecipeBox(b.id, r.id))
      audit(
        req,
        "recipe.box_removed",
        "recipe",
        r.id,
        `Removed from box ${b.id}`,
        () => data.removeRecipeBox(b.id, r.id),
      );
    res.status(204).end();
  });
  router.post(
    "/recipes/:id/photos",
    (req, res, next) => {
      try {
        const r = recipe(req.params.id);
        author(req, r);
        req.recipe = r;
        next();
      } catch (e) {
        next(e);
      }
    },
    upload.single("photo"),
    async (req, res) => {
      if (!req.file)
        throw new HttpError(
          400,
          "Choose a JPEG, PNG, or WebP photo (10 MB maximum)",
        );
      if (req.recipe.photos.length >= 30)
        throw new HttpError(400, "Maximum 30 photos per recipe");
      const filename = `${randomUUID()}.webp`;
      let full, thumb;
      try {
        const image = sharp(req.file.buffer, {
          limitInputPixels: 40_000_000,
          animated: false,
        });
        const meta = await image.metadata();
        if (
          !["jpeg", "png", "webp"].includes(meta.format) ||
          (meta.pages || 1) > 1
        )
          throw new Error("Unsupported image");
        full = await image
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
        thumb = await sharp(full)
          .resize({
            width: 480,
            height: 360,
            fit: "cover",
            withoutEnlargement: true,
          })
          .webp({ quality: 75 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "Invalid photo. Use a JPEG, PNG, or WebP up to 40 megapixels.",
        );
      }
      try {
        await writeFile(join(config.dataDir, "uploads", filename), full, {
          flag: "wx",
        });
        await writeFile(
          join(config.dataDir, "uploads", `${filename}.thumb.webp`),
          thumb,
          { flag: "wx" },
        );
        const original = basename(req.file.originalname.replace(/\\/g, "/"))
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 180);
        const photoId = audit(
          req,
          "photo.uploaded",
          "photo",
          (value) => value,
          `Uploaded to recipe ${req.recipe.id}`,
          () =>
            data.createPhoto(req.recipe.id, filename, original, req.user.id),
        );
        res.status(201).json(data.photo(photoId));
      } catch (e) {
        await deleteFiles([filename], req);
        throw e;
      }
    },
  );
  router.delete("/photos/:photoId", async (req, res) => {
    const p = data.photo(id(req.params.photoId));
    if (!p) throw new HttpError(404, "Photo not found");
    author(req, recipe(p.recipe_id));
    audit(
      req,
      "photo.deleted",
      "photo",
      p.id,
      `Deleted from recipe ${p.recipe_id}`,
      () => data.deletePhoto(p.id),
    );
    await deleteFiles([p.stored_filename], req);
    res.status(204).end();
  });
  return router;
}
