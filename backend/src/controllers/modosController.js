export function createModosController(serviceFor) {
  const service = req => serviceFor(req.auth.usuarioId);
  return {
    list: (req, res) => res.json(service(req).list(req.params.id, req.query)),
    get(req, res) { const svc = service(req), data = svc.get(req.params.id); res.set('ETag', svc.etag(data)).json({ data }); },
    create(req, res) {
      const { data, replayed } = service(req).create(req.params.id, req.body, req.headers['idempotency-key']);
      if (replayed) res.set('Idempotent-Replayed', 'true');
      res.location(`/api/v1/modos/${data.id}`).status(201).json({ data });
    },
    update: (req, res) => res.json({ data: service(req).update(req.params.id, req.body) }),
    delete(req, res) { service(req).delete(req.params.id, req.headers['if-match']); res.status(204).end(); },
  };
}
