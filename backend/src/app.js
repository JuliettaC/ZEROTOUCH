import express from "express";
import healthRoutes from "./routes/healthRoutes.js";

import { createRepository } from "./repositories/resources.js";
import { createService } from "./services/resources.js";
import { createController } from "./controllers/resourceController.js";
import { resourceRoutes } from "./routes/resourceRoutes.js";
import { ApiError, errorHandler } from "./middleware/errors.js";

export function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (["POST", "PATCH"].includes(req.method) && !req.is("application/json"))
      return next(
        new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Utiliza Content-Type: application/json.",
        ),
      );
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", healthRoutes);
  const profiles = createRepository(db, "profiles");
  for (const kind of ["profiles", "contexts"]) {
    const repository =
      kind === "profiles" ? profiles : createRepository(db, kind);
    const basePath = `/api/v1/${kind}`;
    app.use(
      basePath,
      resourceRoutes(
        createController(createService(kind, repository, profiles), basePath),
      ),
    );
  }
  app.use((req, res, next) =>
    next(new ApiError(404, "ROUTE_NOT_FOUND", "Ruta o método no disponible.")),
  );
  app.use(errorHandler);
  return app;
}
