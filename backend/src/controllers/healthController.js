export function getHealth(req, res) {
  res.status(200).json({ data: { estado: 'ok', servicio: 'ZeroTouch API' } });
}
