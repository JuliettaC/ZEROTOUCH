import { validateId } from './resourceValidation.js';
import { notFound } from '../domain/resourceError.js';
export function createCatalogosService(repository, modes, usuarioId) {
  return {
    gestures: () => repository.gestures(),
    actions: () => repository.actions(),
    effective(id) {
      id = validateId(id);
      return repository.snapshot(() => {
        const mode = modes.get(id);
        if (!mode) throw notFound();
        return { formato_version: 1, modo: mode, gestos: repository.effective(id, usuarioId) };
      });
    },
  };
}
