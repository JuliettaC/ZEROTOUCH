export function createAdminController(service) {
  return {
    list: (req, res) => res.json(service.list(req.auth, req.query)),
    role: (req, res) => res.json({ data: service.update(req.auth, req.params.id, req.body, 'rol') }),
    status: (req, res) => res.json({ data: service.update(req.auth, req.params.id, req.body, 'estado') }),
  };
}
