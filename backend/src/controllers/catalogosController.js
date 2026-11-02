export function createCatalogosController(serviceFor) {
  return {
    gestures: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).gestures() }),
    actions: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).actions() }),
    effective: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).effective(req.params.id) }),
  };
}
