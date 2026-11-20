export function createCatalogosController(serviceFor) {
  return {
    gestures: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).gestures() }),
    actions: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).actions() }),
    capabilities: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).capabilities() }),
    effective: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).effective(req.params.id) }),
    replace: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).replace(req.params.id, req.body) }),
    patchOne: (req, res) => res.json({ data: serviceFor(req.auth.usuarioId).patchOne(req.params.id, req.params.gesto, req.body) }),
  };
}
