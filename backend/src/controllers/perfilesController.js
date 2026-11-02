export function createPerfilesController(serviceFor) {
  const service = req => serviceFor(req.auth.usuarioId);
  return {
    list: (req, res) => res.json(service(req).list(req.query)),
    get: (req, res) => res.json({ data: service(req).get(req.params.id) }),
    create(req, res) { const data = service(req).create(req.body); res.location(`/api/v1/perfiles/${data.id}`).status(201).json({ data }); },
    update: (req, res) => res.json({ data: service(req).update(req.params.id, req.body) }),
    delete(req, res) { service(req).delete(req.params.id); res.status(204).end(); },
  };
}
