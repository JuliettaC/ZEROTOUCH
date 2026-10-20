export function createController(service, basePath) {
  return {
    list: (req, res) => res.json(service.list(req.query)),
    get: (req, res) => res.json({ data: service.get(req.params.id) }),
    create(req, res) {
      const data = service.create(req.body);
      res.location(`${basePath}/${data.id}`).status(201).json({ data });
    },
    update: (req, res) =>
      res.json({ data: service.update(req.params.id, req.body) }),
    delete(req, res) {
      service.delete(req.params.id);
      res.status(204).end();
    },
  };
}
